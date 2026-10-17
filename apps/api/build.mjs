// Build para Vercel (Build Output API v3): empaqueta la API + @build101/shared (TS fuente) en un solo archivo.
// Vercel no transpila paquetes del workspace, así que no usamos el builder zero-config de Hono.
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
const fn = `${out}/functions/index.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ['src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  // Algunas dependencias usan require(): lo proveemos en ESM.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs24.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 300,
    // São Paulo: al lado de Supabase (sa-east-1). En iad1 cada consulta cruzaba el continente (contexto de voz 2,3 s → ~0,3 s).
    regions: [process.env.API_REGION || 'gru1'],
  }),
);
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }));
console.log('Build Output listo en', out);
