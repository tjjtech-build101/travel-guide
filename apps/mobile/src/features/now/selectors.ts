// Selectores puros de la vista Ahora (PRD 19): qué día es "hoy" en el tramo, qué toca ahora, qué sigue,
// cuándo salir y si hay que mostrar sugerencias. Sin React ni red.
// Tests: selectors.test.ts (`pnpm --filter mobile test:now`).
import { legTimeZone, zonedParts, type DayRow, type TimeFlex } from '@build101/shared';

import { collapseChoices } from '../plan/choices';
import { compareBlocks, toMin, type PlanBlock, type PlanLeg } from '../plan/selectors';

// ───────────────────────── Zona horaria del tramo

// La zona real (IANA, con DST) vive en packages/shared/timezone.ts: legTimeZone + zonedParts.
export { deviceTimeZone, legTimeZone, zonedParts, zonedUtc } from '@build101/shared';

/**
 * Compat (v1): desfase fijo por país. Solo Uruguay y Argentina (UTC−3 sin DST). null = la zona del celu.
 * Para código nuevo usá legTimeZone + zonedParts.
 */
const OFFSET_BY_COUNTRY: Record<string, number> = {
  uruguay: -180,
  uy: -180,
  argentina: -180,
  ar: -180,
};

export function tzOffsetMin(country: string | null | undefined): number | null {
  if (!country) return null;
  const k = country
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return OFFSET_BY_COUNTRY[k] ?? null;
}

/** Fecha local ("2026-10-18") y minutos desde 00:00 de un instante, con el desfase dado (o el del celu). */
export function localParts(utcMs: number, offsetMin: number | null): { date: string; minutes: number } {
  if (offsetMin === null) {
    const d = new Date(utcMs);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { date, minutes: d.getHours() * 60 + d.getMinutes() };
  }
  const d = new Date(utcMs + offsetMin * 60_000);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { date, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Instante UTC de una fecha+hora local ("2026-10-18T10:30") en el desfase dado (default UTC−3, la demo). */
export function utcFromLocal(local: string, offsetMin = -180): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi) - offsetMin * 60_000;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Días enteros entre dos fechas ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const pb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Math.round((pb - pa) / 86_400_000);
}

// ───────────────────────── ¿Qué día es hoy en el viaje?

export type TripDates = { start_date: string | null; end_date: string | null; status?: string | null };

export type TodayContext =
  | { kind: 'noLegs' }
  | { kind: 'before'; daysUntil: number; date: string }
  | { kind: 'after'; date: string }
  /** Dentro del viaje pero sin tramo para el usuario ese día (o tramo sin día cargado). */
  | { kind: 'noDay'; date: string; minutes: number }
  | { kind: 'today'; leg: PlanLeg; day: DayRow; date: string; minutes: number };

/**
 * Busca el tramo y el día de "hoy" según la hora local (IANA) de cada tramo. Con tramos paralelos prefiere
 * aquel donde el usuario es leg_member (si no, el primero).
 */
export function resolveToday(legs: PlanLeg[], me: string, utcMs: number, trip?: TripDates | null): TodayContext {
  if (!legs.length) return { kind: 'noLegs' };
  const candidates: { leg: PlanLeg; day: DayRow; date: string; minutes: number }[] = [];
  for (const leg of legs) {
    const { date, minutes } = zonedParts(utcMs, legTimeZone(leg));
    const day = leg.days.find((d) => d.date === date);
    if (day) candidates.push({ leg, day, date, minutes });
  }
  const mine = candidates.find((c) => c.leg.member_ids.includes(me));
  const pick = mine ?? (candidates.length && !legs.some((l) => l.member_ids.includes(me)) ? candidates[0] : undefined);
  if (pick) return { kind: 'today', ...pick };

  // Sin día para mí: ¿antes, después o en el medio del viaje?
  const { date, minutes } = zonedParts(utcMs, tripTimeZone(legs, me, utcMs));
  const start = trip?.start_date ?? minDate(legs.map((l) => l.start_date));
  const end = trip?.end_date ?? maxDate(legs.map((l) => l.end_date));
  if (start && date < start) return { kind: 'before', daysUntil: daysBetween(date, start), date };
  if (end && date > end) return { kind: 'after', date };
  return { kind: 'noDay', date, minutes };
}

