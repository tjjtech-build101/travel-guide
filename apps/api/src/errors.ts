// Errores de herramientas: el handler tira ToolFailure y el registro lo traduce a { ok:false, error } + status HTTP.
// Los errores de proveedores externos (Anthropic, OpenAI, Google…) se clasifican acá (provider_*) para que la app
// pueda decir qué pasó de verdad ("Claude se quedó sin créditos") en vez de "Error interno".
import {
  isFatalProviderCode,
  PROVIDER_LABEL,
  type Provider,
  type ProviderErrorCode,
  type ToolError,
} from '@build101/shared';

export class ToolFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: unknown,
    public readonly provider?: Provider,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ToolFailure';
  }

  toError(): ToolError {
    const out: ToolError = { code: this.code, message: this.message };
    if (this.issues !== undefined) out.issues = this.issues;
    if (this.provider) out.provider = this.provider;
    if (this.detail) out.detail = this.detail;
    return out;
  }
}

export const badInput = (message: string, issues?: unknown) => new ToolFailure(400, 'invalid_input', message, issues);
export const forbidden = (message = 'No tenés permiso para hacer esto.') => new ToolFailure(403, 'forbidden', message);
export const notFound = (message = 'No encontrado.') => new ToolFailure(404, 'not_found', message);
export const conflict = (code: string, message: string) => new ToolFailure(409, code, message);
export const notConfigured = (what: string, provider?: Provider) =>
  new ToolFailure(503, 'not_configured', `${what} no está configurado en el servidor.`, undefined, provider);
export const upstream = (message: string, provider?: Provider, detail?: string) =>
  new ToolFailure(502, 'upstream_error', message, undefined, provider, detail);

/** Convierte un error de supabase-js en ToolFailure 500 (o provider_unavailable si es la red). */
export function dbError(err: { message: string; code?: string } | null | undefined, what: string): ToolFailure {
  const raw = `${what}: ${err?.message ?? 'error desconocido'}`;
  if (err?.message && NETWORK_RE.test(err.message)) {
    return providerFailure('provider_unavailable', 'supabase', raw);
  }
  return new ToolFailure(500, 'db_error', 'No pudimos leer o guardar los datos.', undefined, 'supabase', raw);
}

// ───────────────────────── Clasificación de errores de proveedores

const STATUS: Record<ProviderErrorCode, number> = {
  provider_no_credits: 402,
  provider_auth: 502,
  provider_denied: 502,
  provider_rate_limited: 429,
  provider_overloaded: 503,
  provider_timeout: 504,
  provider_unavailable: 502,
  provider_refused: 422,
};

function defaultMessage(code: ProviderErrorCode, provider: Provider): string {
  const p = PROVIDER_LABEL[provider];
  switch (code) {
    case 'provider_no_credits':
      return `${p} se quedó sin créditos o la facturación está vencida.`;
    case 'provider_auth':
      return `La API key de ${p} es inválida o fue revocada.`;
    case 'provider_denied':
      return `La API key de ${p} no tiene permiso para este servicio.`;
    case 'provider_rate_limited':
      return `${p} recibió demasiados pedidos seguidos.`;
    case 'provider_overloaded':
      return `${p} está saturado en este momento.`;
    case 'provider_timeout':
      return `${p} tardó demasiado en contestar.`;
    case 'provider_unavailable':
      return `${p} no está respondiendo.`;
    case 'provider_refused':
      return `${p} no quiso responder ese pedido.`;
  }
}

export function providerFailure(code: ProviderErrorCode, provider: Provider, detail?: string, message?: string): ToolFailure {
  return new ToolFailure(STATUS[code], code, message ?? defaultMessage(code, provider), undefined, provider, detail?.slice(0, 400));
}

const CREDITS_RE = /credit balance|insufficient[_ ]quota|billing|purchase credits|usage limits?|spend(ing)? limit|exceeded your current quota|payment/i;
const AUTH_RE = /invalid[_ ]api[_ ]key|incorrect api key|api key not valid|authentication_error|invalid x-api-key|api_key_invalid/i;
const NETWORK_RE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|network/i;
const TIMEOUT_RE = /timed? ?out|ETIMEDOUT|aborted due to timeout/i;

/**
 * Clasifica una respuesta HTTP de error de un proveedor (OpenAI, Google, etc.) por status + cuerpo.
 * `body` puede ser texto o JSON; se busca `error.code` / `error.type` / `error.status` y el mensaje.
 */
