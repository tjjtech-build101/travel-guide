// PRD 07 · Motor del tour en vivo. PURO: sin UI, sin timers, sin red. Recibe muestras de ubicación (LocationProvider,
// real o simulado: se comportan igual) y ticks de reloj, y devuelve eventos. El estado es JSON (AsyncStorage).
//
// Reglas (PRD 07, criterios de aceptación):
//  - Llegada con histéresis: entrar al radio (geofence_radius_m) = llegada; salir requiere radio + 20 m.
//    Nunca dos arrived_stop de la misma parada en 5 min; una parada ya visitada solo se repite si se alejó y volvió
//    (sin llegar a otra en el medio), no al pasar por al lado camino a otra.
//  - Orden flexible: llegar a una parada que no es la primera pendiente → order_changed:true (las otras siguen pendientes).
//  - Desvío: > 150 m de la ruta durante ≥ 30 s seguidos → left_route UNA vez; se rearma al volver a < 100 m.
//  - Reloj: time_warning cuando quedan 30 y 10 min, y cuando lo necesario supera lo restante + 5 min
//    (máx. 1 cada 10 min), con suggest_skip.
//  - Permanencia: dwell a los 90 s (ofrecer `more`) y a los 240 s (ofrecer `secret`) dentro del radio.
//  - Silencio inteligente: ≥ 90 s entre eventos proactivos (arrived_stop no espera, pero cuenta); nada si va a
//    > 2,5 m/s por más de 20 s (va en un vehículo). Lo que no se puede decir se difiere (se reevalúa después).
import { distanceMeters } from './location';
import type { TourProgress } from './tools/tour';

type LatLng = { lat: number; lng: number };

export const TOUR_ENGINE = {
  /** Salir de la parada = radio + esto. */
  EXIT_MARGIN_M: 20,
  /** Re-llegada a la misma parada. */
  REARRIVE_MS: 5 * 60_000,
  OFF_ROUTE_M: 150,
  OFF_ROUTE_REARM_M: 100,
  OFF_ROUTE_MS: 30_000,
  TIME_THRESHOLDS_MIN: [30, 10] as const,
  OVERRUN_MARGIN_MIN: 5,
  OVERRUN_EVERY_MS: 10 * 60_000,
  DWELL_S: [90, 240] as const,
  PROACTIVE_GAP_MS: 90_000,
  VEHICLE_SPEED_MPS: 2.5,
  VEHICLE_MS: 20_000,
  /** Caminata: 4,5 km/h y 25 % de rodeo sobre la línea recta. */
  WALK_M_PER_MIN: 75,
  DETOUR: 1.25,
} as const;

export type EngineStop = {
  stop_id: string;
  place_id: string | null;
  name: string;
  sort_order: number;
  lat: number;
  lng: number;
  radius_m: number;
  dwell_min: number;
};

export type EngineTour = {
  tour_id: string;
  stops: EngineStop[];
  /** Nombres para el payload de arrived_stop (grupo en un celu). */
  participants: string[];
  /** Polilínea de la ruta (tours.route) si existe; si no, segmentos rectos entre paradas. */
  route?: LatLng[] | null;
};

export type EngineFix = { t: number; lat: number; lng: number; speed?: number | null; accuracy?: number | null };

export type StopVisit = { arrivedAt: number; leftAt: number | null; layersTold: string[] };

export type EngineStatus = 'waiting' | 'active' | 'off_route' | 'done';

export type EngineState = {
  status: EngineStatus;
  /** Parada en la que está (dentro del radio) o la última a la que llegó. */
  currentStopId: string | null;
  visited: Record<string, StopVisit>;
  skipped: string[];
  startedAt: number;
  endsAt: number;
  /** Capas contadas por parada (content_told + lo narrado en esta sesión). */
  told: Record<string, string[]>;
  // ---- internos ----
  insideStopId: string | null;
  lastArrivalAt: Record<string, number>;
  dwellFired: Record<string, number[]>;
  offRouteSince: number | null;
  leftRouteFired: boolean;
  lastProactiveAt: number | null;
  timeWarnings: number[];
  lastTimeWarningAt: number | null;
  fastSince: number | null;
  lastFix: EngineFix | null;
  doneFired: boolean;
};

