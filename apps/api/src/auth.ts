// Middleware de auth: verifica el JWT de Supabase y arma el contexto por request.
// 1) jose contra el JWKS del proyecto (claves asimétricas), 2) HS256 con SUPABASE_JWT_SECRET si está,
// 3) fallback a supabase.auth.getUser(jwt) (Supabase local que firma con HS256 sin secreto configurado).
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ACTOR_HEADER, type Actor } from '@build101/shared';
import { env, missingSupabaseEnv } from './env';
import { providerFailure } from './errors';
import { anonClient, serviceClient, userClient } from './supabase';
import type { ToolCtx } from './tools/types';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl = '';

function getJwks() {
  const url = `${env().SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url), { timeoutDuration: 3000, cooldownDuration: 30_000 });
    jwksUrl = url;
  }
  return jwks;
}

function subFrom(payload: JWTPayload): string | null {
  if (typeof payload.sub !== 'string' || payload.sub === '') return null;
  // Rechazar tokens anon/service_role: acá solo entran usuarios logueados.
  if (payload.role !== undefined && payload.role !== 'authenticated') return null;
  return payload.sub;
}

/** Devuelve el user id (sub) si el JWT es válido, o null. */
export async function verifySupabaseJwt(token: string): Promise<string | null> {
  const r = await checkSupabaseJwt(token);
  return typeof r === 'string' ? r : null;
}

/**
 * Como verifySupabaseJwt, pero distingue "token inválido" (null) de "no pude verificar porque Supabase no
 * responde" ('unavailable'): lo segundo no tiene que desloguear a nadie.
 */
async function checkSupabaseJwt(token: string): Promise<string | null | 'unavailable'> {
  try {
    const { payload } = await jwtVerify(token, getJwks());
    const sub = subFrom(payload);
    if (sub) return sub;
  } catch {
    // seguimos con los fallbacks
  }
  const secret = env().SUPABASE_JWT_SECRET;
  if (secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
      const sub = subFrom(payload);
      if (sub) return sub;
    } catch {
      // seguimos
    }
  }
  try {
    const { data, error } = await anonClient().auth.getUser(token);
    if (!error && data.user) return data.user.id;
    // 5xx / red del lado de Supabase: no es culpa del token.
    if (error && (((error as { status?: number }).status ?? 0) >= 500 || /fetch failed|network/i.test(error.message))) {
      return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }
  return null;
}

export function parseActor(raw: string | undefined | null): Actor {
  return raw?.trim().toLowerCase() === 'agent' ? 'agent' : 'user';
}

export function bearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}

export type AuthVars = { ctx: ToolCtx };

export const requireAuth = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  const missing = missingSupabaseEnv();
  if (missing.length) {
    return c.json(
      { ok: false, error: { code: 'not_configured', provider: 'supabase', message: `Faltan variables del servidor: ${missing.join(', ')}` } },
      503,
    );
  }
  const jwt = bearer(c.req.header('authorization'));
  if (!jwt) {
    return c.json({ ok: false, error: { code: 'unauthorized', message: 'No hay sesión iniciada.', detail: 'Falta el header Authorization: Bearer <JWT>.' } }, 401);
  }
  const userId = await checkSupabaseJwt(jwt);
  if (userId === 'unavailable') {
    const f = providerFailure('provider_unavailable', 'supabase', 'No pude verificar el JWT: Supabase Auth no responde.');
    return c.json({ ok: false, error: f.toError() }, 503);
  }
  if (!userId) {
    return c.json({ ok: false, error: { code: 'unauthorized', message: 'Tu sesión venció.', detail: 'JWT inválido o vencido.' } }, 401);
  }
  c.set('ctx', {
    userId,
    actor: parseActor(c.req.header(ACTOR_HEADER)),
    db: userClient(jwt),
    admin: serviceClient(),
  });
  await next();
});
