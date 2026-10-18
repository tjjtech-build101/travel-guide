// Modelo puro de Ahora v2 (docs/AHORA-V2.md): qué protagonista mostrar, la fila "Después", el riel del día,
// la cuenta regresiva, el aviso único, el punto demo "cerca" y el snapshot para now_brief. Sin React ni red.
// Tests: model.test.ts (`pnpm --filter mobile test:nowv2`).
import type { NowBriefSnapshotT } from '@build101/shared';

import { compareBlocks, type PlanBlock } from '../../plan/selectors';
import {
  blockWindow,
  clock,
  FLEX_WINDOW,
  formatMinutes,
  leaveInMin,
  leaveUrgency,
  type LatLng,
  type NowNext,
  type NowPlan,
  type TodayContext,
} from '../selectors';
import type { Eta } from '../useEta';
import type { DayRailItem, GapSuggestion, GroupPosition, HeroMode, NoticeKind, RainPlanB, WeatherSummary } from './types';

// ───────────────────────── Umbrales

/** Con este margen (o menos) para salir, el protagonista es "salí". */
export const LEAVE_HERO_MIN = 30;
/** Con este margen (o menos), "salí" le gana incluso al tour. También: desde acá la cuenta va con segundos. */
export const LEAVE_URGENT_MIN = 10;
/** Un tour que empieza dentro de esto ya se muestra como protagonista. */
export const TOUR_AHEAD_MIN = 60;

// ───────────────────────── Protagonista

export type PickHeroInput = {
  today: TodayContext | null;
  plan: NowPlan | null;
  eta: Eta | null;
  nowMin: number;
  /** Muy lejos del próximo (otra ciudad, GPS del simulador): no hay "salí en X". */
  far: boolean;
  /** Bloques del día del usuario (ya filtrados). Sirve para ver un tour en curso que se superpone con otro. */
  tourBlocks?: PlanBlock[];
};

const isTour = (b: PlanBlock | null | undefined): b is PlanBlock => !!b && b.type === 'tour' && !!b.tour_id;

/**
 * Elige UN protagonista. Prioridad (de arriba a abajo, gana el primero que aplica):
 * 1. `state` si hoy no es un día del viaje para mí (before / after / noLegs / noDay).
 * 2. `leave` si hay que salir en ≤ 10 min o ya es tarde (le gana a todo: primero llegar).
 * 3. `tour` en curso (con tour_id).
 * 4. `tour` próximo: es el siguiente bloque y empieza en ≤ 60 min (y no hay que salir en ≤ 10, ver 2).
 * 5. `leave` si hay que salir en ≤ 30 min.
 * 6. `current`: lo que está en curso.
 * 7. `free`: nada en curso; gapMin = minutos hasta el próximo (null si no hay más nada con hora).
 *    Si el próximo está a ≤ 30 min pero no hay ETA (sin lugar, sin GPS o lejos) también es `free` con ese hueco chico.
 */
export function pickHero({ today, plan, eta, nowMin, far, tourBlocks }: PickHeroInput): HeroMode {
  if (!today || today.kind === 'noLegs') return { kind: 'state', state: 'noLegs' };
  if (today.kind === 'before') return { kind: 'state', state: 'before', daysUntil: today.daysUntil };
  if (today.kind === 'after') return { kind: 'state', state: 'after' };
  if (today.kind === 'noDay' || !plan) return { kind: 'state', state: 'noDay' };

  const next = plan.next;
  const canLeave = !!next && !!eta && !far && typeof next.block.lat === 'number' && typeof next.block.lng === 'number';
  const leaveIn = canLeave ? leaveInMin(next.start, nowMin, eta.minutes) : null;
  const leave = (): HeroMode => ({ kind: 'leave', next: next!, eta: eta!, leaveIn: leaveIn!, urgency: leaveUrgency(leaveIn!) });

  if (leaveIn !== null && leaveIn <= LEAVE_URGENT_MIN) return leave();

  // Tour en curso: el actual, o alguno del día que se superpone.
  const running = isTour(plan.current?.block)
    ? plan.current!.block
    : (tourBlocks ?? []).find((b) => {
        if (!isTour(b)) return false;
        const w = blockWindow(b);
        return !!w && w.start <= nowMin && nowMin < w.end;
      });
  if (running) return { kind: 'tour', block: running, when: 'current', inMin: 0 };

  if (next && isTour(next.block) && next.inMin <= TOUR_AHEAD_MIN) {
    return { kind: 'tour', block: next.block, when: 'next', inMin: next.inMin };
  }

  if (leaveIn !== null && leaveIn <= LEAVE_HERO_MIN) return leave();
  if (plan.current) return { kind: 'current', current: plan.current };
  return { kind: 'free', gapMin: next ? next.inMin : null, until: next };
}