export type ArrivedStopPayload = {
  stop_id: string;
  place_id: string | null;
  name: string;
  sort_order: number;
  order_changed: boolean;
  layers_told: string[];
  remaining_min: number;
  pending_stops: number;
  participants: string[];
};
export type LeftRoutePayload = {
  distance_m: number;
  off_route_s: number;
  nearest_pending_stop: { stop_id: string; name: string; distance_m: number } | null;
};
export type TimeWarningPayload = {
  remaining_min: number;
  pending_stops: number;
  est_needed_min: number;
  suggest_skip: { stop_id: string; name: string; saves_min: number }[];
};
export type DwellPayload = { stop_id: string; dwell_s: number; layers_told: string[] };

/** Eventos que van a la voz (`[EVENTO:<tipo>] <json>`). */
export type TourVoiceEvent =
  | { type: 'arrived_stop'; payload: ArrivedStopPayload }
  | { type: 'left_route'; payload: LeftRoutePayload }
  | { type: 'time_warning'; payload: TimeWarningPayload }
  | { type: 'dwell'; payload: DwellPayload };

/** Eventos internos (la app actualiza la UI / el progreso; no se inyectan). */
export type TourInternalEvent =
  | { type: 'left_stop'; stop_id: string }
  | { type: 'back_on_route' }
  | { type: 'tour_done' };

export type TourEngineEvent = TourVoiceEvent | TourInternalEvent;

export const TOUR_VOICE_EVENT_TYPES = ['arrived_stop', 'left_route', 'time_warning', 'dwell'] as const;

export function isVoiceEngineEvent(e: TourEngineEvent): e is TourVoiceEvent {
  return (TOUR_VOICE_EVENT_TYPES as readonly string[]).includes(e.type);
}

export type EngineResult = { state: EngineState; events: TourEngineEvent[] };

// ---------------------------------------------------------------- estado

export function createEngineState(
  tour: EngineTour,
  opts: { startedAt: number; endsAt: number; told?: Record<string, string[]>; progress?: TourProgress | null },
): EngineState {
  const s: EngineState = {
    status: 'waiting',
    currentStopId: null,
    visited: {},
    skipped: [],
    startedAt: opts.startedAt,
    endsAt: opts.endsAt,
    told: { ...(opts.told ?? {}) },
    insideStopId: null,
    lastArrivalAt: {},
    dwellFired: {},
    offRouteSince: null,
    leftRouteFired: false,
    lastProactiveAt: null,
    timeWarnings: [],
    lastTimeWarningAt: null,
    fastSince: null,
    lastFix: null,
    doneFired: false,
  };
  const p = opts.progress;
  if (p) {
    const ids = new Set(tour.stops.map((x) => x.stop_id));
    for (const v of p.visited) {
      if (!ids.has(v.stop_id)) continue;
      const arrivedAt = Date.parse(v.arrived_at);
      s.visited[v.stop_id] = {
        arrivedAt: Number.isFinite(arrivedAt) ? arrivedAt : opts.startedAt,
        leftAt: v.left_at ? Date.parse(v.left_at) : null,
        layersTold: s.told[v.stop_id] ?? [],
      };
    }
    s.skipped = p.skipped.filter((id) => ids.has(id));
    if (Object.keys(s.visited).length) {
      s.status = 'active';
      s.currentStopId = p.current_stop_id && ids.has(p.current_stop_id) ? p.current_stop_id : null;
    }
  }
  return s;
}

/** Forma de `tours.progress` (Contratos v1.1) para tour_status. */
export function engineProgress(tour: EngineTour, s: EngineState): TourProgress {
  const iso = (ms: number) => new Date(ms).toISOString();
  const next = nextStop(tour, s);
  return {
    current_stop_id: s.insideStopId ?? next?.stop_id ?? null,
    visited: Object.entries(s.visited).map(([stop_id, v]) => ({
      stop_id,
      arrived_at: iso(v.arrivedAt),
      left_at: v.leftAt != null ? iso(v.leftAt) : null,
    })),
    skipped: [...s.skipped],
    started_at: iso(s.startedAt),
    ends_at: iso(s.endsAt),
  };
}

