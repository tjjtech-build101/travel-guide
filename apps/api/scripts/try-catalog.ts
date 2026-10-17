// Prueba real del catálogo del destino (PRD 31) SIN base de datos: Claude real (generate + review con web_search),
// Google Places real. Gasta tokens y llamadas a Places (~USD 1-3 por ciudad): correrlo a mano.
//   cd apps/api && npx tsx scripts/try-catalog.ts "Buenos Aires" Argentina [-34.6037,-58.3816] [salida.json]
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { getCatalog, defaultCatalogDeps } = await import('../src/agents/planner/catalog');
const { estimateCostUsd } = await import('../src/agents/schemas');

const [city = 'Buenos Aires', country = 'Argentina', latlng, out] = process.argv.slice(2);
const [lat, lng] = latlng ? latlng.split(',').map(Number) : [null, null];

// Admin falso: nunca hay caché y el upsert solo se loguea.
const admin = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    upsert: async (row: { items: unknown[] }) => (console.log(`(upsert simulado: ${row.items.length} ítems)`), { error: null }),
  }),
} as never;

const t0 = Date.now();
const r = await getCatalog(admin, { city, country, lat, lng }, defaultCatalogDeps(), { onProgress: (t) => console.log(`· ${t}`) });
console.log(`\n${r.items.length} ítems en ${((Date.now() - t0) / 1000).toFixed(0)} s · USD ${estimateCostUsd(r.usage).toFixed(2)}\n`);
for (const tier of ['must', 'recommended', 'gem'] as const) {
  const list = r.items.filter((i) => i.tier === tier);
  console.log(`── ${tier} (${list.length})`);
  for (const i of list) console.log(`  ${i.name} · ${i.category} · ${i.zone ?? '-'} · ${i.duration_min} min · ${i.sources.length} fuentes · not ${i.notability}`);
}
console.log('\n── alojamiento');
for (const z of r.lodging_zones) console.log(`  ${z.zone}: ${z.why}`);
if (out) writeFileSync(out, JSON.stringify(r, null, 2));
