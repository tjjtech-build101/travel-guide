// Endpoints de voz de la API (PRD 05): token temporal y cierre con resumen. La key de OpenAI nunca llega acá.
import type { TranscriptLine, VoiceSessionInput, VoiceSessionStart } from '@build101/shared';

import { env } from '../lib/env';
import { supabase } from '../lib/supabase';

export class VoiceApiError extends Error {
  constructor(
    public code: string,
    message: string,
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
    throw new VoiceApiError('network_error', e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
    | null;
  if (!json) throw new VoiceApiError(`http_${res.status}`, 'Respuesta inválida de la API');
  if (!json.ok) throw new VoiceApiError(json.error.code, json.error.message);
  return json.data;
}

export const startVoiceSession = (input: VoiceSessionInput) => post<VoiceSessionStart>('/voice/session', input);

export const endVoiceSession = (id: string, transcript: TranscriptLine[]) =>
  post<{ job_id: string }>(`/voice/session/${id}/end`, { transcript });
