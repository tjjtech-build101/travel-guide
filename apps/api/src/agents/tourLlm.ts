// Llamadas a Claude del generador de tours (PRD 06 · tour director): extraer/investigar/verificar datos,
// dirigir el arco, escribir cada parada y criticar el resultado.
// Interfaz chica (TourLLM) para poder mockearla en tests, igual que PlannerLLM en llm.ts.
// Investigar/verificar en la web: Tool Runner con web_search/web_fetch + una herramienta local "report_*" que
// captura la respuesta estructurada (evita mezclar server tools con output_config.format).
// El resto: output_config.format directo (sin tools), igual que skeleton() en llm.ts.
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { anthropicClient, fallbackParams, textOf, type AnyBlock, type Effort, JobError, PLANNER_MODEL } from './llm';
import { addUsage, emptyUsage, type Usage } from './schemas';
import {
  CriticOutput,
  type CriticOutputT,
  DirectorOutput,
  type DirectorOutputT,
  ExtractOutput,
  type ExtractOutputT,
  JudgeOutput,
  type JudgeOutputT,
  ResearchOutput,
  type ResearchOutputT,
  VerifyOutput,
  type VerifyOutputT,
  WrittenStop,
  type WrittenStopT,
} from './tourSchemas';

export type TourLlmConfig = {
  effort: Effort;
  maxTokens: number;
  maxIterations: number;
  fallbacks: boolean;
};

type RunnerResult<T> = { value: T | null; usage: Usage; web_search_calls: number; stop_reason: string | null };

/**
 * Corre un Tool Runner con web_search/web_fetch (según `serverTools`) + una herramienta local que
 * captura la salida estructurada. Devuelve `value: null` si el modelo nunca la llamó (no tira: el
 * caller decide qué hacer, normalmente tratar el lugar/fact como "sin datos" y seguir).
 * Exportado: lo reusa también eventsSearch.ts (PRD 16) para no duplicar el Tool Runner.
 */
export async function captureViaTool<T>(args: {
  system: string;
  user: string;
  captureSchema: Parameters<typeof betaZodTool>[0]['inputSchema'];
  captureName: string;
  captureDescription: string;
  serverTools: ('web_search' | 'web_fetch')[];
  config: TourLlmConfig;
  signal?: AbortSignal;
  /** Tope de usos por server tool (default 3 cada una). El catálogo del planificador (PRD 31) pide más. */
  maxUses?: { web_search?: number; web_fetch?: number };
}): Promise<RunnerResult<T>> {
  const client = anthropicClient();
  let captured: T | null = null;
  const captureTool = betaZodTool({
    name: args.captureName,
    description: args.captureDescription,
    inputSchema: args.captureSchema,
    run: async (input) => {
      captured = input as T;
      return 'ok';
    },
  });
  const serverToolDefs: Record<string, unknown> = {
    web_search: { type: 'web_search_20260209', name: 'web_search', max_uses: args.maxUses?.web_search ?? 3 },
    web_fetch: { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: args.maxUses?.web_fetch ?? 3 },
  };
  const tools: unknown[] = [captureTool, ...args.serverTools.map((t) => serverToolDefs[t])];
  const params = {
    model: PLANNER_MODEL,
    max_tokens: args.config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: args.config.effort },
    ...fallbackParams(args.config),
    max_iterations: args.config.maxIterations,
    cache_control: { type: 'ephemeral' },
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    tools,
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: args.user }],
  };
  const runner = client.beta.messages.toolRunner(params as never, (args.signal ? { signal: args.signal } : {}) as never);
  const usage = emptyUsage();
  let webSearchCalls = 0;
  let lastStopReason: string | null = null;
  for await (const message of runner) {
    const m = message as unknown as { stop_reason: string | null; content: unknown[]; usage: Parameters<typeof addUsage>[1] };
    addUsage(usage, m.usage);
    lastStopReason = m.stop_reason;
    for (const block of m.content as { type: string }[]) {
      if (block.type === 'server_tool_use' && (block as { name?: string }).name === 'web_search') webSearchCalls++;
    }
    if (m.stop_reason === 'pause_turn') runner.pushMessages({ role: 'assistant', content: m.content } as never);
    if (captured !== null) break; // ya tenemos la respuesta: no hace falta seguir iterando
  }
  if (captured === null) {
    try {
      await runner.done();
    } catch {
      // sin captura y sin poder cerrar prolijo: igual devolvemos lo que tengamos (null)
    }
  }
  return { value: captured, usage, web_search_calls: webSearchCalls, stop_reason: lastStopReason };
}

