// Llamadas a Claude del generador de tours (PRD 06): investigar, verificar, generar paradas.
// Interfaz chica (TourLLM) para poder mockearla en tests, igual que PlannerLLM en llm.ts.
// Investigar/verificar: Tool Runner con web_search/web_fetch + una herramienta local "report_*" que
// captura la respuesta estructurada (evita la duda de mezclar server tools con output_config.format).
// Generar: output_config.format directo (sin tools), igual que skeleton() en llm.ts.
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { anthropicClient, fallbackParams, textOf, type AnyBlock, type Effort, JobError, PLANNER_MODEL } from './llm';
import { addUsage, emptyUsage, type Usage } from './schemas';
import {
  GenerateStopsOutput,
  type GenerateStopsOutputT,
  ResearchOutput,
  type ResearchOutputT,
  VerifyOutput,
  type VerifyOutputT,
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
    web_search: { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
    web_fetch: { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 },
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

export interface TourLLM {
  /** Pasada 1: investiga un lugar con web_search + web_fetch. */
  research(args: { system: string; user: string; config: TourLlmConfig }): Promise<{ facts: ResearchOutputT['facts']; usage: Usage; web_search_calls: number }>;
  /** Pasada 2: verifica un fact puntual contra su URL con web_fetch. */
  verifyFact(args: { system: string; user: string; config: TourLlmConfig }): Promise<{ result: VerifyOutputT | null; usage: Usage }>;
  /** Busca una segunda fuente para un fact que no se pudo verificar (1 reintento, PRD 06 paso 6). */
  findAlternateSource(args: { system: string; user: string; config: TourLlmConfig }): Promise<{ source_url: string | null; usage: Usage; web_search_calls: number }>;
  /** Pasada 3: genera las paradas (narraciones en 3 capas) a partir de facts ya verificados. */
  generateStops(args: { system: string; user: string; config: TourLlmConfig }): Promise<{ stops: GenerateStopsOutputT; usage: Usage }>;
}

export function anthropicTourLlm(): TourLLM {
  return {
    async research({ system, user, config }) {
      const r = await captureViaTool<ResearchOutputT>({
        system,
        user,
        captureName: 'report_facts',
        captureDescription: 'Reportá los datos atómicos que encontraste, cada uno con su URL exacta.',
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

    async findAlternateSource({ system, user, config }) {
      const r = await captureViaTool<{ source_url: string | null }>({
        system,
        user,
        captureName: 'report_source',
        captureDescription: 'Reportá una URL alternativa que respalde el dato, o null si no encontraste ninguna.',
        captureSchema: z.object({ source_url: z.string().nullable() }),
        serverTools: ['web_search'],
        config,
      });
      return { source_url: r.value?.source_url ?? null, usage: r.usage, web_search_calls: r.web_search_calls };
    },

    async generateStops({ system, user, config }) {
      const client = anthropicClient();
      const format = betaZodOutputFormat(GenerateStopsOutput);
      const params = {
        model: PLANNER_MODEL,
        max_tokens: config.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: config.effort, format: { type: 'json_schema', schema: format.schema } },
        ...fallbackParams(config),
        system: [{ type: 'text', text: system }],
        messages: [{ role: 'user', content: user }],
      };
      const msg = (await client.beta.messages.create(
        params as unknown as Parameters<typeof client.beta.messages.create>[0],
      )) as unknown as { stop_reason: string | null; content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
      const usage = addUsage(emptyUsage(), msg.usage);
      if (msg.stop_reason === 'refusal') throw new JobError('generate_failed', 'Claude no quiso generar las paradas (refusal).');
      if (msg.stop_reason === 'max_tokens') throw new JobError('generate_failed', 'La generación quedó cortada (max_tokens).');
      let stops: GenerateStopsOutputT;
      try {
        stops = format.parse(textOf(msg.content));
      } catch (err) {
        throw new JobError('generate_failed', `No pude leer las paradas: ${(err as Error).message.slice(0, 200)}`);
      }
      return { stops, usage };
    },
  };
}