// ---------------------------------------------------------------- consultas

const byOrder = (a: EngineStop, b: EngineStop) => a.sort_order - b.sort_order;

/** Paradas que faltan (ni visitadas ni salteadas), en orden. */
export function pendingEngineStops(tour: EngineTour, s: EngineState): EngineStop[] {
  return [...tour.stops].sort(byOrder).filter((x) => !s.visited[x.stop_id] && !s.skipped.includes(x.stop_id));
}

/** Próxima parada: la primera pendiente (la del radio en el que estás no cuenta). */
export function nextStop(tour: EngineTour, s: EngineState): EngineStop | null {
  return pendingEngineStops(tour, s).find((x) => x.stop_id !== s.insideStopId) ?? null;
}

export function remainingMinutes(s: EngineState, now: number): number {
  return Math.max(0, Math.round((s.endsAt - now) / 60_000));
}

export const walkMinutes = (m: number) => Math.max(1, Math.round((m * TOUR_ENGINE.DETOUR) / TOUR_ENGINE.WALK_M_PER_MIN));

/** Minutos que hacen falta para terminar: caminar por las pendientes en orden + permanencia en cada una. */
export function estimateNeededMin(from: LatLng | null, pending: EngineStop[]): number {
  if (!pending.length) return 0;
  let meters = 0;
  let prev: LatLng | null = from;
  for (const p of pending) {
    if (prev) meters += distanceMeters(prev, p);
    prev = p;
  }
  const walk = meters ? (meters * TOUR_ENGINE.DETOUR) / TOUR_ENGINE.WALK_M_PER_MIN : 0;
  return Math.round(walk + pending.reduce((t, p) => t + p.dwell_min, 0));
}

/** Qué saltear para llegar: lo que más ahorra (permanencia + rodeo), hasta que alcance (máx. 3). */
export function suggestSkips(
  from: LatLng | null,
  pending: EngineStop[],
  remainingMin: number,
): { stop_id: string; name: string; saves_min: number }[] {
  const need = estimateNeededMin(from, pending);
  if (need <= remainingMin) return [];
  const saves = pending.map((p, i) => {
    const prev: LatLng | null = i === 0 ? from : pending[i - 1];
    const next = pending[i + 1] ?? null;
    let detourM = 0;
    if (prev) detourM += distanceMeters(prev, p);
    if (next) detourM += distanceMeters(p, next);
    if (prev && next) detourM -= distanceMeters(prev, next);
    const walk = (Math.max(0, detourM) * TOUR_ENGINE.DETOUR) / TOUR_ENGINE.WALK_M_PER_MIN;
    return { stop_id: p.stop_id, name: p.name, saves_min: Math.max(1, Math.round(p.dwell_min + walk)) };
  });
  saves.sort((a, b) => b.saves_min - a.saves_min);
  const out: typeof saves = [];
  let left = need;
  for (const x of saves) {
    if (left <= remainingMin || out.length >= 3) break;
    out.push(x);
    left -= x.saves_min;
  }
  return out;
}

/** Distancia (m) de `p` a una polilínea (proyección local equirectangular: alcanza a escala de ciudad). */
export function distanceToPolylineM(p: LatLng, pts: LatLng[]): number {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return distanceMeters(p, pts[0]);
  const k = Math.cos((p.lat * Math.PI) / 180);
  const R = 6_371_000;
  const xy = (q: LatLng) => ({ x: ((q.lng - p.lng) * Math.PI * R * k) / 180, y: ((q.lat - p.lat) * Math.PI * R) / 180 });
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = xy(pts[i]);
    const b = xy(pts[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * f, a.y + dy * f));
  }
  return best;
}

