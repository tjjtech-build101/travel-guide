// Clientes Supabase: uno por request con el JWT del usuario (RLS) y uno service role (escrituras ya autorizadas).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

export type Db = SupabaseClient;

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** Cliente con el JWT del usuario: toda lectura pasa por RLS. */
export function userClient(jwt: string): Db {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

let admin: Db | null = null;
let adminKey = '';

/** Cliente service role. Solo para escrituras después de que la policy decidió, y lecturas internas de permisos. */
export function serviceClient(): Db {
  const e = env();
  const key = `${e.SUPABASE_URL}|${e.SUPABASE_SERVICE_ROLE_KEY}`;
  if (!admin || adminKey !== key) {
    admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: noSession });
    adminKey = key;
  }
  return admin;
}

/** Cliente anónimo (para auth.getUser como fallback de verificación). */
export function anonClient(): Db {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, { auth: noSession });
}
