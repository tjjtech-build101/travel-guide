// Prueba real y barata del agente de eventos (PRD 16), UNA sola llamada. No es un test automatizado
// (gasta tokens reales): correrlo a mano con `tsx scripts/try-events.ts` desde apps/api.
//
// Uso: tsx scripts/try-events.ts "Ciudad" "fecha_desde" "fecha_hasta" "País"
// Ejemplo: tsx scripts/try-events.ts Montevideo 2026-10-17 2026-10-24 Uruguay
// Ejemplo: tsx scripts/try-events.ts Paris 2026-10-17 2026-10-24 Francia
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { runEventsSearch } = await import('../src/agents/eventsSearch');
const { serviceClient } = await import('../src/supabase');
const { DEMO_USERS } = await import('@build101/shared');

const [city = 'Montevideo', date_from = '2026-10-17', date_to = '2026-10-24', country = 'Uruguay'] = process.argv.slice(2);

console.log(`Buscando eventos en ${city}, ${country} (${date_from} a ${date_to})...`);
const t0 = Date.now();
const events = await runEventsSearch({ city, country, date_from, date_to, lang: 'es' }, serviceClient(), DEMO_USERS.juan);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n${events.length} eventos en ${secs}s:\n`);
for (const e of events) {
  console.log(`- ${e.title} · ${e.date}${e.start_time ? ` ${e.start_time}` : ''} · ${e.venue}`);
  console.log(`  ${e.price_text ?? 'precio no especificado'} · fuente: ${e.source_url}`);
}
console.log(`\n(Corré el mismo comando de nuevo: debería responder en <1s, usa caché de 6h.)`);
