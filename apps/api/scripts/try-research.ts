// Prueba real y barata del agente investigador (PRD 06), UNA sola llamada. No es un test automatizado
// (gasta tokens reales): correrlo a mano con `tsx apps/api/scripts/try-research.ts` desde apps/api.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { anthropicTourLlm } = await import('../src/agents/tourLlm');
const { RESEARCH_SYSTEM, renderResearchUser } = await import('../src/agents/tourPrompts');
const { estimateCostUsd } = await import('../src/agents/schemas');

// Uso: tsx scripts/try-research.ts "Nombre del lugar" ["Ciudad"] ["lat,lng"]
// Ejemplos:
//   tsx scripts/try-research.ts "Mercado del Puerto" Montevideo
//   tsx scripts/try-research.ts "Parque Baroffio" Montevideo "-34.85,-56.17"
const [name = 'Teatro Solís', city = 'Montevideo', latlng = '-34.9073,-56.2006'] = process.argv.slice(2);
const [lat, lng] = latlng.split(',').map(Number);

const llm = anthropicTourLlm();
const place = { name, city, country: 'Uruguay', lat, lng, hints: [] as string[] };

console.log(`Investigando: ${place.name} (${place.city})...`);
const t0 = Date.now();
const res = await llm.research({
  system: RESEARCH_SYSTEM,
  user: renderResearchUser(place),
  config: { effort: 'medium', maxTokens: 4000, maxIterations: 6, fallbacks: true },
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n${res.facts.length} facts en ${secs}s, ${res.web_search_calls} búsquedas:\n`);
for (const f of res.facts) console.log(`- ${f.text}\n  (${f.source_url})`);
console.log(`\nUsage: ${JSON.stringify(res.usage)}`);
console.log(`Costo estimado: ~USD ${estimateCostUsd(res.usage)}`);
