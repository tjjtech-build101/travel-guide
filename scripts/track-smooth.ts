/**
 * Suaviza un track crudo grabado con la app (menú dev → Grabar track) y lo imprime por stdout (PRD 09).
 *
 *   pnpm track:smooth raw.json > supabase/seed/ciudad-vieja-track.json
 *
 * Pasos (smoothTrack de packages/shared): descarta precisión > 30 m y saltos > 3 m/s, media móvil ponderada
 * por precisión, re-muestreo a 1 Hz con t desde 0, heading por rumbo y media circular.
 */
import { readFileSync } from 'node:fs';

import { maxJumpMeters, parseTrack, smoothTrack } from '../packages/shared/src/track';

const file = process.argv[2];
if (!file) {
  console.error('Uso: pnpm track:smooth <raw.json> > <salida.json>');
  process.exit(1);
}
const parsed = parseTrack(readFileSync(file, 'utf8'));
if (!parsed.ok) {
  console.error(`El archivo no tiene el formato de track: ${parsed.error}`);
  process.exit(1);
}
const out = smoothTrack(parsed.track);
console.error(
  `${parsed.track.length} puntos crudos → ${out.length} suavizados (1 Hz), salto máx. ${maxJumpMeters(out).toFixed(1)} m`,
);
process.stdout.write(JSON.stringify(out) + '\n');
