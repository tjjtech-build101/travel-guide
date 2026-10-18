// Posición fresca en las herramientas de voz (PRD 07, "si sobra tiempo"). AISLADO: no toca el toolBridge ni el store de
// la voz (PRD 05); usa registerLocalTool, que ya existe para herramientas del celu.
//
// Problema: las instrucciones de la llamada traen la ubicación del momento en que se abrió; caminando 20 min, el
// modelo sigue buscando "cerca" de donde empezó. Acá, cuando el modelo llama:
//  - search_places SIN `near` → se agrega `near` con la última muestra del LocationProvider (real | simulado);
//  - route_eta con alguna parada vacía (sin lat/lng ni google_place_id) → esa parada pasa a ser "acá";
//  - where_am_i sin lat/lng → lectura nueva del GPS en ese momento (con su precisión).
// Si el modelo manda coordenadas, se respetan. Todo lo demás va igual al backend (POST /tools/:name, actor agent).
// Para sacarlo: no llamar registerFreshPositionTools() (TourRunner) y queda el comportamiento anterior.
import type { LocationFix } from '@build101/shared';

import { callTool } from '../lib/api';
import { registerLocalTool } from '../voice/toolBridge';
import { withFreshPosition } from './freshPositionToolsPure';

export { withFreshPosition };

/** Una muestra más vieja que esto no se usa (mejor que el modelo decida). */
const MAX_AGE_MS = 2 * 60_000;
/** Cuánto esperamos la lectura nueva del GPS en where_am_i. */
const REQUEST_FIX_MS = 6000;

type Source = {
  get: () => LocationFix | null;
  /** El simulador pausado no emite pero está quieto: su última muestra vale siempre. */
  simulated: boolean;
  /** Lectura nueva del provider en este momento; null si no llega a tiempo. */
  request: (timeoutMs: number) => Promise<LocationFix | null>;
  /** Último recurso: la ubicación con la que arrancó la llamada. */
  callStart: () => { lat: number; lng: number; accuracy?: number | null } | null;
};
let source: Source = { get: () => null, simulated: false, request: async () => null, callStart: () => null };
let registered = false;

/** Quién da la última posición (TourRunner le pasa el LocationProvider actual). */
export function setFreshPositionSource(s: Source) {
  source = s;
}

type Pos = { lat: number; lng: number; accuracy: number | null };
const toPos = (f: LocationFix): Pos => ({ lat: f.lat, lng: f.lng, accuracy: f.accuracy ?? null });

export function freshPosition(now = Date.now()): Pos | null {
  const f = source.get();
  if (!f || (!source.simulated && now - f.t > MAX_AGE_MS)) return null;
  return toPos(f);
}

/**
 * Lectura nueva del GPS ahora mismo; si no llega: la última muestra del provider; si tampoco: con la que arrancó la
 * llamada. `why` explica qué falló (va al error y al panel de eventos).
 */
async function currentPosition(): Promise<{ pos: Pos | null; why: string }> {
  let why = 'el GPS no respondió a tiempo';
  const now = await source.request(REQUEST_FIX_MS).catch((e: Error) => {
    why = e.name === 'LocationPermissionError' ? 'no hay permiso de ubicación' : `GPS: ${e.message}`;
    return null;
  });
  if (now) return { pos: toPos(now), why: '' };
  const last = source.get() ?? source.callStart();
  if (last) return { pos: { lat: last.lat, lng: last.lng, accuracy: last.accuracy ?? null }, why };
  return { pos: null, why };
}

export function registerFreshPositionTools() {
  if (registered) return;
  registered = true;
  for (const name of ['search_places', 'route_eta', 'where_am_i'] as const) {
    registerLocalTool(name, async (input) => {
      // where_am_i sin coordenadas: le pedimos al GPS dónde está AHORA (no la última muestra).
      const needsHere = name === 'where_am_i' && (typeof input.lat !== 'number' || typeof input.lng !== 'number');
      if (needsHere) {
        const { pos, why } = await currentPosition();
        if (!pos) {
          console.warn(`[where_am_i] sin ubicación: ${why}`);
          return { ok: false, error: { code: 'no_location', message: `No pude saber dónde está el celu (${why}). Decíselo a la persona en una frase.` } };
        }
        return callTool(name, withFreshPosition(name, input, pos) as never, { actor: 'agent' });
      }
      const body = withFreshPosition(name, input, freshPosition());
      return callTool(name, body as never, { actor: 'agent' });
    });
  }
}
