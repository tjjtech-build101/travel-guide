// Google Routes computeRoutes (pares en paralelo) + estimación por distancia si no hay key.
import { distanceMeters, type RouteDetail, type RouteMode, type RouteStepDetail } from '@build101/shared';
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
  /** Caminata hasta la primera parada y desde la última (para alinear el bloque con el horario real). */
  walk_before_min?: number;
  walk_after_min?: number;
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

/** transitDetails de un paso de Google → línea (null si no tiene nombre). */
function transitLine(t: NonNullable<GStep['transitDetails']>): TransitPlan['lines'][number] | null {
  const name = t.transitLine?.nameShort || t.transitLine?.name;
  if (!name) return null;
  return rideFields(t, name);
}

function rideFields(t: GStep['transitDetails'], name: string): TransitPlan['lines'][number] {
  return {
    name,
    vehicle: VEHICLE[t?.transitLine?.vehicle?.type ?? ''] ?? 'other',
    from_stop: t?.stopDetails?.departureStop?.name,
    to_stop: t?.stopDetails?.arrivalStop?.name,
    departure: hhmm(t?.localizedValues?.departureTime?.time?.text, t?.stopDetails?.departureTime),
    arrival: hhmm(t?.localizedValues?.arrivalTime?.time?.text, t?.stopDetails?.arrivalTime),
    headsign: t?.headsign,
    stops: t?.stopCount,
  };
}

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
  let beforeS = 0;
  let afterS = 0;
  for (const s of steps) {
    if (s.travelMode === 'TRANSIT' && s.transitDetails) {
      const line = transitLine(s.transitDetails);
      if (!line) continue;
      lines.push(line);
      afterS = 0; // lo caminado antes de este tramo ya no es "después"
    } else if (s.travelMode === 'WALK') {
      const w = secs(s.staticDuration);
      walkS += w;
      if (!lines.length) beforeS += w;
      else afterS += w;
    }
  }
  if (!lines.length) return null;
  return {
    duration_min: Math.max(1, Math.round(secs(r.duration) / 60)),
    walk_min: Math.round(walkS / 60),
    walk_before_min: Math.round(beforeS / 60),
    walk_after_min: Math.round(afterS / 60),
    lines,
  };
}

