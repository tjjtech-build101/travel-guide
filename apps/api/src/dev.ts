// Servidor local: `pnpm --filter api dev` → http://localhost:8787
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

const { default: app } = await import('./index');
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`build101 api escuchando en http://localhost:${info.port}`);
});
