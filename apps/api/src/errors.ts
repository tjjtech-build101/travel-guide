// Errores de herramientas: el handler tira ToolFailure y el registro lo traduce a { ok:false, error } + status HTTP.
import type { ToolError } from '@build101/shared';

export class ToolFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ToolFailure';
  }

  toError(): ToolError {
    return this.issues === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, issues: this.issues };
  }
}

export const badInput = (message: string, issues?: unknown) => new ToolFailure(400, 'invalid_input', message, issues);
export const forbidden = (message = 'No tenés permiso para hacer esto.') => new ToolFailure(403, 'forbidden', message);
export const notFound = (message = 'No encontrado.') => new ToolFailure(404, 'not_found', message);
export const conflict = (code: string, message: string) => new ToolFailure(409, code, message);
export const notConfigured = (what: string) =>
  new ToolFailure(503, 'not_configured', `${what} no está configurado en el servidor.`);
export const upstream = (message: string) => new ToolFailure(502, 'upstream_error', message);

/** Convierte un error de supabase-js en ToolFailure 500. */
export function dbError(err: { message: string; code?: string } | null | undefined, what: string): ToolFailure {
  return new ToolFailure(500, 'db_error', `${what}: ${err?.message ?? 'error desconocido'}`);
}