/**
 * Zona para mostrar la hora del viaje: el tramo mío que cae hoy; si no, mi primer tramo; si no, el primero.
 * Sin tramos: la zona del celu.
 */
export function tripTimeZone(legs: Pick<PlanLeg, 'country' | 'lat' | 'lng' | 'start_date' | 'end_date' | 'member_ids'>[], me: string, utcMs: number): string {
  const mine = legs.filter((l) => l.member_ids.includes(me));
  const pool = mine.length ? mine : legs;
  const now = pool.find((l) => {
    const { date } = zonedParts(utcMs, legTimeZone(l));
    return (!l.start_date || date >= l.start_date) && (!l.end_date || date <= l.end_date);
  });
  const leg = now ?? pool[0];
  return leg ? legTimeZone(leg) : legTimeZone({});
}

function minDate(xs: (string | null)[]): string | null {
  const v = xs.filter((x): x is string => !!x).sort();
  return v[0] ?? null;
}
function maxDate(xs: (string | null)[]): string | null {
  const v = xs.filter((x): x is string => !!x).sort();
  return v[v.length - 1] ?? null;
}

/**
 * El viaje "está en curso" (abrir en Ahora): status active, o hoy cae entre start_date y end_date.
 * `zone`: zona IANA ("America/Montevideo") o desfase fijo en minutos (compat; null = el celu).
 */
export function isTripInProgress(trip: TripDates, utcMs: number, zone: string | number | null = -180): boolean {
  if (trip.status === 'finished') return false;
  if (trip.status === 'active') return true;
  if (!trip.start_date || !trip.end_date) return false;
  const { date } = typeof zone === 'string' ? zonedParts(utcMs, zone) : localParts(utcMs, zone);
  return date >= trip.start_date && date <= trip.end_date;
}

// ───────────────────────── Ahora / Después / Más tarde

/** Franja de cada time_flex (minutos) para bloques sin hora. */
export const FLEX_WINDOW: Record<TimeFlex, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 19 * 60],
  evening: [19 * 60, 24 * 60],
  any: [0, 24 * 60],
  fixed: [0, 24 * 60],
};

/** Ventana [inicio, fin) en minutos de un bloque con hora (fin = end_time, o inicio + duración, o +60). */
export function blockWindow(b: Pick<PlanBlock, 'start_time' | 'end_time' | 'duration_min'>): { start: number; end: number } | null {
  const start = toMin(b.start_time);
  if (start === null) return null;
  let end = toMin(b.end_time);
  if (end === null || end <= start) end = start + (b.duration_min && b.duration_min > 0 ? b.duration_min : 60);
  return { start, end };
}

/** Lo que ve el usuario en Ahora: solo main, sin privados ajenos y donde participa (o lo creó, si no hay participantes). */
export function isMineForNow(b: PlanBlock, me: string): boolean {
  if (b.masked) return false;
  if (b.plan_variant && b.plan_variant !== 'main') return false;
  if (b.participant_ids.length) return b.participant_ids.includes(me);
  return b.created_by === me;
}

export type NowCurrent = { block: PlanBlock; start: number; end: number; remainingMin: number; progress: number };
export type NowNext = { block: PlanBlock; start: number; inMin: number };

export type NowPlan = {
  current: NowCurrent | null;
  next: NowNext | null;
  /** Resto del día después de "Después": con hora y, al final, los de franja que todavía no pasó. */
  later: PlanBlock[];
  /** Total de bloques del día que ve el usuario. */
  total: number;
};

