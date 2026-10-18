// Cliente de la API de herramientas: POST ${EXPO_PUBLIC_API_URL}/tools/:name con el JWT del usuario.
// Misma API que usan la voz (function calls reenviados, actor 'agent') y la UI (actor 'user').
import { ACTOR_HEADER, type Actor, type Provider, type ToolInput, type ToolName, type ToolResponse } from '@build101/shared';

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
    return { ok: false, error: { code: 'config_missing', message: 'Falta la dirección del servidor.', detail: 'Falta EXPO_PUBLIC_API_URL' } };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { ok: false, error: { code: 'unauthenticated', message: 'No hay sesión iniciada.' } };
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
    const text = await res.text().catch(() => '');
    let json: ToolResponse<T> | null = null;
    try {
      json = JSON.parse(text) as ToolResponse<T>;
    } catch {
      // no es JSON (p. ej. la página de error de Vercel o un proxy)
    }
    if (json && typeof json === 'object' && 'ok' in json) return json;
    return {
      ok: false,
      error: { code: `http_${res.status}`, message: 'El servidor respondió algo inesperado.', detail: text.slice(0, 300) },
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // Abort pedido por quien llama: se respeta como abort (no es un error de red).
    if (name === 'AbortError' && signal?.aborted) return { ok: false, error: { code: 'aborted', message: 'Cancelado.', detail } };
    if (name === 'TimeoutError') return { ok: false, error: { code: 'timeout', message: 'El servidor tardó demasiado.', detail } };
    return { ok: false, error: { code: 'network_error', message: 'No llego al servidor.', detail } };
  }
}

/** Igual que callTool pero tira si falla (cómodo dentro de React Query). */
export async function callToolOrThrow<N extends ToolName, T = unknown>(
  name: N,
  input: ToolInput<N>,
  opts?: CallToolOptions,
): Promise<{ data: T; undo_token?: string; feed_id?: string }> {
  const res = await callTool<N, T>(name, input, opts);
  if (!res.ok) throw new ToolCallError(res.error.code, res.error.message, res.error.issues, res.error.provider, res.error.detail);
  return res;
}

export class ToolCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public issues?: unknown,
    public provider?: Provider,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ToolCallError';
  }
}