// ───────────────────────── Fila "Después"

/** Solo bajo `current` o `tour`, si hay un próximo y no es el mismo tour del protagonista. */
export function showNextRow(hero: HeroMode, plan: Pick<NowPlan, 'next'> | null): boolean {
  const next = plan?.next;
  if (!next) return false;
  if (hero.kind === 'current') return true;
  if (hero.kind === 'tour') return next.block.id !== hero.block.id;
  return false;
}

/** "18:00 · Llamada de laburo · Salí en 1 h 10". Sin ETA: "… · En 1 h 30". */
export function nextRowLabel(next: NowNext, etaMin?: number | null): string {
  const head = `${clock(next.start)} · ${next.block.title}`;
  if (etaMin == null) return `${head} · En ${formatMinutes(next.inMin)}`;
  const nowMin = next.start - next.inMin;
  const leaveIn = leaveInMin(next.start, nowMin, etaMin);
  if (leaveIn < 0) return `${head} · Vas tarde`;
  if (leaveIn === 0) return `${head} · Salí ya`;
  return `${head} · Salí en ${formatMinutes(leaveIn)}`;
}

// ───────────────────────── Riel del día

/**
 * Bloques del día (del usuario, ya filtrados) en orden: con hora primero, los de franja al final.
 * done = ya terminó; now = en curso; next = el primero con hora que viene; later = el resto.
 */
export function dayRail(dayBlocks: PlanBlock[], nowMin: number): DayRailItem[] {
  const sorted = [...dayBlocks].sort(compareBlocks);
  const timed: DayRailItem[] = [];
  const flex: DayRailItem[] = [];
  let nextGiven = false;
  for (const b of sorted) {
    const w = blockWindow(b);
    if (!w) {
      const ended = FLEX_WINDOW[b.time_flex ?? 'any'][1] <= nowMin;
      flex.push({ id: b.id, title: b.title, type: b.type, start: null, end: null, status: ended ? 'done' : 'later' });
      continue;
    }
    let status: DayRailItem['status'];
    if (w.end <= nowMin) status = 'done';
    else if (w.start <= nowMin) status = 'now';
    else if (!nextGiven) {
      status = 'next';
      nextGiven = true;
    } else status = 'later';
    timed.push({ id: b.id, title: b.title, type: b.type, start: w.start, end: w.end, status });
  }
  return [...timed, ...flex];
}

// ───────────────────────── Cuenta regresiva

export type Countdown = { text: string; tickMs: 1000 | 30000 };

/**
 * Texto grande del protagonista `leave`. `seconds` = segundos del minuto actual (0–59): con ≤ 10 min la cuenta
 * va con segundos ("6:30") y se actualiza cada 1 s; si no, cada 30 s.
 */
export function countdown(leaveIn: number, seconds = 0): Countdown {
  if (leaveIn < 0) return { text: `Vas ${formatMinutes(-leaveIn)} tarde`, tickMs: 30000 };
  if (leaveIn > LEAVE_URGENT_MIN) return { text: `Salí en ${formatMinutes(leaveIn)}`, tickMs: 30000 };
  const left = leaveIn * 60 - Math.max(0, Math.min(59, Math.floor(seconds)));
  if (left <= 0) return { text: 'Salí ya', tickMs: 1000 };
  return { text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, tickMs: 1000 };
}

// ───────────────────────── Aviso único