/** Ruta para medir desvíos: tours.route si hay; si no, las paradas no salteadas en orden. */
export function routeLine(tour: EngineTour, s: EngineState): LatLng[] {
  if (tour.route && tour.route.length >= 2) return tour.route;
  return [...tour.stops].sort(byOrder).filter((x) => !s.skipped.includes(x.stop_id));
}

// ---------------------------------------------------------------- pasos

function clone(s: EngineState): EngineState {
  return {
    ...s,
    visited: Object.fromEntries(Object.entries(s.visited).map(([k, v]) => [k, { ...v, layersTold: [...v.layersTold] }])),
    skipped: [...s.skipped],
    told: Object.fromEntries(Object.entries(s.told).map(([k, v]) => [k, [...v]])),
    lastArrivalAt: { ...s.lastArrivalAt },
    dwellFired: Object.fromEntries(Object.entries(s.dwellFired).map(([k, v]) => [k, [...v]])),
    timeWarnings: [...s.timeWarnings],
  };
}

const inVehicle = (s: EngineState, t: number) => s.fastSince != null && t - s.fastSince > TOUR_ENGINE.VEHICLE_MS;

/** ¿Se puede decir algo proactivo ahora? */
function canSpeak(s: EngineState, t: number): boolean {
  if (inVehicle(s, t)) return false;
  return s.lastProactiveAt == null || t - s.lastProactiveAt >= TOUR_ENGINE.PROACTIVE_GAP_MS;
}

function layersOf(s: EngineState, stopId: string): string[] {
  return [...(s.told[stopId] ?? [])];
}

/** Nueva muestra de ubicación. */
export function engineOnFix(tour: EngineTour, prev: EngineState, fix: EngineFix): EngineResult {
  const s = clone(prev);
  const events: TourEngineEvent[] = [];
  if (s.status === 'done') {
    s.lastFix = fix;
    return { state: s, events };
  }
  const t = fix.t;

  // 1) Velocidad (vehículo): la del fix o la derivada de la muestra anterior.
  let speed = fix.speed ?? null;
  if ((speed == null || speed < 0) && s.lastFix && t - s.lastFix.t >= 1000) {
    speed = distanceMeters(s.lastFix, fix) / ((t - s.lastFix.t) / 1000);
  }
  if (speed != null && speed > TOUR_ENGINE.VEHICLE_SPEED_MPS) s.fastSince = s.fastSince ?? t;
  else s.fastSince = null;

  // 2) Salida de la parada (histéresis).
  if (s.insideStopId) {
    const st = tour.stops.find((x) => x.stop_id === s.insideStopId);
    if (!st || distanceMeters(fix, st) > st.radius_m + TOUR_ENGINE.EXIT_MARGIN_M) {
      const id = s.insideStopId;
      s.insideStopId = null;
      if (s.visited[id]) s.visited[id].leftAt = t;
      events.push({ type: 'left_stop', stop_id: id });
    }
  }

  // 3) Llegada: la parada no salteada más cercana dentro de su radio.
  if (!s.insideStopId && !inVehicle(s, t)) {
    let hit: EngineStop | null = null;
    let hitD = Infinity;
    for (const st of tour.stops) {
      if (s.skipped.includes(st.stop_id)) continue;
      const d = distanceMeters(fix, st);
      if (d <= st.radius_m && d < hitD) {
        hit = st;
        hitD = d;
      }
    }
    if (hit) {
      s.insideStopId = hit.stop_id;
      const last = s.lastArrivalAt[hit.stop_id];
      // Re-llegada a una visitada: solo si pasaron 5 min y no llegó a otra parada en el medio (se alejó y volvió).
      // Pasar de nuevo por una parada ya contada camino a otra no la vuelve a narrar.
      const revisit = !!s.visited[hit.stop_id];
      const canRearrive = !revisit || (s.currentStopId === hit.stop_id && last != null && t - last >= TOUR_ENGINE.REARRIVE_MS);
      if (canRearrive && (last == null || t - last >= TOUR_ENGINE.REARRIVE_MS)) {
        const firstPending = pendingEngineStops(tour, s)[0];
        const orderChanged = !!firstPending && firstPending.stop_id !== hit.stop_id && !s.visited[hit.stop_id];
        const told = layersOf(s, hit.stop_id);
        s.visited[hit.stop_id] = s.visited[hit.stop_id]
          ? { ...s.visited[hit.stop_id], leftAt: null, layersTold: told }
          : { arrivedAt: t, leftAt: null, layersTold: told };
        s.lastArrivalAt[hit.stop_id] = t;
        s.dwellFired[hit.stop_id] = [];
        s.currentStopId = hit.stop_id;
        s.status = 'active';
        s.offRouteSince = null;
        if (s.leftRouteFired) {
          s.leftRouteFired = false;
          events.push({ type: 'back_on_route' });
        }
        s.lastProactiveAt = t;
        events.push({
          type: 'arrived_stop',
          payload: {
            stop_id: hit.stop_id,
            place_id: hit.place_id,
            name: hit.name,
            sort_order: hit.sort_order,
            order_changed: orderChanged,
            layers_told: told,
            remaining_min: remainingMinutes(s, t),
            pending_stops: pendingEngineStops(tour, s).length,
            participants: tour.participants,
          },
        });
      }
    }
  }

  // 4) Desvío (no mientras espera en el punto de inicio).
  if (s.status === 'active' || s.status === 'off_route') {
    const d = distanceToPolylineM(fix, routeLine(tour, s));
    if (d > TOUR_ENGINE.OFF_ROUTE_M) {
      s.offRouteSince = s.offRouteSince ?? t;
    } else {
      s.offRouteSince = null;
      if (d < TOUR_ENGINE.OFF_ROUTE_REARM_M && s.leftRouteFired) {
        s.leftRouteFired = false;
        s.status = 'active';
        events.push({ type: 'back_on_route' });
      }
    }
  }
  s.lastFix = { t, lat: fix.lat, lng: fix.lng, speed: speed ?? null, accuracy: fix.accuracy ?? null };

  // 5) Lo que depende del tiempo (desvío sostenido, permanencia, reloj, fin).
  const timed = timeChecks(tour, s, t);
  return { state: timed.state, events: [...events, ...timed.events] };
}

