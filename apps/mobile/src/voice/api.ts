// Endpoints de voz de la API (PRD 05): token temporal y cierre con resumen. La key de OpenAI nunca llega acá.
import { isProvider, type Provider, type TranscriptLine, type VoiceSessionInput, type VoiceSessionStart } from '@build101/shared';

import { env } from '../lib/env';
import { supabase } from '../lib/supabase';

/** Mismo formato que ToolCallError ({code, message, provider?, detail?}): lib/errors lo explica tal cual. */
export class VoiceApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public provider?: Provider,
    public detail?: string,
  ) {
    super(message);
    this.name = 'VoiceApiError';
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 10_000): Promise<T> {
  if (!env.apiUrl) throw new VoiceApiError('config_missing', 'Falta EXPO_PUBLIC_API_URL');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new VoiceApiError('unauthenticated', 'No hay sesión');
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // AbortSignal.timeout → TimeoutError: no es falta de red, es que el servidor tardó.
    const name = e instanceof Error ? e.name : '';
    throw new VoiceApiError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error', raw, undefined, raw);
  }
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; provider?: string; detail?: string } }
    | null;
  if (!json) throw new VoiceApiError(res.status === 401 ? 'unauthenticated' : `http_${res.status}`, '', undefined, `HTTP ${res.status} sin JSON`);
  if (!json.ok) {
    const { code, message, provider, detail } = json.error;
    throw new VoiceApiError(code, message, isProvider(provider) ? provider : undefined, detail);
  }
  return json.data;
}

export const startVoiceSession = (input: VoiceSessionInput) => post<VoiceSessionStart>('/voice/session', input);

export const endVoiceSession = (id: string, transcript: TranscriptLine[]) =>
  post<{ job_id: string }>(`/voice/session/${id}/end`, { transcript });
