// Vigilante de horarios (puro, sin React ni red): con la hora, la posición, los bloques de hoy y los ETA decide si
// hay que avisar "salí ya" (leave_now), "vas tarde" (running_late) o "por empezar" (starting_soon).
// Lo corre el celu (apps/mobile/src/schedule) cada ~60 s en primer plano y con cada muestra de ubicación en segundo
// plano. "Salí en X" es el mismo cálculo que la tarjeta Después de Ahora (PRD 19): inicio − ETA − 5 − ahora.
import { distanceMeters } from './location';
import type { ScheduleAlertKind, ScheduleAlertPayload } from './voice';

type LatLng = { lat: number; lng: number };

// ───────────────────────── "Salí en X" (compartido con Ahora)

/** Margen para llegar con tiempo (PRD 19). */
export const LEAVE_BUFFER_MIN = 5;

/** "Salí en X min" = inicio − ETA − 5 − ahora. Negativo = ya es tarde. */
export function leaveInMin(nextStartMin: number, nowMin: number, etaMin: number, bufferMin = LEAVE_BUFFER_MIN): number {
  return nextStartMin - etaMin - bufferMin - nowMin;
}

/** Estimación a pie sin red: distancia × 1,3 (calles) a 80 m/min. Mientras route_eta responde o si falla. */
export function walkEstimateMin(a: LatLng, b: LatLng): number {
  return Math.max(1, Math.ceil((distanceMeters(a, b) * 1.3) / 80));
}

/** Más lejos que esto no tiene sentido "salí en X" (otra ciudad, o el GPS por defecto del simulador). */
export const FAR_AWAY_M = 30_000;

export function isFarAway(here: LatLng, target: LatLng): boolean {
  return distanceMeters(here, target) > FAR_AWAY_M;
}

// ───────────────────────── Umbrales

export const SCHEDULE_WATCH = {
  /** leave_now a ≤ 10 min de tener que salir y de nuevo a ≤ 5. */
  leaveThresholds: [10, 5] as const,
  /** running_late: la llegada estimada supera el inicio por más de esto. */
  lateByMin: 5,
  /** starting_soon: empieza en ≤ 15 min y ya estás a ≤ 150 m. */
  startingSoonMin: 15,
  nearM: 150,
  /** ETA: recalcular como máximo cada 2 min, o antes si te moviste más de 100 m. */
  etaMaxAgeMs: 2 * 60_000,
  etaMoveM: 100,
} as const;

// ───────────────────────── Entradas

/** Lo mínimo de un bloque que mira el vigilante (compatible con blocks_visible). */
export type WatchBlock = {
  id: string;
  title: string;
  start_time: string | null;
  time_flex?: string | null;
  lat: number | null;
  lng: number | null;
  /** Privado ajeno enmascarado ("Ocupado"): nunca se avisa. */
  masked?: boolean | null;
};

/** profiles.quiet_hours: {start:'23:00', end:'08:00', tz}. La hora se compara en la zona del tramo. */
export type WatchQuietHours = { start: string; end: string } | null | undefined;

export type ScheduleWatchInput = {
  /** Minutos desde las 00:00 en la zona del tramo. */
  nowMin: number;
  here: LatLng | null;
  /** Bloques de hoy que ve el usuario (ya filtrados por participante / plan main). */
  blocks: WatchBlock[];
  /** ETA en minutos por block_id (route_eta). Sin dato → estimación a pie por distancia. */
  etas?: Record<string, number | undefined>;
  /** Tour en vivo activo: ahí manda time_warning (PRD 07), el vigilante calla. */
  tourActive?: boolean;
  quietHours?: WatchQuietHours;
  /** Claves ya avisadas (dedupe): ver alertKey. */
  sent: readonly string[];
};

export type ScheduleAlert = { key: string; payload: ScheduleAlertPayload };

