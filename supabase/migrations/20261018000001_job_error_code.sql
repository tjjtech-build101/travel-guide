-- Errores clasificados en agent_jobs: además del texto, el código (packages/shared/src/errors.ts) y el proveedor
-- que falló. Así la app puede decir "Claude se quedó sin créditos" en vez de mostrar el mensaje crudo.
alter table public.agent_jobs
  add column if not exists error_code text,
  add column if not exists error_provider text;