export type LlmCall = { system: string; user: string; config: TourLlmConfig };

export interface TourLLM {
  /** Datos atómicos + cita textual desde un artículo que ya bajamos (Wikipedia). Sin herramientas. */
  extractFacts(args: LlmCall): Promise<{ facts: ExtractOutputT['facts']; usage: Usage }>;
  /** Investigación web (web_search + web_fetch) de lo que falta. */
  research(args: LlmCall): Promise<{ facts: ResearchOutputT['facts']; usage: Usage; web_search_calls: number }>;
  /** Fallback: verifica un dato contra su URL con web_fetch (cuando no pudimos bajar la página nosotros). */
  verifyFact(args: LlmCall): Promise<{ result: VerifyOutputT | null; usage: Usage }>;
  /** Juez: ¿cada cita respalda su dato? Una llamada por lugar. */
  judgeFacts(args: LlmCall): Promise<{ verdicts: JudgeOutputT['verdicts']; usage: Usage }>;
  /** Director: tesis, título, swaps y papel de cada parada. */
  direct(args: LlmCall): Promise<{ plan: DirectorOutputT; usage: Usage }>;
  /** Escritor: las capas de UNA parada, con citas [fN]. */
  writeStop(args: LlmCall): Promise<{ stop: WrittenStopT; usage: Usage }>;
  /** Crítico: rúbrica sobre el tour completo. */
  critique(args: LlmCall): Promise<{ review: CriticOutputT; usage: Usage }>;
}

/** Llamada con salida estructurada (output_config.format), sin herramientas. Prompt de sistema cacheado. */
async function structured<S extends Parameters<typeof betaZodOutputFormat>[0]>(
  schema: S,
  { system, user, config }: LlmCall,
  what: string,
): Promise<{ value: z.infer<S>; usage: Usage }> {
  const client = anthropicClient();
  const format = betaZodOutputFormat(schema);
  const params = {
    model: PLANNER_MODEL,
    max_tokens: config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort, format: { type: 'json_schema', schema: format.schema } },
    ...fallbackParams(config),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  const msg = (await client.beta.messages.create(
    params as unknown as Parameters<typeof client.beta.messages.create>[0],
  )) as unknown as { stop_reason: string | null; content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
  const usage = addUsage(emptyUsage(), msg.usage);
  if (msg.stop_reason === 'refusal') throw new JobError('generate_failed', `Claude no quiso ${what} (refusal).`);
  if (msg.stop_reason === 'max_tokens') throw new JobError('generate_failed', `${what}: la respuesta quedó cortada (max_tokens).`);
  try {
    return { value: format.parse(textOf(msg.content)) as z.infer<S>, usage };
  } catch (err) {
    throw new JobError('generate_failed', `No pude leer ${what}: ${(err as Error).message.slice(0, 200)}`);
  }
}

export function anthropicTourLlm(): TourLLM {
  return {
    async extractFacts(call) {
      const r = await structured(ExtractOutput, call, 'los datos del artículo');
      return { facts: r.value.facts, usage: r.usage };
    },

    async research({ system, user, config }) {
      const r = await captureViaTool<ResearchOutputT>({
        system,
        user,
        captureName: 'report_facts',
        captureDescription: 'Reportá los datos atómicos que encontraste, cada uno con su URL exacta, título de la fuente y cita textual.',
        captureSchema: ResearchOutput,
        serverTools: ['web_search', 'web_fetch'],
        config,
      });
      return { facts: r.value?.facts ?? [], usage: r.usage, web_search_calls: r.web_search_calls };
    },

    async verifyFact({ system, user, config }) {
      const r = await captureViaTool<VerifyOutputT>({
        system,
        user,
        captureName: 'report_verification',
        captureDescription: 'Reportá si la fuente respalda el dato, con la cita textual.',
        captureSchema: VerifyOutput,
        serverTools: ['web_fetch'],
        config,
      });
      return { result: r.value, usage: r.usage };
    },

    async judgeFacts(call) {
      const r = await structured(JudgeOutput, call, 'la verificación');
      return { verdicts: r.value.verdicts, usage: r.usage };
    },

    async direct(call) {
      const r = await structured(DirectorOutput, call, 'el plan del tour');
      return { plan: r.value, usage: r.usage };
    },

    async writeStop(call) {
      const r = await structured(WrittenStop, call, 'la parada');
      return { stop: r.value, usage: r.usage };
    },

    async critique(call) {
      const r = await structured(CriticOutput, call, 'la revisión');
      return { review: r.value, usage: r.usage };
    },
  };
}