/** Tick de reloj (cada ~15 s; en iOS en segundo plano solo corre con muestras de ubicación). */
export function engineTick(tour: EngineTour, prev: EngineState, now: number): EngineResult {
  if (prev.status === 'done') return { state: prev, events: [] };
  return timeChecks(tour, clone(prev), now);
}

function timeChecks(tour: EngineTour, s: EngineState, t: number): EngineResult {
  const events: TourEngineEvent[] = [];
  const here = s.lastFix;

  // Desvío sostenido → left_route una vez.
  if (s.offRouteSince != null && !s.leftRouteFired && t - s.offRouteSince >= TOUR_ENGINE.OFF_ROUTE_MS && here && canSpeak(s, t)) {
    const pending = pendingEngineStops(tour, s);
    let nearest: LeftRoutePayload['nearest_pending_stop'] = null;
    for (const p of pending) {
      const d = Math.round(distanceMeters(here, p));
      if (!nearest || d < nearest.distance_m) nearest = { stop_id: p.stop_id, name: p.name, distance_m: d };
    }
    s.leftRouteFired = true;
    s.status = 'off_route';
    s.lastProactiveAt = t;
    events.push({
      type: 'left_route',
      payload: {
        distance_m: Math.round(distanceToPolylineM(here, routeLine(tour, s))),
        off_route_s: Math.round((t - s.offRouteSince) / 1000),
        nearest_pending_stop: nearest,
      },
    });
  }

  // Permanencia en la parada.
  if (s.insideStopId) {
    const id = s.insideStopId;
    const base = s.lastArrivalAt[id];
    const fired = s.dwellFired[id] ?? [];
    if (base != null) {
      for (const th of TOUR_ENGINE.DWELL_S) {
        if (fired.includes(th) || t - base < th * 1000) continue;
        const layer = th === TOUR_ENGINE.DWELL_S[0] ? 'more' : 'secret';
        if (layersOf(s, id).includes(layer)) {
          fired.push(th); // ya la contó: no hay nada que ofrecer
          continue;
        }
        if (!canSpeak(s, t)) break;
        fired.push(th);
        s.lastProactiveAt = t;
        events.push({ type: 'dwell', payload: { stop_id: id, dwell_s: Math.round((t - base) / 1000), layers_told: layersOf(s, id) } });
        break;
      }
      s.dwellFired[id] = fired;
    }
  }

  // Reloj (no mientras espera en el punto de inicio: el guía no habla hasta la primera llegada).
  const pending = pendingEngineStops(tour, s);
  if (pending.length && s.status !== 'waiting') {
    const remaining = remainingMinutes(s, t);
    const totalMin = (s.endsAt - s.startedAt) / 60_000;
    // Un tour de 30 min no avisa "quedan 30" al arrancar: solo umbrales menores a la duración.
    const crossed = TOUR_ENGINE.TIME_THRESHOLDS_MIN.filter((th) => th < totalMin - 1 && remaining <= th && !s.timeWarnings.includes(th));
    const from = here ?? (s.insideStopId ? tour.stops.find((x) => x.stop_id === s.insideStopId) ?? null : null);
    const need = estimateNeededMin(from, pending);
    const overrun =
      need > remaining + TOUR_ENGINE.OVERRUN_MARGIN_MIN &&
      (s.lastTimeWarningAt == null || t - s.lastTimeWarningAt >= TOUR_ENGINE.OVERRUN_EVERY_MS);
    if ((crossed.length || overrun) && canSpeak(s, t)) {
      s.timeWarnings.push(...crossed);
      s.lastTimeWarningAt = t;
      s.lastProactiveAt = t;
      events.push({
        type: 'time_warning',
        payload: {
          remaining_min: remaining,
          pending_stops: pending.length,
          est_needed_min: need,
          suggest_skip: suggestSkips(from, pending, remaining),
        },
      });
    }
  }

  // Fin: todas visitadas o salteadas y ya salió de la última.
  if (!pending.length && !s.insideStopId && !s.doneFired && Object.keys(s.visited).length) {
    s.doneFired = true;
    s.status = 'done';
    events.push({ type: 'tour_done' });
  }
  return { state: s, events };
}