export function classifyHttp(provider: Provider, status: number, body: string): ProviderErrorCode {
  let code = '';
  let type = '';
  let gstatus = '';
  try {
    const j = JSON.parse(body) as { error?: { code?: unknown; type?: unknown; status?: unknown } };
    code = String(j.error?.code ?? '');
    type = String(j.error?.type ?? '');
    gstatus = String(j.error?.status ?? '');
  } catch {
    // cuerpo no JSON: alcanza con el texto
  }
  const all = `${code} ${type} ${gstatus} ${body}`;
  if (CREDITS_RE.test(all) || status === 402) return 'provider_no_credits';
  if (AUTH_RE.test(all) || status === 401) return 'provider_auth';
  if (status === 403 || gstatus === 'PERMISSION_DENIED') return 'provider_denied';
  if (status === 429 || gstatus === 'RESOURCE_EXHAUSTED') return 'provider_rate_limited';
  if (status === 529 || status === 503 || /overloaded/i.test(all)) return 'provider_overloaded';
  if (status === 408 || status === 504) return 'provider_timeout';
  return 'provider_unavailable';
}

/** Para fetch a proveedores: respuesta no OK → ToolFailure clasificado. */
export function httpFailure(provider: Provider, status: number, body: string): ToolFailure {
  return providerFailure(classifyHttp(provider, status, body), provider, `${status}: ${body.slice(0, 300)}`);
}

/** Para fetch a proveedores: excepción de red / timeout → ToolFailure clasificado. */
export function fetchFailure(provider: Provider, err: unknown): ToolFailure {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const timeout = (err as { name?: string })?.name === 'TimeoutError' || TIMEOUT_RE.test(msg);
  return providerFailure(timeout ? 'provider_timeout' : 'provider_unavailable', provider, msg);
}

type SdkLike = { status?: unknown; name?: unknown; message?: unknown; error?: unknown };

/**
 * Clasifica un error del SDK de Anthropic (APIError y derivados) — u otro error con status HTTP.
 * Devuelve null si no parece de proveedor (bug nuestro, abort pedido por nosotros, etc.).
 */
export function classifyAnthropic(err: unknown): ToolFailure | null {
  if (err instanceof ToolFailure || !err || typeof err !== 'object') return null;
  const e = err as SdkLike;
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (name === 'APIUserAbortError' || name === 'AbortError') return null;
  if (name === 'APIConnectionTimeoutError') return providerFailure('provider_timeout', 'anthropic', message);
  if (name === 'APIConnectionError') return providerFailure('provider_unavailable', 'anthropic', message);
  if (typeof e.status === 'number') {
    const body = e.error ? JSON.stringify(e.error) : message;
    // 400 genérico de Anthropic = pedido mal armado (bug nuestro), salvo que sea el de saldo.
    if (e.status === 400 && !CREDITS_RE.test(`${body} ${message}`)) return null;
    return providerFailure(classifyHttp('anthropic', e.status, `${body} ${message}`), 'anthropic', message);
  }
  return null;
}

/** ¿Este error (ya clasificado o crudo del SDK) no se arregla reintentando? Ver isFatalProviderCode. */
export function isFatalProviderError(err: unknown): boolean {
  const f = err instanceof ToolFailure ? err : classifyAnthropic(err);
  return !!f && isFatalProviderCode(f.code);
}

/**
 * Para los `.catch` que degradan (seguir sin ese dato): deja pasar los errores fatales de proveedor
 * (sin créditos, key inválida) en vez de esconderlos como "no encontré lugares".
 */
export function rethrowIfFatal(err: unknown): void {
  if (isFatalProviderError(err)) throw err instanceof ToolFailure ? err : classifyAnthropic(err)!;
}

/** `.catch(orFallback([]))`: degrada al fallback salvo error fatal de proveedor. */
export function orFallback<T>(fallback: T): (err: unknown) => T {
  return (err) => {
    rethrowIfFatal(err);
    return fallback;
  };
}

/**
 * Normaliza cualquier error a ToolFailure: ToolFailure tal cual, errores de proveedor clasificados, errores de
 * dominio con `code` (JobError) como 502 con su código, y el resto como `internal` con mensaje genérico
 * (el texto crudo va en `detail`, nunca como mensaje para la persona).
 */
export function toFailure(err: unknown): ToolFailure {
  if (err instanceof ToolFailure) return err;
  const classified = classifyAnthropic(err);
  if (classified) return classified;
  const e = err as { name?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : String(err);
  if (e?.name === 'JobError' && typeof e.code === 'string') return new ToolFailure(502, e.code, message);
  if (e?.name === 'TimeoutError' || (e?.name === 'AbortError' && TIMEOUT_RE.test(message))) {
    return new ToolFailure(504, 'timeout', 'Tardó demasiado y lo cortamos.', undefined, undefined, message);
  }
  return new ToolFailure(500, 'internal', 'Algo se rompió de nuestro lado.', undefined, undefined, message.slice(0, 400));
}

/** Lo que guarda un job fallido en agent_jobs (error, error_code, error_provider). */
export function jobErrorFields(err: unknown): { error: string; error_code: string; error_provider: Provider | null } {
  const f = toFailure(err);
  // En `error` va el texto para la persona; si es `internal`, el crudo (sirve para depurar y no hay otro).
  const text = f.code === 'internal' && f.detail ? f.detail : f.message;
  return { error: text.replace(/\s+/g, ' ').slice(0, 300), error_code: f.code, error_provider: f.provider ?? null };
}