export type ScheduleWatchResult = {
  alerts: ScheduleAlert[];
  /** Claves a sumar a `sent` (incluye umbrales que quedaron atrás sin avisar, para no apilar avisos). */
  markSent: string[];
  /** Por qué no se evaluó (o null): para el log del menú dev. */
  skipped: 'tour' | 'quiet_hours' | 'no_location' | 'no_block' | 'far_away' | null;
  /** Bloque vigilado (el próximo con hora fija y lugar) y su ETA usado. */
  target: { block_id: string; eta_min: number | null; estimated: boolean } | null;
};

// ───────────────────────── Helpers

export function hhmmToMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Dentro de las horas de silencio (con vuelta de medianoche: 23:00–08:00). */
export function inQuietHours(nowMin: number, q: WatchQuietHours): boolean {
  if (!q) return false;
  const s = hhmmToMin(q.start);
  const e = hhmmToMin(q.end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

/** Clave de dedupe: bloque + hora de inicio (si lo movieron, se rearma) + tipo + umbral. */
export function alertKey(block: Pick<WatchBlock, 'id' | 'start_time'>, kind: ScheduleAlertKind, threshold?: number): string {
  const start = hhmm(hhmmToMin(block.start_time) ?? 0);
  return `${block.id}@${start}:${kind}${threshold !== undefined ? `:${threshold}` : ''}`;
}

/** Bloques vigilables: con hora fija y lugar, no enmascarados. */
export function isWatchable(b: WatchBlock): b is WatchBlock & { lat: number; lng: number; start_time: string } {
  if (b.masked) return false;
  if ((b.time_flex ?? 'fixed') !== 'fixed') return false;
  if (hhmmToMin(b.start_time) === null) return false;
  return typeof b.lat === 'number' && typeof b.lng === 'number';
}

/** El próximo bloque vigilable que todavía no empezó (los ya pasados se ignoran). */
export function nextWatchTarget(blocks: WatchBlock[], nowMin: number): (WatchBlock & { lat: number; lng: number; start_time: string }) | null {
  let best: (WatchBlock & { lat: number; lng: number; start_time: string }) | null = null;
  let bestStart = Infinity;
  for (const b of blocks) {
    if (!isWatchable(b)) continue;
    const start = hhmmToMin(b.start_time)!;
    if (start <= nowMin) continue;
    if (start < bestStart) {
      best = b;
      bestStart = start;
    }
  }
  return best;
}

// ───────────────────────── Decisión

export function evaluateSchedule(input: ScheduleWatchInput): ScheduleWatchResult {
  const none = (skipped: ScheduleWatchResult['skipped'], target: ScheduleWatchResult['target'] = null): ScheduleWatchResult => ({
    alerts: [],
    markSent: [],
    skipped,
    target,
  });
  if (input.tourActive) return none('tour');
  if (inQuietHours(input.nowMin, input.quietHours)) return none('quiet_hours');
  const block = nextWatchTarget(input.blocks, input.nowMin);
  if (!block) return none('no_block');
  if (!input.here) return none('no_location');
  if (isFarAway(input.here, block)) return none('far_away');

  const start = hhmmToMin(block.start_time)!;
  const routeEta = input.etas?.[block.id];
  const estimated = routeEta === undefined || !Number.isFinite(routeEta);
  const eta = estimated ? walkEstimateMin(input.here, block) : Math.max(0, Math.ceil(routeEta!));
  const target = { block_id: block.id, eta_min: eta, estimated };
  const sent = new Set(input.sent);
  const base = { block_id: block.id, title: block.title, start_time: hhmm(start) };
  const startsIn = start - input.nowMin;
  const dist = distanceMeters(input.here, block);

  const leaveKeys = SCHEDULE_WATCH.leaveThresholds.map((t) => alertKey(block, 'leave_now', t));
  const lateKey = alertKey(block, 'running_late');
  const soonKey = alertKey(block, 'starting_soon');

  // Ya estás ahí (o casi): "por empezar", y nada de "salí" / "vas tarde".
  if (dist <= SCHEDULE_WATCH.nearM) {
    if (startsIn > SCHEDULE_WATCH.startingSoonMin || sent.has(soonKey)) return { ...none(null, target) };
    return {
      alerts: [{ key: soonKey, payload: { ...base, kind: 'starting_soon', eta_min: eta, leave_in_min: null, late_by_min: null } }],
      // Llegaste: los "salí ya" de este bloque no tienen sentido.
      markSent: [soonKey, ...leaveKeys.filter((k) => !sent.has(k)), ...(sent.has(lateKey) ? [] : [lateKey])],
      skipped: null,
      target,
    };
  }

  const leaveIn = leaveInMin(start, input.nowMin, eta);
  const lateBy = input.nowMin + eta - start;

  if (lateBy > SCHEDULE_WATCH.lateByMin) {
    if (sent.has(lateKey)) return none(null, target);
    return {
      alerts: [{ key: lateKey, payload: { ...base, kind: 'running_late', eta_min: eta, leave_in_min: leaveIn, late_by_min: lateBy } }],
      // Si arrancamos tarde, no apilamos los "salí ya" que quedaron atrás.
      markSent: [lateKey, ...leaveKeys.filter((k) => !sent.has(k))],
      skipped: null,
      target,
    };
  }

  // leave_now: el umbral más chico cruzado (si cruzó los dos de golpe, un solo aviso y se marcan ambos).
  const crossed = SCHEDULE_WATCH.leaveThresholds.filter((t) => leaveIn <= t);
  if (!crossed.length) return none(null, target);
  const newKeys = crossed.map((t) => alertKey(block, 'leave_now', t)).filter((k) => !sent.has(k));
  if (!newKeys.length) return none(null, target);
  const smallest = Math.min(...crossed);
  return {
    alerts: [
      {
        key: alertKey(block, 'leave_now', smallest),
        payload: { ...base, kind: 'leave_now', eta_min: eta, leave_in_min: leaveIn, late_by_min: null },
      },
    ],
    markSent: newKeys,
    skipped: null,
    target,
  };
}

// ───────────────────────── Caché de ETA

export type EtaCacheEntry = { block_id: string; minutes: number; at: number; from: LatLng };

/** ¿Hay que volver a pedir route_eta? Sin dato, otro bloque, más de 2 min o más de 100 m desde la última. */
export function shouldRefreshEta(cache: EtaCacheEntry | null | undefined, blockId: string, here: LatLng, nowMs: number): boolean {
  if (!cache || cache.block_id !== blockId) return true;
  if (nowMs - cache.at >= SCHEDULE_WATCH.etaMaxAgeMs) return true;
  return distanceMeters(cache.from, here) > SCHEDULE_WATCH.etaMoveM;
}

// ───────────────────────── Texto (notificación local)

/** Título y cuerpo de la notificación local ("Salí en 8 min para el Teatro Solís"). */
export function scheduleAlertText(p: ScheduleAlertPayload, placeName?: string | null): { title: string; body: string } {
  const where = placeName || p.title;
  const eta = p.eta_min !== null ? `${p.eta_min} min a pie` : null;
  switch (p.kind) {
    case 'leave_now': {
      const n = p.leave_in_min ?? 0;
      const title = n > 0 ? `Salí en ${n} min para ${where}` : `Salí ya para ${where}`;
      return { title, body: [`${p.title} empieza a las ${p.start_time}`, eta].filter(Boolean).join(' · ') };
    }
    case 'running_late':
      return {
        title: `Vas ${p.late_by_min ?? 0} min tarde a ${where}`,
        body: `${p.title} empieza a las ${p.start_time}${eta ? ` y estás a ${eta}` : ''}. ¿Aviso o lo movemos?`,
      };
    case 'starting_soon': {
      const title = `${p.title} empieza a las ${p.start_time}`;
      return { title, body: 'Ya estás cerca. ¡Que lo disfrutes!' };
    }
  }
}
