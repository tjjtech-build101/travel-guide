// Google Routes computeRoutes (pares en paralelo) + estimación por distancia si no hay key.
import { distanceMeters, type RouteMode } from '@build101/shared';
import { env } from '../env';
import { badInput, notConfigured } from '../errors';
import { cached } from './cache';
import { googleFetch } from './places';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
const TRAVEL_MODE: Record<RouteMode, string> = { walk: 'WALK', transit: 'TRANSIT', car: 'DRIVE' };

/** Velocidades de la estimación sin Google (km/h, en línea recta). */
const FALLBACK_KMH: Record<RouteMode, number> = { walk: 4.5, transit: 15, car: 25 };

export type Stop = { lat?: number; lng?: number; google_place_id?: string };
export type Segment = { from_idx: number; to_idx: number; duration_min: number; distance_m: number; polyline: string | null };
export type RouteResult = { segments: Segment[]; total_min: number; estimated?: boolean };

export function hasCoords(s: Stop): s is Stop & { lat: number; lng: number } {
  return typeof s.lat === 'number' && typeof s.lng === 'number';
}

function waypoint(s: Stop) {
  if (s.google_place_id) return { placeId: s.google_place_id };
  if (hasCoords(s)) return { location: { latLng: { latitude: s.lat, longitude: s.lng } } };
  throw badInput('Cada parada necesita {lat, lng} o {google_place_id}.');
}

/** Minutos estimados por distancia en línea recta. */
export function estimateMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: RouteMode) {
  const m = distanceMeters(a, b);
  return { duration_min: Math.max(1, Math.round(m / ((FALLBACK_KMH[mode] * 1000) / 60))), distance_m: Math.round(m) };
}

async function googleSegment(a: Stop, b: Stop, mode: RouteMode, departure_time?: string) {
  const body: Record<string, unknown> = {
    origin: waypoint(a),
    destination: waypoint(b),
    travelMode: TRAVEL_MODE[mode],
    languageCode: 'es',
  };
  if (departure_time && mode !== 'walk') body.departureTime = departure_time;
  return cached(`route:${JSON.stringify(body)}`, async () => {
    const res = await googleFetch<{
      routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
    }>(ROUTES_URL, { method: 'POST', fieldMask: ROUTES_MASK, body });
    const r = res.routes?.[0];
    if (!r) return null;
    const secs = Number.parseFloat((r.duration ?? '0s').replace('s', ''));
    return {
      duration_min: Math.max(1, Math.round(secs / 60)),
      distance_m: r.distanceMeters ?? 0,
      polyline: r.polyline?.encodedPolyline ?? null,
    };
  });
}

/**
 * Ruta entre paradas consecutivas. Con GOOGLE_MAPS_API_KEY usa Routes; sin key estima por distancia
 * (solo si todas las paradas traen lat/lng; si no → not_configured).
 */
export async function computeRoute(stops: Stop[], mode: RouteMode, departure_time?: string): Promise<RouteResult> {
  const pairs = stops.slice(0, -1).map((s, i) => [s, stops[i + 1], i] as const);
  if (!env().GOOGLE_MAPS_API_KEY) {
    if (!stops.every(hasCoords)) throw notConfigured('Google Maps (GOOGLE_MAPS_API_KEY)');
    const segments = pairs.map(([a, b, i]) => ({
      from_idx: i,
      to_idx: i + 1,
      ...estimateMinutes(a as { lat: number; lng: number }, b as { lat: number; lng: number }, mode),
      polyline: null,
    }));
    return { segments, total_min: segments.reduce((t, s) => t + s.duration_min, 0), estimated: true };
  }
  const results = await Promise.all(pairs.map(([a, b]) => googleSegment(a, b, mode, departure_time)));
  const segments: Segment[] = results.map((r, i) => {
    if (r) return { from_idx: i, to_idx: i + 1, ...r };
    // Google no encontró ruta (p. ej. transit sin servicio): estimamos si hay coordenadas.
    const a = stops[i];
    const b = stops[i + 1];
    const est = hasCoords(a) && hasCoords(b) ? estimateMinutes(a, b, mode) : { duration_min: 0, distance_m: 0 };
    return { from_idx: i, to_idx: i + 1, ...est, polyline: null };
  });
  return { segments, total_min: segments.reduce((t, s) => t + s.duration_min, 0) };
}

/**
 * Minutos de traslado entre dos puntos para recalcular horarios: a pie, o en transporte si a pie > 30 min.
 * Nunca falla: si Google falla o no está configurado, estima por distancia.
 */
export async function travelMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<number> {
  try {
    const walk = await computeRoute([a, b], 'walk');
    const w = walk.total_min;
    if (w <= 30) return w;
    try {
      const transit = await computeRoute([a, b], 'transit');
      return transit.total_min > 0 ? Math.min(w, transit.total_min) : w;
    } catch {
      return w;
    }
  } catch {
    return estimateMinutes(a, b, 'walk').duration_min;
  }
}
