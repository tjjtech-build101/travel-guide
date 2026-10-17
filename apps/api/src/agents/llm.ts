// Llamadas a Claude del planificador. Interfaz chica (PlannerLLM) para poder mockearla en tests.
// SDK 0.70.1: output_config / thinking adaptive / fallbacks no están tipados todavía → se pasan con cast
// (el SDK manda el body tal cual). La salida estructurada usa output_config.format (no el output_format viejo).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { env } from '../env';
import { notConfigured } from '../errors';
import { addUsage, emptyUsage, TripSkeleton, type Usage } from './schemas';

export const PLANNER_MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type PlannerConfig = {
  effort: Effort;
  webSearch: boolean;
  maxTokens: number;
  maxIterations: number;
  /** Si un tramo pasa este tiempo, se corta el runner y queda para "Reintentar". */
  legTimeoutMs: number;
  /** fallbacks:'default' + beta server-side-fallback (rechazo de clasificador → otro modelo). */
  fallbacks: boolean;
  /** Tramos rellenados en paralelo. */
  concurrency: number;
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function plannerConfig(e: NodeJS.ProcessEnv = process.env): PlannerConfig {
  const effort = (e.PLANNER_EFFORT ?? '').trim() as Effort;
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    effort: EFFORTS.includes(effort) ? effort : 'high',
    webSearch: (e.PLANNER_WEB_SEARCH ?? 'true').trim().toLowerCase() !== 'false',
    maxTokens: num(e.PLANNER_MAX_TOKENS, 16000),
    maxIterations: num(e.PLANNER_MAX_ITERATIONS, 40),
    legTimeoutMs: num(e.PLANNER_LEG_TIMEOUT_S, 150) * 1000,
    fallbacks: (e.PLANNER_FALLBACKS ?? 'true').trim().toLowerCase() !== 'false',
    concurrency: Math.min(3, num(e.PLANNER_CONCURRENCY, 3)),
  };
}

export type SystemBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

/** Una herramienta lista para el Tool Runner (betaZodTool) o un server tool (web search). */
export type RunnerTool = { name: string; [k: string]: unknown };

export type FillLegResult = { stop_reason: string | null; usage: Usage; iterations: number; text: string };

export interface PlannerLLM {
  skeleton(args: { system: string; user: string; config: PlannerConfig }): Promise<{ skeleton: TripSkeleton; usage: Usage }>;
  fillLeg(args: {
    system: SystemBlock[];
    user: string;
    tools: RunnerTool[];
    config: PlannerConfig;
    signal: AbortSignal;
  }): Promise<FillLegResult>;
}

export class JobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

// Exportados: los reusan otros agentes (ej. tourLlm.ts) para no duplicar el cliente ni el parseo.
export function anthropicClient(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw notConfigured('Anthropic (ANTHROPIC_API_KEY)');
  // 2 reintentos (429/5xx) por defecto del SDK.
  return new Anthropic({ apiKey });
}

export function fallbackParams(config: Pick<PlannerConfig, 'fallbacks'>): Record<string, unknown> {
  return config.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

export type AnyBlock = { type: string; text?: string };

export function textOf(content: AnyBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

export function anthropicPlanner(): PlannerLLM {
  return {
    async skeleton({ system, user, config }) {
      const client = anthropicClient();
      const format = betaZodOutputFormat(TripSkeleton);
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
      if (msg.stop_reason === 'refusal') throw new JobError('skeleton_failed', 'Claude no quiso armar el esqueleto (refusal).');
      if (msg.stop_reason === 'max_tokens') throw new JobError('skeleton_failed', 'El esqueleto quedó cortado (max_tokens).');
      let skeleton: TripSkeleton;
      try {
        skeleton = format.parse(textOf(msg.content));
      } catch (err) {
        throw new JobError('skeleton_failed', `No pude leer el esqueleto: ${(err as Error).message.slice(0, 200)}`);
      }
      return { skeleton, usage };
    },

    async fillLeg({ system, user, tools, config, signal }) {
      const client = anthropicClient();
      const allTools: unknown[] = [...tools];
      if (config.webSearch) allTools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 4 });
      const params = {
        model: PLANNER_MODEL,
        max_tokens: config.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: config.effort },
        ...fallbackParams(config),
        max_iterations: config.maxIterations,
        // Caché automático: el último bloque cacheable avanza con la conversación (cada vuelta reenvía todo).
        cache_control: { type: 'ephemeral' },
        system,
        tools: allTools,
        messages: [{ role: 'user', content: user }],
      };
      // El tipo de options solo declara headers, pero el runner las reenvía a messages.create (signal funciona).
      const runner = client.beta.messages.toolRunner(params as never, { signal } as never);
      const usage = emptyUsage();
      let iterations = 0;
      // El runner no reanuda pause_turn solo (server tools): hay que empujar el turno pausado.
      for await (const message of runner) {
        iterations++;
        if (signal.aborted) throw new JobError('leg_timeout', 'Se cortó por tiempo.');
        const m = message as unknown as { stop_reason: string | null; content: unknown[]; usage: Parameters<typeof addUsage>[1] };
        addUsage(usage, m.usage);
        if (m.stop_reason === 'pause_turn') {
          runner.pushMessages({ role: 'assistant', content: m.content } as never);
        }
      }
      const final = (await runner.done()) as unknown as { stop_reason: string | null; content: AnyBlock[] };
      return { stop_reason: final.stop_reason, usage, iterations, text: textOf(final.content) };
    },
  };
}