/** Transporte público con líneas (requiere GOOGLE_MAPS_API_KEY). departure_time: ISO con zona. */
export async function transitPlan(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  when?: string | { departure?: string; arrival?: string },
): Promise<TransitPlan | null> {
  if (!env().GOOGLE_MAPS_API_KEY) return null;
  const w = typeof when === 'string' ? { departure: when } : (when ?? {});
  const body: Record<string, unknown> = {
    origin: waypoint(a),
    destination: waypoint(b),
    travelMode: 'TRANSIT',
    languageCode: 'es',
    // TRANSIT acepta "salir a las" o "llegar a las" (no las dos).
    ...(w.arrival ? { arrivalTime: w.arrival } : w.departure ? { departureTime: w.departure } : {}),
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

// ───────── Ruta detallada para "Cómo llego" embebido en Ahora (route_eta con detail: true)

const DETAIL_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails',
].join(',');

type GLatLng = { latLng?: { latitude?: number; longitude?: number } };
type GDetailStep = GStep & {
  distanceMeters?: number;
  startLocation?: GLatLng;
  endLocation?: GLatLng;
  navigationInstruction?: { maneuver?: string; instructions?: string };
};
export type GDetailResponse = {
  routes?: {
    duration?: string;
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    legs?: { steps?: GDetailStep[] }[];
  }[];
};

type Pt = { lat: number; lng: number };
const STEP_MODE: Record<string, RouteMode> = { WALK: 'walk', DRIVE: 'car', TRANSIT: 'transit' };
const VERB: Record<RouteMode, string> = { walk: 'Caminá', car: 'Manejá', transit: 'Andá' };
const VEHICLE_LABEL: Record<NonNullable<RouteStepDetail['transit']>['vehicle'], string> = {
  bus: 'el bus',
  subway: 'el subte',
  train: 'el tren',
  tram: 'el tranvía',
  ferry: 'el ferry',
  other: 'la línea',
};

const toMin = (s: number) => Math.round(s / 60);
const dest = (name?: string) => name?.trim() || 'tu destino';
const pt = (l: GLatLng | undefined, fallback: Pt): Pt =>
  typeof l?.latLng?.latitude === 'number' && typeof l.latLng.longitude === 'number'
    ? { lat: l.latLng.latitude, lng: l.latLng.longitude }
    : fallback;

/** Sin Google (o si falla): un solo paso en línea recta ("Caminá hacia tu destino"). */
export function estimatedDetail(a: Pt, b: Pt, mode: RouteMode, destName?: string): RouteDetail {
  const est = estimateMinutes(a, b, mode);
  return {
    mode,
    ...est,
    polyline: null,
    estimated: true,
    steps: [{ instruction: `${VERB[mode]} hacia ${dest(destName)}`, maneuver: null, ...est, start: a, end: b, mode }],
  };
}

/** Nombre de un vehículo sin línea ("Bus", "Tren"): así igual se ve como tramo en vehículo y no como caminata. */
const VEHICLE_NAME: Record<NonNullable<RouteStepDetail['transit']>['vehicle'], string> = {
  bus: 'Bus',
  subway: 'Subte',
  train: 'Tren',
  tram: 'Tranvía',
  ferry: 'Ferry',
  other: 'Línea',
};

/** Instrucción de un paso en vehículo: "Tomá el bus 121 hacia Pocitos" ("Tomá el bus" si la línea no tiene nombre). */
function rideInstruction(t: NonNullable<RouteStepDetail['transit']>): string {
  const line = t.line === VEHICLE_NAME[t.vehicle] ? '' : ` ${t.line}`;
  return `Tomá ${VEHICLE_LABEL[t.vehicle]}${line}${t.headsign ? ` hacia ${t.headsign}` : ''}`;
}

/** Paso TRANSIT de Google → línea; siempre devuelve una (sin nombre, el tipo de vehículo). */
function rideLine(t: GStep['transitDetails']): TransitPlan['lines'][number] {
  const named = t ? transitLine(t) : null;
  if (named) return named;
  const vehicle = VEHICLE[t?.transitLine?.vehicle?.type ?? ''] ?? 'other';
  return rideFields(t, VEHICLE_NAME[vehicle]);
}

/**
 * Respuesta de computeRoutes → RouteDetail. null si no hay ruta.
 * En transit los pasos a pie seguidos se agrupan en uno ("Caminá 4 min hasta la parada X").
 */
export function parseRouteDetail(res: GDetailResponse, a: Pt, mode: RouteMode, destName?: string): RouteDetail | null {
  const r = res.routes?.[0];
  if (!r) return null;
  const raw = (r.legs ?? []).flatMap((l) => l.steps ?? []);
  const steps: RouteStepDetail[] = [];
  const usesTransit = mode === 'transit' && raw.some((s) => s.travelMode === 'TRANSIT');
  let prevEnd = a;

  if (!usesTransit) {
    // A pie / auto (o transit que Google resolvió caminando): los pasos de navegación tal cual.
    for (const s of raw) {
      const start = pt(s.startLocation, prevEnd);
      const stepMode = STEP_MODE[s.travelMode ?? ''] ?? mode;
      const step: RouteStepDetail = {
        instruction: s.navigationInstruction?.instructions?.trim() || `${VERB[stepMode]} hacia ${dest(destName)}`,
        maneuver: s.navigationInstruction?.maneuver ?? null,
        distance_m: s.distanceMeters ?? 0,
        duration_min: toMin(secs(s.staticDuration)),
        start,
        end: pt(s.endLocation, start),
        mode: stepMode,
      };
      steps.push(step);
      prevEnd = step.end;
    }
  } else {
    let walk: { s: number; m: number; start: Pt; end: Pt } | null = null;
    const flushWalk = (target: string) => {
      if (walk && (walk.s > 0 || walk.m > 0)) {
        const min = Math.max(1, toMin(walk.s));
        steps.push({
          instruction: `Caminá ${min} min hasta ${target}`,
          maneuver: null,
          distance_m: walk.m,
          duration_min: min,
          start: walk.start,
          end: walk.end,
          mode: 'walk',
        });
      }
      walk = null;
    };
    for (const s of raw) {
      const start = pt(s.startLocation, prevEnd);
      const end = pt(s.endLocation, start);
      prevEnd = end;
      // Todo tramo TRANSIT es vehículo, tenga o no nombre de línea: nunca se suma a la caminata.
      const line = s.travelMode === 'TRANSIT' ? rideLine(s.transitDetails) : null;
      if (line) {
        flushWalk(line.from_stop ? `la parada ${line.from_stop}` : 'la parada');
        const { name, ...rest } = line;
        const transit = { line: name, ...rest };
        steps.push({
          instruction: rideInstruction(transit),
          maneuver: null,
          distance_m: s.distanceMeters ?? 0,
          duration_min: Math.max(1, toMin(secs(s.staticDuration))),
          start,
          end,
          mode: 'transit',
          transit,
        });
      } else {
        const w = walk as { s: number; m: number; start: Pt; end: Pt } | null; // TS no ve la reasignación en flushWalk
        walk = {
          s: (w?.s ?? 0) + secs(s.staticDuration),
          m: (w?.m ?? 0) + (s.distanceMeters ?? 0),
          start: w?.start ?? start,
          end,
        };
      }
    }
    flushWalk(dest(destName));
  }

  return {
    mode,
    duration_min: Math.max(1, toMin(secs(r.duration))),
    distance_m: r.distanceMeters ?? steps.reduce((t, s) => t + s.distance_m, 0),
    polyline: r.polyline?.encodedPolyline ?? null,
    steps,
    estimated: false,
  };
}

/**
 * Ruta detallada entre dos puntos (polilínea + pasos). Nunca falla: sin GOOGLE_MAPS_API_KEY, si Google falla
 * o no encuentra ruta, devuelve la estimación en línea recta (estimated: true).
 * departure_time: ISO con zona. En auto se usa solo si es futuro (Google rechaza horas pasadas).
 */
export async function routeDetail(a: Pt, b: Pt, mode: RouteMode, departure_time?: string, destName?: string): Promise<RouteDetail> {
  if (!env().GOOGLE_MAPS_API_KEY) return estimatedDetail(a, b, mode, destName);
  const body: Record<string, unknown> = {
    origin: waypoint(a),
    destination: waypoint(b),
    travelMode: TRAVEL_MODE[mode],
    languageCode: 'es',
  };
  if (mode === 'car') {
    body.routingPreference = 'TRAFFIC_AWARE';
    if (departure_time && Date.parse(departure_time) > Date.now()) body.departureTime = departure_time;
  } else if (mode === 'transit' && departure_time) {
    body.departureTime = departure_time;
  }
  try {
    // Clave con origen/destino redondeados a 4 decimales (~10 m): el GPS casi nunca repite la coordenada exacta.
    const key = { ...body, origin: roundedPt(a), destination: roundedPt(b) };
    const detail = await cached(`route_detail:${dest(destName)}:${JSON.stringify(key)}`, async () => {
      const res = await googleFetch<GDetailResponse>(ROUTES_URL, { method: 'POST', fieldMask: DETAIL_MASK, body });
      return parseRouteDetail(res, a, mode, destName);
    });
    return detail ?? estimatedDetail(a, b, mode, destName);
  } catch (e) {
    console.warn('[routeDetail]', (e as Error).message);
    return estimatedDetail(a, b, mode, destName);
  }
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const roundedPt = (p: Pt) => ({ lat: round4(p.lat), lng: round4(p.lng) });

/**
 * Plan de transporte (líneas, caminata antes/después) desde un RouteDetail de transit, para no pedirle a Google la
 * misma ruta dos veces. null si no hay tramos en vehículo.
 */
export function transitPlanFromDetail(d: RouteDetail): TransitPlan | null {
  const lines: TransitPlan['lines'] = [];
  let walk = 0;
  let before = 0;
  let after = 0;
  for (const s of d.steps) {
    if (s.transit) {
      const { line, ...rest } = s.transit;
      lines.push({ name: line, ...rest });
      after = 0;
    } else {
      walk += s.duration_min;
      if (!lines.length) before += s.duration_min;
      else after += s.duration_min;
    }
  }
  if (!lines.length) return null;
  return { duration_min: d.duration_min, walk_min: walk, walk_before_min: before, walk_after_min: after, lines };
}

// ───────────────────────── Polilíneas (algoritmo de Google): unir los tramos de un tour en una sola

export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export function encodePolyline(points: [number, number][]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  for (const [la, ln] of points) {
    const lat = Math.round(la * 1e5);
    const lng = Math.round(ln * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

/** Une las polilíneas de cada tramo (las que falten se saltean). null si no hay ninguna. */
export function mergePolylines(polys: (string | null)[]): string | null {
  const pts = polys.filter((p): p is string => !!p).flatMap((p, k) => {
    const d = decodePolyline(p);
    return k === 0 ? d : d.slice(1);
  });
  return pts.length ? encodePolyline(pts) : null;
}
