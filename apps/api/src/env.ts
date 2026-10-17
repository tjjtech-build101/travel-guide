// Variables de entorno de la API. Se leen en cada acceso (Vercel inyecta process.env; dev.ts carga .env).

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
};

const opt = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() !== '' ? v.trim() : undefined;
};

export function env(): Env {
  return {
    SUPABASE_URL: (opt('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
    SUPABASE_ANON_KEY: opt('SUPABASE_ANON_KEY') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: opt('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    SUPABASE_JWT_SECRET: opt('SUPABASE_JWT_SECRET'),
    ANTHROPIC_API_KEY: opt('ANTHROPIC_API_KEY'),
    OPENAI_API_KEY: opt('OPENAI_API_KEY'),
    GOOGLE_MAPS_API_KEY: opt('GOOGLE_MAPS_API_KEY'),
  };
}

export function missingSupabaseEnv(): string[] {
  const e = env();
  return (['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter((k) => !e[k]);
}
