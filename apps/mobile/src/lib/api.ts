// Cliente de la API de herramientas: POST ${EXPO_PUBLIC_API_URL}/tools/:name con el JWT del usuario.
// Misma API que usan la voz (function calls reenviados, actor 'agent') y la UI (actor 'user').
import { ACTOR_HEADER, type Actor, type ToolInput, type ToolName, type ToolResponse } from '@build101/shared';

import { env } from './env';
import { supabase } from './supabase';

export type CallToolOptions = {
  /** 'user' (default): los humanos editan directo. 'agent': la regla "propone en lo compartido". */
  actor?: Actor;
  signal?: AbortSignal;
};

export async function callTool<N extends ToolName, T = unknown>(
  name: N,
  input: ToolInput<N>,
  { actor = 'user', signal }: CallToolOptions = {},
): Promise<ToolResponse<T>> {
  if (!env.apiUrl) {
    return { ok: false, error: { code: 'config_missing', message: 'Falta EXPO_PUBLIC_API_URL' } };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { ok: false, error: { code: 'unauthenticated', message: 'No hay sesión' } };
  }
  try {
    const res = await fetch(`${env.apiUrl}/tools/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [ACTOR_HEADER]: actor,
      },
      body: JSON.stringify(input),
      signal,
    });
    const json = (await res.json().catch(() => null)) as ToolResponse<T> | null;
    if (json && typeof json === 'object' && 'ok' in json) return json;
    return { ok: false, error: { code: `http_${res.status}`, message: 'Respuesta inválida de la API' } };
  } catch (e) {
    return { ok: false, error: { code: 'network_error', message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Igual que callTool pero tira si falla (cómodo dentro de React Query). */
export async function callToolOrThrow<N extends ToolName, T = unknown>(
  name: N,
  input: ToolInput<N>,
  opts?: CallToolOptions,
): Promise<{ data: T; undo_token?: string; feed_id?: string }> {
  const res = await callTool<N, T>(name, input, opts);
  if (!res.ok) throw new ToolCallError(res.error.code, res.error.message, res.error.issues);
  return res;
}

export class ToolCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
    this.name = 'ToolCallError';
  }
}
