// Modo demo de ubicación (Ahora v2, `?loc=near`): un punto a ~8 min a pie de un destino, para que "Salí en X" se vea
// aunque estés lejos. Puro (sin React): lo usa el integrador con simulator.placeAt / placeSimulatedAt.
import { distanceMeters } from '@build101/shared';

export type LatLng = { lat: number; lng: number };

/** walkEstimateMin = ceil(d × 1,3 / 80): 8 min ≈ 490 m en línea recta. */
const M_PER_WALK_MIN = 80 / 1.3;

/**
 * Punto a `walkMin` minutos a pie de `target`. Si viene `from`, sobre la recta from → target (así "venís" desde
 * donde estabas); si no, hacia el sur.
 */
export function pointNear(target: LatLng, walkMin = 8, from?: LatLng | null): LatLng {
  const d = walkMin * M_PER_WALK_MIN - 5;
  const R = 6_371_000;
  let bearing = Math.PI; // sur
  if (from && distanceMeters(from, target) > 1) {
    const rad = Math.PI / 180;
    const y = Math.sin((from.lng - target.lng) * rad) * Math.cos(from.lat * rad);
    const x =
      Math.cos(target.lat * rad) * Math.sin(from.lat * rad) -
      Math.sin(target.lat * rad) * Math.cos(from.lat * rad) * Math.cos((from.lng - target.lng) * rad);
    bearing = Math.atan2(y, x);
  }
  const dLat = (d * Math.cos(bearing)) / R;
  const dLng = (d * Math.sin(bearing)) / (R * Math.cos((target.lat * Math.PI) / 180));
  return { lat: target.lat + (dLat * 180) / Math.PI, lng: target.lng + (dLng * 180) / Math.PI };
}
