/**
 * Verifica un track contra las paradas del tour (PRD 09): pasa a ≤ 20 m de cada parada y no salta más de 8 m.
 *
 *   pnpm track:check                                   # seed de Ciudad Vieja vs. CIUDAD_VIEJA_STOPS
 *   pnpm track:check track.json --stops stops.json     # stops.json = [{name, lat, lng}] en orden
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CIUDAD_VIEJA_STOPS } from '../packages/shared/src/demo';
import { distancesToPoints, maxJumpMeters, type NamedPoint, parseTrack } from '../packages/shared/src/track';

const MAX_STOP_DISTANCE_M = 20;
const MAX_JUMP_M = 8;

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const stopsIdx = args.indexOf('--stops');
const stopsFile = stopsIdx >= 0 ? args[stopsIdx + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && (stopsIdx < 0 || i !== stopsIdx + 1));
const trackFile = positional[0] ?? resolve(here, '../supabase/seed/ciudad-vieja-track.json');

const parsed = parseTrack(readFileSync(trackFile, 'utf8'));
if (!parsed.ok) {
  console.error(`✗ ${trackFile}: el archivo no tiene el formato de track: ${parsed.error}`);
  process.exit(1);
}
const stops: NamedPoint[] = stopsFile ? JSON.parse(readFileSync(stopsFile, 'utf8')) : CIUDAD_VIEJA_STOPS.map((s) => ({ ...s }));

let ok = true;
const jump = maxJumpMeters(parsed.track);
console.log(`${jump <= MAX_JUMP_M ? '✓' : '✗'} salto máximo ${jump.toFixed(1)} m (≤ ${MAX_JUMP_M})`);
if (jump > MAX_JUMP_M) ok = false;

let lastT = -1;
for (const d of distancesToPoints(parsed.track, stops)) {
  const pass = d.distanceM <= MAX_STOP_DISTANCE_M;
  const order = d.t >= lastT ? '' : ' (fuera de orden)';
  lastT = Math.max(lastT, d.t);
  console.log(`${pass ? '✓' : '✗'} ${d.name}: ${d.distanceM.toFixed(1)} m · t=${Math.round(d.t)} s${order}`);
  if (!pass) ok = false;
}
console.log(ok ? `OK: ${trackFile}` : `FALLA: ${trackFile}`);
process.exit(ok ? 0 : 1);
