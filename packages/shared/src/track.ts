// Tracks de GPS (PRD 09): validación, reproducción (interpolación + subdivisión), suavizado y track
// sintético a partir de paradas. Todo puro: lo usan el SimulatedLocationProvider de la app, los scripts
// `track:smooth` / `track:check` y los tests.
import { z } from 'zod';

import { distanceMeters, type TrackPoint } from './location';

/** Formato del track (Contratos): `t` = segundos desde el inicio, `heading` 0–360 o null, `accuracy` en metros. */
export const TrackPointSchema = z.object({
  t: z.number().min(0),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).nullable(),
  accuracy: z.number().min(0),
});
export const TrackSchema = z.array(TrackPointSchema).min(2);
export type Track = TrackPoint[];

type LatLng = { lat: number; lng: number };

export type ParseTrackResult = { ok: true; track: Track } | { ok: false; error: string };

/** Valida un JSON (string u objeto) como track. Ordena por `t` y descarta `t` repetidos. */
export function parseTrack(input: unknown): ParseTrackResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (e) {
      return { ok: false, error: `JSON inválido: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const parsed = TrackSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? ` (en ${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue?.message ?? 'formato inválido'}${where}` };
  }
  const sorted = [...parsed.data].sort((a, b) => a.t - b.t);
  const track: Track = [];
  for (const p of sorted) {
    if (track.length && track[track.length - 1].t === p.t) continue;
    track.push(p);
  }
  if (track.length < 2) return { ok: false, error: 'El track necesita al menos 2 puntos con tiempos distintos' };
  return { ok: true, track };
}

// ---------- geometría ----------

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Rumbo de a hacia b en grados (0 = norte, sentido horario). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Interpola dos rumbos por el ángulo más corto. Si falta uno, usa el otro. */
export function lerpHeading(a: number | null, b: number | null, f: number): number | null {
  if (a == null) return b;
  if (b == null) return a;
  const diff = ((b - a + 540) % 360) - 180;
  return (a + diff * f + 360) % 360;
}

/** Media circular de rumbos (ignora null). */
export function circularMean(values: (number | null)[]): number | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const v of values) {
    if (v == null) continue;
    x += Math.cos(toRad(v));
    y += Math.sin(toRad(v));
    n++;
  }
  if (!n || (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12)) return null;
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Proyección local en metros alrededor de `origin` (equirectangular: alcanza a escala de ciudad). */
function toXY(p: LatLng, origin: LatLng) {
  const k = Math.cos(toRad(origin.lat));
  return { x: toRad(p.lng - origin.lng) * 6_371_000 * k, y: toRad(p.lat - origin.lat) * 6_371_000 };
}

// ---------- reproducción ----------

export type TrackSample = { lat: number; lng: number; heading: number | null; accuracy: number; speed: number };

/**
 * Cursor sobre un track: posición en cualquier `t` (interpolación lineal; heading por el ángulo más corto),
 * subdivisión por distancia (para no saltear geofences a 10x) y búsqueda del punto más cercano.
 */
export class TrackCursor {
  readonly track: Track;
  /** Distancia acumulada (m) hasta cada punto. */
  readonly cum: number[];
  readonly duration: number;
  readonly startT: number;

  constructor(track: Track) {
    if (track.length < 2) throw new Error('El track necesita al menos 2 puntos');
    this.track = track;
    this.startT = track[0].t;
    this.duration = track[track.length - 1].t - this.startT;
    this.cum = [0];
    for (let i = 1; i < track.length; i++) this.cum.push(this.cum[i - 1] + distanceMeters(track[i - 1], track[i]));
  }

  get totalDistance(): number {
    return this.cum[this.cum.length - 1];
  }

  /** Índice i del segmento [i, i+1] que contiene el tiempo relativo `t` (0..duration). */
  segmentAt(t: number): number {
    const abs = this.startT + clamp(t, 0, this.duration);
    let lo = 0;
    let hi = this.track.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.track[mid].t <= abs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Posición en el tiempo relativo `t` (segundos desde el inicio del track). */
  sampleAt(t: number): TrackSample {
    const i = this.segmentAt(t);
    const a = this.track[i];
    const b = this.track[i + 1];
    const abs = this.startT + clamp(t, 0, this.duration);
    const dt = b.t - a.t;
    const f = dt > 0 ? clamp((abs - a.t) / dt, 0, 1) : 0;
    const segLen = this.cum[i + 1] - this.cum[i];
    let heading = lerpHeading(a.heading, b.heading, f);
    // Sin heading grabado pero moviéndose: rumbo del segmento.
    if (heading == null && segLen > 0.5) heading = bearingDeg(a, b);
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      heading,
      accuracy: a.accuracy + (b.accuracy - a.accuracy) * f,
      // Velocidad del track (no de la reproducción): a 10x no tiene que parecer un auto.
      speed: dt > 0 ? segLen / dt : 0,
    };
  }

  /** Distancia recorrida (m) en el tiempo relativo `t`. */
  distanceAt(t: number): number {
    const i = this.segmentAt(t);
    const a = this.track[i];
    const b = this.track[i + 1];
    const abs = this.startT + clamp(t, 0, this.duration);
    const dt = b.t - a.t;
    const f = dt > 0 ? clamp((abs - a.t) / dt, 0, 1) : 0;
    return this.cum[i] + (this.cum[i + 1] - this.cum[i]) * f;
  }

  /** Primer tiempo relativo en el que se recorrieron `d` metros. */
  timeAtDistance(d: number): number {
    const target = clamp(d, 0, this.totalDistance);
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const i = lo - 1;
    const segLen = this.cum[i + 1] - this.cum[i];
    const f = segLen > 0 ? (target - this.cum[i]) / segLen : 1;
    const a = this.track[i];
    const b = this.track[i + 1];
    return a.t + (b.t - a.t) * f - this.startT;
  }

  /**
   * Tiempos a emitir para avanzar de t0 a t1 (excluye t0, incluye t1) de modo que entre muestras
   * consecutivas no haya más de `maxStepM` metros de recorrido.
   */
  stepsBetween(t0: number, t1: number, maxStepM = 10): number[] {
    if (t1 <= t0) return [t1];
    const d0 = this.distanceAt(t0);
    const d1 = this.distanceAt(t1);
    const n = Math.max(1, Math.ceil((d1 - d0) / maxStepM - 1e-9));
    const out: number[] = [];
    for (let k = 1; k < n; k++) {
      const tk = this.timeAtDistance(d0 + ((d1 - d0) * k) / n);
      out.push(clamp(tk, t0, t1));
    }
    out.push(t1);
    return out;
  }

  /** Tiempo relativo del punto del track más cercano a `p` (proyección sobre segmentos) y su distancia. */
  nearest(p: LatLng): { t: number; distanceM: number } {
    let best = { t: 0, distanceM: Infinity };
    for (let i = 0; i < this.track.length - 1; i++) {
      const a = this.track[i];
      const b = this.track[i + 1];
      const pa = toXY(a, p);
      const pb = toXY(b, p);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len2 = dx * dx + dy * dy;
      const f = len2 > 0 ? clamp(-(pa.x * dx + pa.y * dy) / len2, 0, 1) : 0;
      const x = pa.x + dx * f;
      const y = pa.y + dy * f;
      const d = Math.hypot(x, y);
      // Estrictamente menor (con tolerancia): ante empate, gana la primera pasada.
      if (d < best.distanceM - 0.01) best = { t: a.t + (b.t - a.t) * f - this.startT, distanceM: d };
    }
    return best;
  }

  /**
   * "Saltar a parada": punto del track más cercano a la parada menos `leadSeconds` de recorrido, para que la
   * llegada (geofence) se dispare sola en ≤ leadSeconds a 1x.
   */
  seekTargetFor(p: LatLng, leadSeconds = 15): number {
    return Math.max(0, this.nearest(p).t - leadSeconds);
  }
}

/** Reloj de reproducción: avanza `t` con el tiempo real × velocidad y se detiene al final. */
export function advanceClock(
  state: { t: number; playing: boolean },
  realDeltaMs: number,
  speed: number,
  duration: number,
): { t: number; playing: boolean; ended: boolean } {
  if (!state.playing) return { ...state, ended: false };
  const t = state.t + (Math.max(0, realDeltaMs) / 1000) * speed;
  if (t >= duration) return { t: duration, playing: false, ended: true };
  return { t, playing: true, ended: false };
}

// ---------- suavizado ----------

export type SmoothOptions = {
  /** Descarta muestras con precisión peor que esto (m). */
  maxAccuracyM?: number;
  /** Descarta saltos con velocidad implícita mayor a esto (m/s) respecto del último punto válido. */
  maxSpeedMps?: number;
  /** Ventana de la media móvil ponderada por precisión. */
  window?: number;
};

/**
 * Suavizado del track grabado (PRD 09): (1) descarta precisión > 30 m, (2) descarta saltos > 3 m/s,
 * (3) media móvil ponderada por 1/accuracy² (ventana 5), (4) re-muestreo a 1 Hz con `t` desde 0,
 * (5) heading: el grabado si es válido y va lento; si no, rumbo entre puntos; media circular ventana 3.
 */
export function smoothTrack(raw: Track, opts: SmoothOptions = {}): Track {
  const maxAcc = opts.maxAccuracyM ?? 30;
  const maxSpeed = opts.maxSpeedMps ?? 3;
  const win = opts.window ?? 5;

  // 1 y 2
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  const valid: Track = [];
  for (const p of sorted) {
    if (!(p.accuracy <= maxAcc)) continue;
    const last = valid[valid.length - 1];
    if (last) {
      const dt = p.t - last.t;
      if (dt <= 0) continue;
      if (distanceMeters(last, p) / dt > maxSpeed) continue;
    }
    valid.push(p);
  }
  if (valid.length < 2) return valid.map((p) => ({ ...p, t: 0 }));

  // 3
  const half = Math.floor(win / 2);
  const filtered: Track = valid.map((p, i) => {
    let wSum = 0;
    let lat = 0;
    let lng = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(valid.length - 1, i + half); j++) {
      const w = 1 / Math.max(1, valid[j].accuracy) ** 2;
      wSum += w;
      lat += valid[j].lat * w;
      lng += valid[j].lng * w;
    }
    return { ...p, lat: lat / wSum, lng: lng / wSum };
  });

  // 4
  const cursor = new TrackCursor(filtered);
  const out: Track = [];
  const n = Math.floor(cursor.duration);
  for (let s = 0; s <= n; s++) {
    const sample = cursor.sampleAt(s);
    out.push({ t: s, lat: round(sample.lat, 7), lng: round(sample.lng, 7), heading: sample.heading, accuracy: round(sample.accuracy, 1) });
  }

  // 5
  const headings: (number | null)[] = out.map((p, i) => {
    const prev = out[Math.max(0, i - 1)];
    const next = out[Math.min(out.length - 1, i + 1)];
    const moved = distanceMeters(prev, next);
    const speed = moved / Math.max(1, next.t - prev.t);
    if (p.heading == null || speed > 0.5) return moved > 0.3 ? bearingDeg(prev, next) : p.heading;
    return p.heading;
  });
  return out.map((p, i) => {
    const h = circularMean(headings.slice(Math.max(0, i - 1), i + 2));
    return { ...p, heading: h == null ? null : round(h, 1) };
  });
}

// ---------- métricas y track sintético ----------

/** Salto máximo (m) entre muestras consecutivas. */
export function maxJumpMeters(track: Track): number {
  let max = 0;
  for (let i = 1; i < track.length; i++) max = Math.max(max, distanceMeters(track[i - 1], track[i]));
  return max;
}

export type NamedPoint = LatLng & { name: string };

/** Distancia mínima del track a cada punto (para `track:check` y la pantalla de debug). */
export function distancesToPoints(track: Track, points: NamedPoint[]): { name: string; distanceM: number; t: number }[] {
  const cursor = new TrackCursor(track);
  return points.map((p) => {
    const n = cursor.nearest(p);
    return { name: p.name, distanceM: n.distanceM, t: n.t };
  });
}

/**
 * Track sintético que camina por las paradas en orden (línea recta), con `dwellS` segundos quieto en cada una.
 * Sirve para probar el tour en vivo (PRD 07) con cualquier tour generado, sin grabar nada.
 */
export function synthesizeTrack(stops: LatLng[], opts: { speedMps?: number; dwellS?: number; leadInS?: number } = {}): Track {
  const speed = opts.speedMps ?? 1.3;
  const dwell = opts.dwellS ?? 30;
  const leadIn = opts.leadInS ?? 0;
  if (stops.length === 0) return [];
  const out: Track = [];
  let t = 0;
  const push = (p: LatLng, heading: number | null) => {
    out.push({ t, lat: round(p.lat, 7), lng: round(p.lng, 7), heading: heading == null ? null : round(heading, 1), accuracy: 5 });
    t += 1;
  };
  // Arranque a ~leadIn segundos de caminata antes de la primera parada (para que la llegada se dispare).
  if (leadIn > 0 && stops.length > 1) {
    const first = stops[0];
    const second = stops[1];
    const back = bearingDeg(second, first);
    const startDist = leadIn * speed;
    const start = offset(first, back, startDist);
    const heading = bearingDeg(start, first);
    for (let s = 0; s < leadIn; s++) {
      const f = s / leadIn;
      push({ lat: start.lat + (first.lat - start.lat) * f, lng: start.lng + (first.lng - start.lng) * f }, heading);
    }
  }
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    for (let s = 0; s < Math.max(1, dwell); s++) push(stop, null);
    const next = stops[i + 1];
    if (!next) break;
    const dist = distanceMeters(stop, next);
    const heading = bearingDeg(stop, next);
    const steps = Math.max(1, Math.ceil(dist / speed));
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      push({ lat: stop.lat + (next.lat - stop.lat) * f, lng: stop.lng + (next.lng - stop.lng) * f }, heading);
    }
  }
  if (out.length === 1) push(stops[0], null);
  return out;
}

/** Punto a `distM` metros de `p` con rumbo `bearing`. */
function offset(p: LatLng, bearing: number, distM: number): LatLng {
  const dLat = (distM * Math.cos(toRad(bearing))) / 6_371_000;
  const dLng = (distM * Math.sin(toRad(bearing))) / (6_371_000 * Math.cos(toRad(p.lat)));
  return { lat: p.lat + toDeg(dLat), lng: p.lng + toDeg(dLng) };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function round(n: number, d: number) {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}
