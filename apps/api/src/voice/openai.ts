// OpenAI Realtime: config de la sesión y token temporal (client_secret). La key nunca sale del servidor.
import { REALTIME_TRANSCRIBE_MODEL, SCOUT, toRealtimeTools, TOOL_NAMES, type ToolName } from '@build101/shared';
import { env } from '../env';
import { notConfigured, upstream } from '../errors';
import { handlers } from '../tools/registry';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const TIMEOUT_MS = 8000;

/** Herramientas que ve la voz: las de Contratos con handler en la API. */
export function voiceToolNames(exclude: readonly string[] = []): ToolName[] {
  return TOOL_NAMES.filter((n) => typeof handlers[n] === 'function' && !exclude.includes(n));
}

export type VadConfig = { type: 'server_vad' | 'semantic_vad'; threshold: number; silenceMs: number };

export function vadConfig(e: NodeJS.ProcessEnv = process.env): VadConfig {
  const type = e.VOICE_VAD?.trim() === 'semantic_vad' ? 'semantic_vad' : 'server_vad';
  const threshold = Number(e.VOICE_VAD_THRESHOLD);
  const silence = Number(e.VOICE_VAD_SILENCE_MS);
  return {
    type,
    threshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.6,
    silenceMs: Number.isFinite(silence) && silence >= 200 ? silence : 500,
  };
}

export function turnDetection(v: VadConfig): Record<string, unknown> {
  return v.type === 'semantic_vad'
    ? { type: 'semantic_vad', eagerness: 'auto', interrupt_response: true, create_response: true }
    : {
        type: 'server_vad',
        threshold: v.threshold,
        silence_duration_ms: v.silenceMs,
        prefix_padding_ms: 300,
        interrupt_response: true,
        create_response: true,
      };
}

export function realtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime';
}

/** El objeto `session` de client_secrets (también se devuelve al celu como session_config). */
export function buildRealtimeSession(args: { instructions: string; lang: string; tools?: ToolName[] }) {
  const tools = toRealtimeTools(args.tools ?? voiceToolNames());
  return {
    type: 'realtime' as const,
    model: realtimeModel(),
    instructions: args.instructions,
    tools,
    tool_choice: 'auto' as const,
    audio: {
      input: {
        transcription: { model: REALTIME_TRANSCRIBE_MODEL, language: args.lang },
        noise_reduction: { type: 'far_field' },
        turn_detection: turnDetection(vadConfig()),
      },
      output: { voice: SCOUT.voice },
    },
  };
}

export type ClientSecret = { value: string; expires_at: number | null };

/** Interfaz unificada: la oferta SDP del celu + la sesión → respuesta SDP. La key nunca sale del servidor. */
export async function createCall(
  sdp: string,
  session: Record<string, unknown>,
  opts: { safetyId?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = env().OPENAI_API_KEY;
  if (!key) throw notConfigured('OpenAI (OPENAI_API_KEY)');
  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify(session));
  let res: Response;
  try {
    res = await fetchImpl(CALLS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, ...(opts.safetyId ? { 'OpenAI-Safety-Identifier': opts.safetyId } : {}) },
      body: fd,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw upstream(`OpenAI no respondió: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok || !text.startsWith('v=')) throw upstream(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

export async function createClientSecret(session: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ClientSecret> {
  const key = env().OPENAI_API_KEY;
  if (!key) throw notConfigured('OpenAI (OPENAI_API_KEY)');
  let res: Response;
  try {
    res = await fetchImpl(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw upstream(`OpenAI no respondió: ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as { value?: string; expires_at?: number; error?: { message?: string } } | null;
  if (!res.ok || !json?.value) {
    // El mensaje de OpenAI no incluye la key; sirve para debug (p. ej. un esquema de herramienta inválido).
    throw upstream(`OpenAI ${res.status}: ${json?.error?.message ?? 'sin client_secret'}`);
  }
  return { value: json.value, expires_at: json.expires_at ?? null };
}
