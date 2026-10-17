// Parte pura de freshPositionTools (sin React Native: la prueba con tsx).
type Stop = { lat?: unknown; lng?: unknown; google_place_id?: unknown };
const emptyStop = (s: Stop) => (typeof s.lat !== 'number' || typeof s.lng !== 'number') && !s.google_place_id;

/** Puro (testeable): completa el input con la posición fresca. Devuelve el mismo objeto si no cambia nada. */
export function withFreshPosition(name: string, input: Record<string, unknown>, here: { lat: number; lng: number } | null) {
  if (!here) return input;
  if (name === 'search_places' && input.near == null) return { ...input, near: here };
  if (name === 'route_eta' && Array.isArray(input.stops) && (input.stops as Stop[]).some(emptyStop)) {
    return { ...input, stops: (input.stops as Stop[]).map((s) => (emptyStop(s) ? { ...s, lat: here.lat, lng: here.lng } : s)) };
  }
  return input;
}

