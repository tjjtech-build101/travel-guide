// OpenAI Realtime: config de la sesión y token temporal (client_secret). La key nunca sale del servidor.
import { REALTIME_TRANSCRIBE_MODEL, SCOUT, toRealtimeTools, TOOL_NAMES, VOICE_CLIENT_TOOLS, type ToolName } from '@build101/shared';
import { env } from '../env';
import { fetchFailure, httpFailure, notConfigured, upstream } from '../errors';
import { handlers } from '../tools/registry';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const TIMEOUT_MS = 8000;

/**
 * Herramientas del backend que la voz NO ve con su esquema completo: look_at_photo necesita la foto, así que la voz
 * usa la versión reducida { question? } de VOICE_CLIENT_TOOLS (la app abre la cámara y llama al backend).
 */
export const VOICE_HIDDEN_TOOLS: readonly ToolName[] = ['look_at_photo'];

/** Herramientas que ve la voz: las de Contratos con handler en la API. */
export function voiceToolNames(exclude: readonly string[] = []): ToolName[] {
  return TOOL_NAMES.filter((n) => typeof handlers[n] === 'function' && !VOICE_HIDDEN_TOOLS.includes(n) && !exclude.includes(n));
}

export type VadConfig = {
  type: 'server_vad' | 'semantic_vad';
  threshold: number;
  silenceMs: number;
  eagerness: 'low' | 'medium' | 'high' | 'auto';
};

/**
 * Default semantic_vad con eagerness low: espera a que la persona termine la idea (no la pisa en una pausa).
 * VOICE_VAD=server_vad vuelve al VAD por silencio (threshold / silence_ms).
 */
export function vadConfig(e: NodeJS.ProcessEnv = process.env): VadConfig {
  const type = e.VOICE_VAD?.trim() === 'server_vad' ? 'server_vad' : 'semantic_vad';
  const eag = e.VOICE_VAD_EAGERNESS?.trim();
  const threshold = Number(e.VOICE_VAD_THRESHOLD);
  const silence = Number(e.VOICE_VAD_SILENCE_MS);
  return {
    type,
    threshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.6,
    silenceMs: Number.isFinite(silence) && silence >= 200 ? silence : 700,
    eagerness: eag === 'medium' || eag === 'high' || eag === 'auto' ? eag : 'low',
  };
}

export function turnDetection(v: VadConfig): Record<string, unknown> {
  return v.type === 'semantic_vad'
    ? { type: 'semantic_vad', eagerness: v.eagerness, interrupt_response: true, create_response: true }
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
  // 2.1: 8/8 en la mini evaluación de herramientas contra 7/8 de gpt-realtime (encadena y no corta en "lo busco").
  return process.env.OPENAI_REALTIME_MODEL?.trim() || 'gpt-realtime-2.1';
}

/** El objeto `session` de client_secrets (también se devuelve al celu como session_config). */
export function buildRealtimeSession(args: { instructions: string; lang: string; tools?: ToolName[] }) {
  const tools = [...toRealtimeTools(args.tools ?? voiceToolNames()), ...VOICE_CLIENT_TOOLS];
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
  if (!key) throw notConfigured('OpenAI (OPENAI_API_KEY)', 'openai');
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
    throw fetchFailure('openai', err);
  }
  const text = await res.text();
  if (!res.ok) throw httpFailure('openai', res.status, text);
  if (!text.startsWith('v=')) throw upstream('OpenAI devolvió una respuesta que no esperábamos.', 'openai', text.slice(0, 300));
  return text;
}

export async function createClientSecret(session: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ClientSecret> {
  const key = env().OPENAI_API_KEY;
  if (!key) throw notConfigured('OpenAI (OPENAI_API_KEY)', 'openai');
  let res: Response;
  try {
    res = await fetchImpl(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw fetchFailure('openai', err);
  }
  const raw = await res.text().catch(() => '');
  let json: { value?: string; expires_at?: number } | null;
  try {
    json = JSON.parse(raw) as { value?: string; expires_at?: number };
  } catch {
    json = null;
  }
  // El cuerpo de error de OpenAI no incluye la key; va en `detail` (p. ej. un esquema de herramienta inválido).
  if (!res.ok) throw httpFailure('openai', res.status, raw);
  if (!json?.value) throw upstream('OpenAI no devolvió el token de la llamada.', 'openai', raw.slice(0, 300));
  return { value: json.value, expires_at: json.expires_at ?? null };
}
