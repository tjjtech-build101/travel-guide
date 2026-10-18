// Progreso en vivo sobre una ruta ("Cómo llego" embebido): dónde estoy sobre la polilínea, qué paso toca,
// cuánto falta, si me fui de la ruta y si llegué. Puro (sin red ni reloj propio) para testearlo y usarlo en la app.
import { distanceMeters } from './location';

type LatLng = { lat: number; lng: number };

/** Lejos de la ruta (m): a partir de acá contamos un fix "fuera de ruta". */
export const OFF_ROUTE_M = 50;
/** Llegada (m al destino). */
export const ARRIVED_M = 35;
/** Fixes seguidos fuera de ruta antes de recalcular. */
export const OFF_ROUTE_STRIKES = 2;
/** Recalcular como mucho una vez cada… (ms). */
export const REROUTE_EVERY_MS = 20_000;
/** Velocidad a pie si no viene la duración total (m/s, ~4,8 km/h). */
const WALK_MPS = 1.33;

export type ProgressStep = { end: LatLng; distance_m?: number };

export type RouteProgressInput = {
  /** Polilínea decodificada (si la ruta es estimada: [origen, destino]). */
  points: LatLng[];
  steps?: ProgressStep[];
  here: LatLng;
  /** Duración total de la ruta (min) para repartir lo que falta; si no, a pie. */
  totalMin?: number;
  arrivedM?: number;
};

export type RouteProgress = {
  /** Paso actual (índice en `steps`); -1 si no hay pasos. */
  stepIndex: number;
  /** Metros hasta el final del paso actual (= remainingM sin pasos). */
  distanceToStepEndM: number;
  remainingM: number;
  remainingMin: number;
  /** Distancia a la polilínea (m). */
  offRouteM: number;
  arrived: boolean;
  /** Metros recorridos sobre la ruta (proyección). */
  alongM: number;
};

/** Proyección local (m) alrededor de `ref`: suficiente para distancias de una ciudad. */
function toXY(p: LatLng, ref: LatLng): [number, number] {
  const k = 111_320;
  return [(p.lng - ref.lng) * Math.cos((ref.lat * Math.PI) / 180) * k, (p.lat - ref.lat) * k];
}

type Projection = { along: number; dist: number };

/** Punto más cercano de la línea a `p`, mirando solo desde `fromAlong` (m) en adelante. */
function project(points: LatLng[], cum: number[], p: LatLng, fromAlong = 0): Projection {
  if (points.length === 1) return { along: 0, dist: distanceMeters(p, points[0]) };
  let best: Projection = { along: cum[cum.length - 1], dist: Number.POSITIVE_INFINITY };
  for (let i = 0; i < points.length - 1; i++) {
    if (cum[i + 1] < fromAlong) continue;
    const [ax, ay] = toXY(points[i], p);
    const [bx, by] = toXY(points[i + 1], p);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? (-ax * dx - ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const segLen = cum[i + 1] - cum[i];
    const along = cum[i] + t * segLen;
    if (along < fromAlong) {
      // El tramo empieza antes de `fromAlong`: arrancamos la proyección en ese punto.
      t = segLen > 0 ? (fromAlong - cum[i]) / segLen : 1;
    }
    const x = ax + t * dx;
    const y = ay + t * dy;
    const dist = Math.hypot(x, y);
    if (dist < best.dist) best = { along: cum[i] + t * segLen, dist };
  }
  return best;
}

function cumulative(points: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distanceMeters(points[i - 1], points[i]));
  return cum;
}

export function routeProgress({ points, steps = [], here, totalMin, arrivedM = ARRIVED_M }: RouteProgressInput): RouteProgress {
  if (!points.length) {
    return { stepIndex: steps.length ? 0 : -1, distanceToStepEndM: 0, remainingM: 0, remainingMin: 0, offRouteM: 0, arrived: false, alongM: 0 };
  }
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  const me = project(points, cum, here);
  const alongM = me.along;
  const toDest = distanceMeters(here, points[points.length - 1]);
  const arrived = toDest <= arrivedM;
  // Si estoy cerca de la ruta, lo que falta va por la ruta; si me fui, por lo menos lo que me separa del destino.
  const remainingM = arrived ? 0 : Math.max(0, total - alongM);

  const pace = totalMin && total > 0 ? totalMin / total : 1 / (WALK_MPS * 60);
  const remainingMin = arrived ? 0 : Math.max(1, Math.ceil(remainingM * pace));

  let stepIndex = -1;
  let distanceToStepEndM = remainingM;
  if (steps.length) {
    // Fin de cada paso sobre la línea, en orden (así una ruta que vuelve sobre sí misma no confunde los pasos).
    const ends: number[] = [];
    let from = 0;
    steps.forEach((s, i) => {
      const along = i === steps.length - 1 ? total : project(points, cum, s.end, from).along;
      ends.push(along);
      from = along;
    });
    const EPS = 3;
    stepIndex = ends.findIndex((e) => e > alongM + EPS);
    if (stepIndex === -1) stepIndex = steps.length - 1;
    distanceToStepEndM = arrived ? 0 : Math.max(0, ends[stepIndex] - alongM);
  }

  return {
    stepIndex,
    distanceToStepEndM: Math.round(distanceToStepEndM),
    remainingM: Math.round(remainingM),
    remainingMin,
    offRouteM: Math.round(me.dist),
    arrived,
    alongM: Math.round(alongM),
  };
}

// ───────── Fuera de ruta → recalcular (con histéresis)

export type RerouteState = { strikes: number; lastAt: number | null };
export const INITIAL_REROUTE: RerouteState = { strikes: 0, lastAt: null };

/**
 * Un fix más: si van `OFF_ROUTE_STRIKES` seguidos a más de `OFF_ROUTE_M` y pasaron `REROUTE_EVERY_MS` desde el último
 * recálculo → `reroute: true` (y reinicia la cuenta).
 */
export function nextReroute(state: RerouteState, offRouteM: number, now: number): { state: RerouteState; reroute: boolean } {
  if (offRouteM <= OFF_ROUTE_M) return { state: { ...state, strikes: 0 }, reroute: false };
  const strikes = state.strikes + 1;
  const cooled = state.lastAt == null || now - state.lastAt >= REROUTE_EVERY_MS;
  if (strikes >= OFF_ROUTE_STRIKES && cooled) return { state: { strikes: 0, lastAt: now }, reroute: true };
  return { state: { ...state, strikes }, reroute: false };
}
