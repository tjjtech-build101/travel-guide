// Posición fresca en las herramientas de voz (PRD 07, "si sobra tiempo"). AISLADO: no toca el toolBridge ni el store de
// la voz (PRD 05); usa registerLocalTool, que ya existe para herramientas del celu.
//
// Problema: las instrucciones de la llamada traen la ubicación del momento en que se abrió; caminando 20 min, el
// modelo sigue buscando "cerca" de donde empezó. Acá, cuando el modelo llama:
//  - search_places SIN `near` → se agrega `near` con la última muestra del LocationProvider (real | simulado);
//  - route_eta con alguna parada vacía (sin lat/lng ni google_place_id) → esa parada pasa a ser "acá".
// Si el modelo manda coordenadas, se respetan. Todo lo demás va igual al backend (POST /tools/:name, actor agent).
// Para sacarlo: no llamar registerFreshPositionTools() (TourRunner) y queda el comportamiento anterior.
import type { LocationFix } from '@build101/shared';

import { callTool } from '../lib/api';
import { registerLocalTool } from '../voice/toolBridge';
import { withFreshPosition } from './freshPositionToolsPure';

export { withFreshPosition };

/** Una muestra más vieja que esto no se usa (mejor que el modelo decida). */
const MAX_AGE_MS = 2 * 60_000;

let source: () => LocationFix | null = () => null;
let registered = false;

/** Quién da la última posición (TourRunner le pasa el LocationProvider actual). */
export function setFreshPositionSource(fn: () => LocationFix | null) {
  source = fn;
}

export function freshPosition(now = Date.now()): { lat: number; lng: number } | null {
  const f = source();
  if (!f || now - f.t > MAX_AGE_MS) return null;
  return { lat: f.lat, lng: f.lng };
}

export function registerFreshPositionTools() {
  if (registered) return;
  registered = true;
  for (const name of ['search_places', 'route_eta'] as const) {
    registerLocalTool(name, async (input) => {
      const body = withFreshPosition(name, input, freshPosition());
      return callTool(name, body as never, { actor: 'agent' });
    });
  }
}
