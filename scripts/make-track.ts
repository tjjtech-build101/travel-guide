/**
 * Genera un track sintético del tour "Ciudad Vieja" para el SimulatedLocationProvider.
 *
 *   npx tsx scripts/make-track.ts
 *
 * Salida: supabase/seed/ciudad-vieja-track.json → [{ t, lat, lng, heading, accuracy }]
 *   - t: segundos desde el inicio (1 Hz)
 *   - velocidad de caminata: 1.3 m/s, en línea recta entre paradas
 *   - heading: rumbo en grados (0 = norte); null mientras está parado en una parada
 *   - accuracy: metros (determinística, 4–8 m)
 *
 * Las coordenadas son CIUDAD_VIEJA_STOPS de packages/shared/src/demo.ts (= supabase/seed.sql, place_library).
 * Se reemplaza por el track grabado cuando exista.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CIUDAD_VIEJA_STOPS } from '../packages/shared/src/demo';

const SPEED_MPS = 1.3;
/** Segundos parado en cada parada (para probar geofence + dwell). */
const DWELL_S = 30;

type Fix = { t: number; lat: number; lng: number; heading: number | null; accuracy: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// PRNG determinístico (mulberry32) para que el archivo sea estable entre corridas.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function makeTrack(): Fix[] {
  const rand = mulberry32(101);
  const acc = () => round(4 + rand() * 4, 1);
  const fixes: Fix[] = [];
  let t = 0;

  const push = (lat: number, lng: number, heading: number | null) => {
    fixes.push({ t, lat: round(lat, 6), lng: round(lng, 6), heading: heading === null ? null : round(heading, 1), accuracy: acc() });
    t += 1;
  };

  for (let i = 0; i < CIUDAD_VIEJA_STOPS.length; i++) {
    const stop = CIUDAD_VIEJA_STOPS[i];
    // Parado en la parada
    for (let s = 0; s < DWELL_S; s++) push(stop.lat, stop.lng, null);

    const next = CIUDAD_VIEJA_STOPS[i + 1];
    if (!next) break;
    const dist = distanceM(stop, next);
    const heading = bearingDeg(stop, next);
    const steps = Math.max(1, Math.ceil(dist / SPEED_MPS));
    // Caminando (interpolación lineal; a esta escala alcanza)
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      push(stop.lat + (next.lat - stop.lat) * f, stop.lng + (next.lng - stop.lng) * f, heading);
    }
  }
  return fixes;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../supabase/seed/ciudad-vieja-track.json');
const track = makeTrack();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(track) + '\n');
const totalM = CIUDAD_VIEJA_STOPS.slice(1).reduce((m, s, i) => m + distanceM(CIUDAD_VIEJA_STOPS[i], s), 0);
console.log(
  `ciudad-vieja-track.json: ${track.length} fixes, ${Math.round(totalM)} m, ${Math.round(track.length / 60)} min → ${out}`,
);