export type PickNoticeInput = {
  /** Minutos desde el último dato bueno si estamos sin conexión (null = con conexión). */
  offlineMinutesAgo: number | null;
  rain: RainPlanB | null;
  proposalsCount: number;
};

/** Como mucho UNA: sin conexión > plan B por lluvia (solo si hay variante rain) > propuestas pendientes. */
export function pickNotice({ offlineMinutesAgo, rain, proposalsCount }: PickNoticeInput): NoticeKind | null {
  if (offlineMinutesAgo != null) return { kind: 'offline', minutesAgo: Math.max(0, Math.round(offlineMinutesAgo)) };
  if (rain?.hasRainVariant) return { kind: 'rain', plan: rain };
  if (proposalsCount > 0) return { kind: 'proposals', count: proposalsCount };
  return null;
}

// ───────────────────────── Modo demo ?loc=near

/**
 * Un punto a ~walkMin minutos a pie del destino (hacia el este), tal que walkEstimateMin(punto, destino) = walkMin.
 * Para que "Salí en X" se vea en la demo aunque el GPS esté lejos.
 */
export function nearPoint(target: LatLng, walkMin = 8): LatLng {
  // walkEstimateMin = ceil(d × 1,3 / 80): apuntamos medio minuto por debajo para caer justo en walkMin.
  const meters = Math.max(0, (walkMin - 0.5) * 80) / 1.3;
  const dLng = meters / (111_320 * Math.cos((target.lat * Math.PI) / 180));
  return { lat: target.lat, lng: target.lng + dLng };
}

// ───────────────────────── Snapshot para now_brief

export type BriefSnapshotInput = {
  hero: HeroMode;
  nowMin: number;
  city?: string | null;
  plan?: Pick<NowPlan, 'current' | 'next'> | null;
  eta?: Eta | null;
  weather?: WeatherSummary | null;
  suggestions?: GapSuggestion[];
  group?: GroupPosition[];
};

type BriefBlock = NonNullable<NowBriefSnapshotT['current']>;

function briefBlock(b: PlanBlock): BriefBlock {
  return {
    title: b.title,
    type: b.type,
    place_name: b.place_name ?? null,
    start_time: b.start_time ? b.start_time.slice(0, 5) : null,
    end_time: b.end_time ? b.end_time.slice(0, 5) : null,
  };
}

/** Lo justo para la frase de Scout (contrato NowBriefSnapshot): sin ids, enteros, ≤ 2 sugerencias, ≤ 6 personas. */
export function toBriefSnapshot({ hero, nowMin, city, plan, eta, weather, suggestions, group }: BriefSnapshotInput): NowBriefSnapshotT {
  const current =
    hero.kind === 'current' ? hero.current.block : hero.kind === 'tour' && hero.when === 'current' ? hero.block : plan?.current?.block ?? null;
  const next = hero.kind === 'leave' ? hero.next : hero.kind === 'free' ? hero.until : plan?.next ?? null;
  const nextBlock = hero.kind === 'tour' && hero.when === 'next' ? hero.block : next?.block ?? null;

  const snap: NowBriefSnapshotT = {
    local_time: clock(nowMin),
    city: city ?? null,
    hero: hero.kind,
    current: current ? briefBlock(current) : null,
    next: nextBlock && nextBlock.id !== current?.id ? briefBlock(nextBlock) : null,
    leave_in_min: hero.kind === 'leave' ? Math.round(hero.leaveIn) : null,
    walk_min: eta && eta.mode === 'walk' ? Math.round(eta.minutes) : null,
    gap_min: hero.kind === 'free' && hero.gapMin != null ? Math.round(hero.gapMin) : null,
  };
  if (weather) snap.weather = { temp_c: weather.temp_c, summary: weather.summary, rain_soon: weather.rainSoon };
  if (suggestions?.length) {
    snap.suggestions = suggestions.slice(0, 2).map((s) => ({ title: s.title, walk_min: s.walk_min == null ? null : Math.round(s.walk_min) }));
  }
  if (group?.length) {
    snap.group = group.slice(0, 6).map((g) => ({ name: g.display_name ?? 'Alguien', distance_m: g.distance_m == null ? null : Math.round(g.distance_m) }));
  }
  return snap;
}
