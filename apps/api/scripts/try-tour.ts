// Prueba real del tour director (PRD 06) de punta a punta SIN base de datos: candidatos reales (Wikipedia, OSM,
// Google si hay key), clima y barrio reales, Claude real. Gasta tokens (~USD 1-3 por tour): correrlo a mano.
//   cd apps/api && npx tsx scripts/try-tour.ts [preset] [lat,lng] [minutos] ['{"food_stop":true}'] [salida.json]
// Presets: ana (arquitectura, sola) · familia (2 adultos + chicos, evitan museos) · movilidad (step_free, tranqui)
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { composeTour, defaultDeps } = await import('../src/agents/tourGenerator');
const { localClock } = await import('../src/agents/tourContext');
const { estimateCostUsd } = await import('../src/agents/schemas');
type Member = import('../src/agents/tourContext').Member;

const [preset = 'ana', latlng = '-34.9066,-56.1990', minutes = '60', answersJson = '{}', out] = process.argv.slice(2);
const [lat, lng] = latlng.split(',').map(Number);
const duration = Number(minutes);
const answers = JSON.parse(answersJson);

const m = (over: Partial<Member>): Member => ({
  id: 'u1', name: 'Ana', interests: null, avoid: [], dietary: [], pace: 'balanced', budget_level: 'mid', step_free: false,
  max_walk_km: null, mobility_notes: null, languages: ['es'], guide_style: null, traits: [], trip_goal: null, trip_must: [],
  trip_avoid: [], companions: null, ...over,
});
const PRESETS: Record<string, Member[]> = {
  ana: [m({ name: 'Ana', interests: { arquitectura: 5, historia: 4, fotografia: 3 }, traits: ['le encantan los detalles de las fachadas'] })],
  familia: [
    m({ name: 'Caro', interests: { historia: 4, comida: 4 }, avoid: ['museos'], companions: 'con Juan y nuestros hijos (6 y 9)' }),
    m({ id: 'u2', name: 'Juan', interests: { arquitectura: 3, deporte: 5 }, pace: 'relaxed' }),
  ],
  movilidad: [m({ name: 'Elena', interests: { historia: 5, arte: 4, religion: 3 }, step_free: true, max_walk_km: 2, pace: 'relaxed', mobility_notes: 'silla de ruedas' })],
};

const deps = { ...defaultDeps(null as never, 'try-tour'), nearbyPlaceLibrary: async () => [] };
const start = new Date();
const [weather, place] = await Promise.all([deps.weather({ lat, lng, start, duration_min: duration }), deps.reverseGeocode(lat, lng)]);
const brief = {
  members: PRESETS[preset] ?? PRESETS.ana,
  memories: [], told: new Map(), previousTourPlaceIds: new Set<string>(), itinerary: [], saved: [],
  start, durationMin: duration, local: localClock(start, weather?.utc_offset_s ?? -10800), weather, place, answers,
};
console.log(`Tour de ${duration} min en ${place?.neighborhood ?? '?'}, ${place?.city ?? '?'} · ${brief.local.text} · preset ${preset}\n`);
const t0 = Date.now();
const tour = await composeTour(
  {
    input: { mode: 'spontaneous', start_lat: lat, start_lng: lng, duration_min: duration, storyline: false, language: 'es', ...answers },
    brief,
    progress: (l) => console.log(`  · ${l}  (${Math.round((Date.now() - t0) / 1000)} s)`),
    startedAt: t0,
  },
  deps,
);
console.log(`\n«${tour.title}» — ${tour.thesis}`);
console.log(`${tour.stops.length} paradas · ~${tour.estDurationMin} min · ${tour.totalWalkM} m · ${Math.round((Date.now() - t0) / 1000)} s · ~USD ${estimateCostUsd(tour.usage)}`);
console.log(`stats ${JSON.stringify(tour.stats)}\n`);
tour.stops.forEach((s, i) => {
  const w = s.written;
  console.log(`── ${i + 1}. ${s.candidate.name} [${s.kind} · ${s.role} · ${s.dwell_min} min · ${s.facts.length} datos · ${s.sources.length} fuentes]`);
  console.log(`MIRAR: ${w.look_at}\nCORTA (${w.narration_short.split(/\s+/).length}p): ${w.narration_short}\nMÁS: ${w.narration_more}\nSECRETO: ${w.narration_secret}`);
  if (w.myth_vs_fact) console.log(`MITO: ${w.myth_vs_fact}`);
  if (w.photo_spot) console.log(`FOTO: ${w.photo_spot}`);
  if (w.kid_mission) console.log(`CHICOS: ${w.kid_mission}`);
  if (w.transition_to_next) console.log(`→ ${w.transition_to_next} (${w.nav_to_next})`);
  console.log(`Fuentes: ${s.sources.map((x) => x.url).join(' · ')}\n`);
});
if (out) writeFileSync(out, JSON.stringify(tour, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v), 2));