/** Saltear una parada (botón o skip_stop aceptado por voz). */
export function engineSkip(tour: EngineTour, prev: EngineState, stopId: string): EngineState {
  if (!tour.stops.some((x) => x.stop_id === stopId) || prev.skipped.includes(stopId)) return prev;
  const s = clone(prev);
  s.skipped.push(stopId);
  return s;
}

/** La capa ya se contó (get_stop_content): el próximo arrived_stop/dwell la lleva en layers_told. */
export function engineMarkTold(prev: EngineState, stopId: string, layer: string): EngineState {
  if ((prev.told[stopId] ?? []).includes(layer)) return prev;
  const s = clone(prev);
  s.told[stopId] = [...(s.told[stopId] ?? []), layer];
  if (s.visited[stopId]) s.visited[stopId].layersTold = [...s.told[stopId]];
  return s;
}

/** Terminar a mano. */
export function engineFinish(prev: EngineState): EngineState {
  return { ...clone(prev), status: 'done', doneFired: true, insideStopId: null };
}

/** Lo que muestra la UI: próxima parada, distancia, minutos a pie, restante. */
export function engineView(tour: EngineTour, s: EngineState, here: LatLng | null, now: number) {
  const next = nextStop(tour, s);
  const distanceM = next && here ? Math.round(distanceMeters(here, next)) : null;
  const inside = s.insideStopId ? (tour.stops.find((x) => x.stop_id === s.insideStopId) ?? null) : null;
  return {
    status: s.status,
    inside,
    next,
    distanceM,
    walkMin: distanceM != null ? walkMinutes(distanceM) : null,
    remainingMin: remainingMinutes(s, now),
    pending: pendingEngineStops(tour, s).length,
    visited: Object.keys(s.visited).length,
    skipped: s.skipped.length,
    total: tour.stops.length,
  };
}
