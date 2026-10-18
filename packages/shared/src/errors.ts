// Códigos de error que comparten la API y la app (ToolError.code y agent_jobs.error_code).
// Los de proveedor llevan además `provider` (quién falló), así la app puede decir "Claude se quedó sin créditos"
// en vez de "Error interno". El texto lindo para la persona lo arma la app (apps/mobile/src/lib/errors.ts).

export const PROVIDERS = ['anthropic', 'openai', 'google', 'supabase', 'weather', 'osm', 'wikipedia'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Nombre para mostrar de cada proveedor. */
export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'OpenAI',
  google: 'Google Maps',
  supabase: 'la base de datos',
  weather: 'el servicio del clima',
  osm: 'OpenStreetMap',
  wikipedia: 'Wikipedia',
};

/** Qué le pasó al proveedor externo. */
export const PROVIDER_ERROR_CODES = [
  'provider_no_credits', // sin saldo / créditos / facturación vencida
  'provider_auth', // API key inválida o revocada
  'provider_denied', // la key no tiene permiso para esa API (p. ej. Places no habilitada)
  'provider_rate_limited', // demasiados pedidos seguidos
  'provider_overloaded', // el proveedor está saturado (529 / 503)
  'provider_timeout', // no contestó a tiempo
  'provider_unavailable', // caído o error 5xx / de red
  'provider_refused', // el modelo se negó (política de contenido)
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export function isProviderErrorCode(code: string | null | undefined): code is ProviderErrorCode {
  return !!code && (PROVIDER_ERROR_CODES as readonly string[]).includes(code);
}

/** Errores que no se arreglan reintentando: hay que cargar saldo o cambiar la key. */
export function isFatalProviderCode(code: string | null | undefined): boolean {
  return code === 'provider_no_credits' || code === 'provider_auth' || code === 'provider_denied';
}

export function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}