export function buildNowPlan(dayBlocks: PlanBlock[], me: string, nowMin: number): NowPlan {
  // Un lugar "elegí 1 de N" pendiente cuenta una vez: la opción recomendada (PRD 31).
  const mine = collapseChoices(dayBlocks.filter((b) => isMineForNow(b, me))).sort(compareBlocks);
  const timed: { block: PlanBlock; start: number; end: number }[] = [];
  const flexible: PlanBlock[] = [];
  for (const b of mine) {
    const w = blockWindow(b);
    if (w) timed.push({ block: b, ...w });
    else flexible.push(b);
  }

  // En curso: el que empezó más tarde entre los que siguen abiertos (si se superponen, el más nuevo).
  let current: NowCurrent | null = null;
  for (const t of timed) {
    if (t.start <= nowMin && nowMin < t.end && (!current || t.start >= current.start)) {
      const dur = t.end - t.start;
      current = { block: t.block, start: t.start, end: t.end, remainingMin: t.end - nowMin, progress: dur > 0 ? (nowMin - t.start) / dur : 0 };
    }
  }

  const upcoming = timed.filter((t) => t.start > nowMin && t.block.id !== current?.block.id);
  const nextT = upcoming[0];
  const next: NowNext | null = nextT ? { block: nextT.block, start: nextT.start, inMin: nextT.start - nowMin } : null;

  const flexLater = flexible.filter((b) => FLEX_WINDOW[b.time_flex ?? 'any'][1] > nowMin);
  const later = [...upcoming.slice(1).map((t) => t.block), ...flexLater];
  return { current, next, later, total: mine.length };
}

/** Sin nada en curso y nada en las próximas 2 h → sugerencias (nunca pantalla vacía). */
export function needsSuggestions(plan: Pick<NowPlan, 'current' | 'next'>, horizonMin = 120): boolean {
  if (plan.current) return false;
  return !plan.next || plan.next.inMin > horizonMin;
}

// ───────────────────────── Cuándo salir

// "Salí en X" vive en packages/shared (scheduleWatcher.ts): lo usan Ahora y el vigilante de horarios.
export { LEAVE_BUFFER_MIN, leaveInMin } from '@build101/shared';

export type LeaveUrgency = 'ok' | 'soon' | 'late';

/** Naranja con ≤ 5 min, rojo si ya es tarde. */
export function leaveUrgency(leaveIn: number): LeaveUrgency {
  if (leaveIn < 0) return 'late';
  if (leaveIn <= 5) return 'soon';
  return 'ok';
}

/** "Salí en 12 min"; con más de una hora de margen, la hora ("Salí a las 15:52") si se pasa `nowMin`. */
export function leaveLabel(leaveIn: number, nowMin?: number): string {
  if (leaveIn < 0) return `Ya deberías haber salido (hace ${formatMinutes(-leaveIn)})`;
  if (leaveIn === 0) return 'Salí ahora';
  if (leaveIn > 60 && nowMin !== undefined) return `Salí a las ${clock(nowMin + leaveIn)}`;
  return `Salí en ${formatMinutes(leaveIn)}`;
}

/** Minutos desde 00:00 → "15:52". */
export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "45 min", "1 h", "1 h 10". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

// ───────────────────────── Distancias

export type LatLng = { lat: number; lng: number };

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Estimación a pie sin red y "muy lejos" (> 30 km): compartidos con el vigilante de horarios (packages/shared).
export { FAR_AWAY_M, isFarAway, walkEstimateMin } from '@build101/shared';

/** Celda de ~100 m para no recalcular el ETA con cada fix (PRD 19: cada 2 min o 100 m). */
export function etaCell(p: LatLng): string {
  return `${Math.round(p.lat * 1000)}:${Math.round(p.lng * 1000)}`;
}

export function hasCoords<T extends { lat: number | null; lng: number | null }>(b: T): b is T & { lat: number; lng: number } {
  return typeof b.lat === 'number' && typeof b.lng === 'number';
}

/** Ideas del banco (day_id null) del tramo cerca de `here` (≤ maxKm), las más cercanas primero. Sin ubicación: las primeras. */
export function nearbyIdeas(blocks: PlanBlock[], legId: string, here: LatLng | null, maxKm = 1, limit = 3): PlanBlock[] {
  const ideas = blocks.filter((b) => !b.day_id && b.leg_id === legId && !b.masked && (!b.plan_variant || b.plan_variant === 'main'));
  if (!here) return ideas.sort(compareBlocks).slice(0, limit);
  return ideas
    .filter(hasCoords)
    .map((b) => ({ b, d: distanceM(here, b) }))
    .filter((x) => x.d <= maxKm * 1000)
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map((x) => x.b);
}
