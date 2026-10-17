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

// ───────── Transporte público con detalle (traslados del itinerario, PRD 01/02)

const TRANSIT_MASK =
  'routes.duration,routes.distanceMeters,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails';

type GStep = {
  travelMode?: string;
  staticDuration?: string;
  transitDetails?: {
    stopDetails?: { departureStop?: { name?: string }; arrivalStop?: { name?: string }; departureTime?: string; arrivalTime?: string };
    localizedValues?: { departureTime?: { time?: { text?: string } }; arrivalTime?: { time?: { text?: string } } };
    headsign?: string;
    stopCount?: number;
    transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } };
  };
};
export type GTransitResponse = { routes?: { duration?: string; distanceMeters?: number; legs?: { steps?: GStep[] }[] }[] };

export type TransitPlan = {
  duration_min: number;
  walk_min: number;
  lines: {
    name: string;
    vehicle: 'bus' | 'subway' | 'train' | 'tram' | 'ferry' | 'other';
    from_stop?: string;
    to_stop?: string;
    departure?: string;
    arrival?: string;
    headsign?: string;
    stops?: number;
  }[];
};

const VEHICLE: Record<string, TransitPlan['lines'][number]['vehicle']> = {
  BUS: 'bus',
  INTERCITY_BUS: 'bus',
  TROLLEYBUS: 'bus',
  SHARE_TAXI: 'bus',
  SUBWAY: 'subway',
  METRO_RAIL: 'subway',
  HEAVY_RAIL: 'train',
  COMMUTER_TRAIN: 'train',
  HIGH_SPEED_TRAIN: 'train',
  LONG_DISTANCE_TRAIN: 'train',
  RAIL: 'train',
  TRAM: 'tram',
  LIGHT_RAIL: 'tram',
  MONORAIL: 'tram',
  FERRY: 'ferry',
};

const secs = (d: string | undefined) => Number.parseFloat((d ?? '0s').replace('s', '')) || 0;

/** "18:05" desde el texto localizado ("6:05 p.m." / "18:05") o el ISO (en la zona de Montevideo/BA, UTC−3). */
export function hhmm(localized: string | undefined, iso: string | undefined): string | undefined {
  const m = localized?.match(/(\d{1,2}):(\d{2})\s*(a|p)?/i);
  if (m) {
    let h = Number(m[1]);
    const ap = m[3]?.toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  if (!iso) return undefined;
  const d = new Date(Date.parse(iso) - 3 * 3600_000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(11, 16);
}

/** Respuesta de computeRoutes TRANSIT → plan con líneas. null si la ruta no usa transporte (o no hay ruta). */
export function parseTransit(res: GTransitResponse): TransitPlan | null {
  const r = res.routes?.[0];
  if (!r) return null;
  const steps = (r.legs ?? []).flatMap((l) => l.steps ?? []);
  const lines: TransitPlan['lines'] = [];
  let walkS = 0;
  for (const s of steps) {
    if (s.travelMode === 'TRANSIT' && s.transitDetails) {
      const t = s.transitDetails;
      const name = t.transitLine?.nameShort || t.transitLine?.name;
      if (!name) continue;
      lines.push({
        name,
        vehicle: VEHICLE[t.transitLine?.vehicle?.type ?? ''] ?? 'other',
        from_stop: t.stopDetails?.departureStop?.name,
        to_stop: t.stopDetails?.arrivalStop?.name,
        departure: hhmm(t.localizedValues?.departureTime?.time?.text, t.stopDetails?.departureTime),
        arrival: hhmm(t.localizedValues?.arrivalTime?.time?.text, t.stopDetails?.arrivalTime),
        headsign: t.headsign,
        stops: t.stopCount,
      });
    } else if (s.travelMode === 'WALK') {
      walkS += secs(s.staticDuration);
    }
  }
  if (!lines.length) return null;
  return { duration_min: Math.max(1, Math.round(secs(r.duration) / 60)), walk_min: Math.round(walkS / 60), lines };
}

/** Transporte público con líneas (requiere GOOGLE_MAPS_API_KEY). departure_time: ISO con zona. */
export async function transitPlan(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  departure_time?: string,
): Promise<TransitPlan | null> {
  if (!env().GOOGLE_MAPS_API_KEY) return null;
  const body: Record<string, unknown> = {
    origin: waypoint(a),
    destination: waypoint(b),
    travelMode: 'TRANSIT',
    languageCode: 'es',
    ...(departure_time ? { departureTime: departure_time } : {}),
  };
  return cached(`transit:${JSON.stringify(body)}`, async () => {
    const res = await googleFetch<GTransitResponse>(ROUTES_URL, { method: 'POST', fieldMask: TRANSIT_MASK, body });
    return parseTransit(res);
  });
}

/** Link de Google Maps en modo transporte público (botón "Cómo llego"). */
export function mapsTransitUrl(a: { lat: number; lng: number }, b: { lat: number; lng: number }, mode: 'transit' | 'walking' = 'transit'): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
}
