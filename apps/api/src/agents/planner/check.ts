// Chequeo y arreglo del plan armado (PRD 31). Todo puro y testeable sin red.
// - Helpers del "marco del día" (capacidad según ritmo, arranque según cronotipo, ventanas de llegada/salida, horas
//   de comida, lluvia, abierto/cerrado) que comparten compose.ts y este archivo, así los dos miden con la misma vara.
// - checkPlan: detecta lo que haría que un día no funcione en la vida real (cerrado, largo, sin comida, saltos
//   largos a pie, repetidos, al aire libre con lluvia, arranque muy temprano, imperdible faltante).
// - repairPlan: arregla lo mínimo (mover a otro día abierto, reordenar, acortar hasta 30 %, sacar lo de menor
//   puntaje como último recurso) y devuelve en texto lo que no se pudo arreglar.
import { distanceMeters, type CatalogItem } from '@build101/shared';
import { openAtFn } from '../tourRoute';
import type { ComposeLeg, ComposedBlock, PlanIssue, PlannerGroup } from './types';

// ───────────────────────── Marco del día

/** Minutos de actividades por día según el ritmo (sin comidas ni traslados). */
export const PACE_CAPACITY: Record<PlannerGroup['pace'], number> = { relaxed: 330, balanced: 450, intense: 570 };
/** Minuto del día en que arranca el grupo según el cronotipo. */
export const CHRONO_START: Record<PlannerGroup['chronotype'], number> = { early: 510, normal: 570, night: 660 };
/** Horas de comida (minuto del día) y duraciones. Rioplatense: se cena tarde. */
export const MEALS = {
  lunch: { early: 750, normal: 780, night: 810, dur: 75 },
  dinner: { early: 1200, normal: 1230, night: 1290, dur: 90 },
} as const;
/** Hasta qué hora se planea, si la ventana del día no dice otra cosa. */
export const DAY_END_DEFAULT = 23 * 60 + 30;
/** Lluvia desde la que no mandamos nada al aire libre. */
export const RAIN_PROB = 0.6;

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const weekdayName = (d: number) => WEEKDAYS[d];
/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD, sin depender del huso del servidor. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export type DayFrame = {
  date: string;
  weekday: number;
  start: number;
  end: number;
  /** Minutos de actividades que entran (ritmo, recortado por la ventana real del día). */
  cap: number;
  lunch: number | null;
  dinner: number | null;
  /** 0-1 (Open-Meteo viene 0-100: lo normalizamos). */
  rain: number;
  sunset: number | null;
  /** Día entero: sirve para una escapada (no es llegada ni salida recortada). */
  full: boolean;
};

export const normProb = (p: number | null | undefined) => (p == null ? 0 : p > 1 ? p / 100 : p);

export function dayFrame(leg: ComposeLeg, group: PlannerGroup, date: string, capFactor = 1): DayFrame {
  const chrono = CHRONO_START[group.chronotype] ?? CHRONO_START.normal;
  const w = leg.dayWindows[date];
  const start = Math.max(chrono, w?.start_min ?? 0);
  const end = Math.min(DAY_END_DEFAULT, w?.end_min ?? DAY_END_DEFAULT);
  const lunchAt = MEALS.lunch[group.chronotype] ?? MEALS.lunch.normal;
  const dinnerAt = MEALS.dinner[group.chronotype] ?? MEALS.dinner.normal;
  // Una comida "entra" si el día la cubre entera (con 30 min de tolerancia para arrancar antes).
  const lunch = start <= lunchAt + 30 && end >= lunchAt + MEALS.lunch.dur ? Math.max(lunchAt, start) : null;
  const dinner = start <= dinnerAt + 30 && end >= dinnerAt + MEALS.dinner.dur ? Math.max(dinnerAt, start) : null;
  const meals = (lunch != null ? MEALS.lunch.dur : 0) + (dinner != null ? MEALS.dinner.dur : 0);
  // 60 min de margen para traslados y respiro entre paradas.
  const span = Math.max(0, end - start - meals - 60);
  let cap = Math.round(PACE_CAPACITY[group.pace] * capFactor * (group.hasKids ? 0.9 : 1));
  cap = Math.min(cap, span);
  const wx = leg.weather[date];
  return {
    date,
    weekday: weekdayOf(date),
    start,
    end,
    cap,
    lunch,
    dinner,
    rain: normProb(wx?.precip_prob),
    sunset: wx?.sunset_min ?? null,
    full: start <= chrono + 60 && end >= 20 * 60,
  };
}

/** ¿Abre ese día? true/false según closed_days y periods; si no sabemos, asumimos que sí. */
export function isOpenOn(item: Pick<CatalogItem, 'closed_days' | 'periods'>, date: string, from = 540, to = 1320): boolean {
  const wd = weekdayOf(date);
  if (item.closed_days?.includes(wd)) return false;
  if (item.periods && item.periods.length) {
    const open = openAtFn(item.periods);
    for (let m = from; m < to; m += 30) {
      const v = open(wd * 1440 + m);
      if (v === null || v) return true;
    }
    return false;
  }
  return true;
}

type LL = { lat: number; lng: number };
export const hasLL = (x: { lat?: number | null; lng?: number | null } | null | undefined): x is LL =>
  !!x && typeof x.lat === 'number' && typeof x.lng === 'number';

/** Traslado estimado (min): a pie hasta 1,5 km (80 m/min × 1,3 de desvío), después transporte. */
export function travelMin(a: LL, b: LL): number {
  const d = distanceMeters(a, b);
  if (d < 1500) return Math.max(3, Math.round((d * 1.3) / 80));
  return Math.round(15 + (d * 1.3) / 300);
}

export function transferFor(a: LL, b: LL): ComposedBlock['transfer'] {
  const d = distanceMeters(a, b);
  const mode = d < 1500 ? 'walk' : d > 8000 ? 'car' : 'transit';
  return { mode, duration_min: Math.max(1, travelMin(a, b)) };
}

/** HH:MM → minutos. */
export const toMin = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}`;
};
const fmtHours = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};

// ───────────────────────── Lectura de bloques

/** Contexto opcional: con los ítems del catálogo el chequeo sabe horarios, interior/exterior e imperdibles. */
export type CheckContext = {
  items?: CatalogItem[];
  /** item_id de los imperdibles del tramo (para must_missing). */
  mustIds?: string[];
  /** Puntaje por item_id (para decidir qué sacar como último recurso). */
  scores?: Record<string, number>;
};

const isActivity = (b: ComposedBlock) => b.type === 'activity' || b.type === 'tour' || b.type === 'free';
export const isLunch = (b: ComposedBlock) =>
  b.type === 'meal' && (b.time_flex === 'afternoon' || (toMin(b.start_time) ?? 9999) < 17 * 60);
export const isDinner = (b: ComposedBlock) =>
  b.type === 'meal' && (b.time_flex === 'evening' || (toMin(b.start_time) ?? -1) >= 19 * 60);
/** Un bloque "cuenta" si es principal o la primera opción de su elección (las demás son alternativas). */
function countsIdx(blocks: ComposedBlock[], idxs: number[]): number[] {
  const seen = new Set<string>();
  return idxs.filter((i) => {
    const k = blocks[i].choice_key;
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function byDay(blocks: ComposedBlock[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    if (!b.day_id) return;
    if (!m.has(b.day_id)) m.set(b.day_id, []);
    m.get(b.day_id)!.push(i);
  });
  for (const v of m.values()) v.sort((a, b) => (blocks[a].sort_order ?? 0) - (blocks[b].sort_order ?? 0) || a - b);
  return m;
}
const label = (b: ComposedBlock) => b.place_name ?? b.title;
const dayLabel = (date: string) => `el ${weekdayName(weekdayOf(date))}`;

// ───────────────────────── Chequeo

export function checkPlan(leg: ComposeLeg, blocks: ComposedBlock[], group: PlannerGroup, ctx: CheckContext = {}): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const items = new Map((ctx.items ?? []).map((it) => [it.id, it]));
  const days = byDay(blocks);
  const chrono = CHRONO_START[group.chronotype] ?? CHRONO_START.normal;

  for (const day of leg.days) {
    const idxs = days.get(day.id) ?? [];
    const f = dayFrame(leg, group, day.date);
    const counted = countsIdx(blocks, idxs);

    // Cerrado ese día / al aire libre con lluvia.
    for (const i of idxs) {
      const b = blocks[i];
      const it = b.item_id ? items.get(b.item_id) : undefined;
      if (b.type === 'lodging' || b.type === 'meal') continue;
      const closedAlert = b.alerts?.some((a) => a.kind === 'closes');
      if ((it && !isOpenOn(it, day.date, f.start, f.end)) || closedAlert)
        issues.push({ kind: 'closed', day_id: day.id, block_idx: [i], text: `${label(b)} cierra ${dayLabel(day.date)}.` });
      const outdoor = it ? !it.indoor : b.alerts?.some((a) => a.kind === 'rain');
      if (outdoor && f.rain >= RAIN_PROB && it?.category !== 'event')
        issues.push({
          kind: 'outdoor_rain',
          day_id: day.id,
          block_idx: [i],
          text: `${label(b)} es al aire libre y ${dayLabel(day.date)} hay ${Math.round(f.rain * 100)} % de lluvia.`,
        });
    }

    // Largo / corto vs capacidad.
    const acts = counted.filter((i) => isActivity(blocks[i]));
    const mins = acts.reduce((s, i) => s + (blocks[i].duration_min ?? 60), 0);
    // Una escapada ocupa el día entero a propósito: no la medimos contra la capacidad de ciudad.
    const dayTrip = acts.some((i) => {
      const it = blocks[i].item_id ? items.get(blocks[i].item_id!) : undefined;
      return it ? it.category === 'day_trip' : (blocks[i].duration_min ?? 0) >= 360;
    });
    if (!dayTrip && mins > f.cap * 1.15 && mins > 0)
      issues.push({
        kind: 'too_long',
        day_id: day.id,
        block_idx: acts,
        text: `${cap1(dayLabel(day.date))} queda largo: ${fmtHours(mins)} de actividades para un ritmo de ${fmtHours(f.cap)}.`,
      });
    else if (!dayTrip && f.cap >= 240 && mins < Math.min(120, f.cap * 0.3))
      issues.push({
        kind: 'too_short',
        day_id: day.id,
        block_idx: acts,
        text: `${cap1(dayLabel(day.date))} queda liviano (${fmtHours(mins)}): sumá algo del menú o dejalo para descansar.`,
      });

    // Comidas.
    const meals = idxs.map((i) => blocks[i]);
    if (f.lunch != null && !meals.some(isLunch))
      issues.push({ kind: 'no_meal', day_id: day.id, block_idx: [], text: `${cap1(dayLabel(day.date))} no tiene almuerzo.` });
    if (f.dinner != null && !meals.some(isDinner))
      issues.push({ kind: 'no_meal', day_id: day.id, block_idx: [], text: `${cap1(dayLabel(day.date))} no tiene cena.` });

    // Saltos largos a pie entre seguidos (solo lo que cuenta, sin alojamiento).
    const route = counted.filter((i) => blocks[i].type !== 'lodging' && hasLL(blocks[i]));
    for (let k = 1; k < route.length; k++) {
      const a = blocks[route[k - 1]];
      const b = blocks[route[k]];
      const d = distanceMeters(a as LL, b as LL);
      const walking = !b.transfer || b.transfer.mode === 'walk';
      if (d > 3000 && walking)
        issues.push({
          kind: 'far',
          day_id: day.id,
          block_idx: [route[k - 1], route[k]],
          text: `De ${label(a)} a ${label(b)} hay ${(d / 1000).toFixed(1)} km a pie.`,
        });
    }

    // Arranque antes del cronotipo (solo horas fijas: lo demás es franja).
    for (const i of idxs) {
      const t = toMin(blocks[i].start_time);
      if (t != null && t < chrono - 30 && blocks[i].type !== 'transfer')
        issues.push({
          kind: 'late_start',
          day_id: day.id,
          block_idx: [i],
          text: `${label(blocks[i])} arranca a las ${fmtMin(t)} y el grupo suele arrancar a las ${fmtMin(chrono)}.`,
        });
    }
  }

  // Repetidos entre días (mismo lugar o mismo ítem en dos bloques que no son opciones de la misma elección).
  const seen = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (b.type === 'lodging' || !b.day_id) return;
    const key = b.item_id ? `i:${b.item_id}` : b.google_place_id ? `g:${b.google_place_id}` : null;
    if (!key) return;
    const prev = seen.get(key);
    if (prev != null && !(b.choice_key && blocks[prev].choice_key === b.choice_key)) {
      issues.push({ kind: 'duplicate', day_id: b.day_id, block_idx: [prev, i], text: `${label(b)} aparece dos veces en el plan.` });
    } else if (prev == null) seen.set(key, i);
  });

  // Imperdibles faltantes.
  if (ctx.mustIds?.length) {
    const present = new Set(blocks.map((b) => b.item_id).filter(Boolean));
    for (const id of ctx.mustIds)
      if (!present.has(id))
        issues.push({ kind: 'must_missing', day_id: null, block_idx: [], text: `Falta un imperdible: ${items.get(id)?.name ?? id}.` });
  }
  return issues;
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────────────────── Arreglo

/** Índices de todo el "lugar del día": el bloque y, si es una elección, sus opciones hermanas. */
function slotOf(blocks: ComposedBlock[], i: number): number[] {
  const k = blocks[i].choice_key;
  if (!k) return [i];
  return blocks.map((b, j) => (b.choice_key === k ? j : -1)).filter((j) => j >= 0);
}

function dayActivityMinutes(blocks: ComposedBlock[], dayId: string): number {
  const idxs = blocks.map((b, i) => (b.day_id === dayId ? i : -1)).filter((i) => i >= 0);
  return countsIdx(blocks, idxs)
    .filter((i) => isActivity(blocks[i]))
    .reduce((s, i) => s + (blocks[i].duration_min ?? 60), 0);
}

function dayCentroid(blocks: ComposedBlock[], dayId: string, skip: Set<number>): LL | null {
  const pts = blocks.filter((b, i) => b.day_id === dayId && !skip.has(i) && b.type !== 'lodging' && hasLL(b)) as unknown as LL[];
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

/** Mete el bloque (y sus hermanos) antes de la cena del día destino; reordena sort_order. */
function moveSlot(blocks: ComposedBlock[], slot: number[], dayId: string) {
  const dayIdxs = blocks.map((b, i) => (b.day_id === dayId ? i : -1)).filter((i) => i >= 0);
  dayIdxs.sort((a, b) => (blocks[a].sort_order ?? 0) - (blocks[b].sort_order ?? 0));
  const dinner = dayIdxs.find((i) => isDinner(blocks[i]));
  const at = dinner != null ? (blocks[dinner].sort_order ?? 0) : (dayIdxs.length ? (blocks[dayIdxs[dayIdxs.length - 1]].sort_order ?? 0) + 1 : 1);
  for (const i of dayIdxs) if ((blocks[i].sort_order ?? 0) >= at) blocks[i] = { ...blocks[i], sort_order: (blocks[i].sort_order ?? 0) + 1 };
  for (const i of slot) {
    const flex = blocks[i].time_flex === 'fixed' ? 'fixed' : 'afternoon';
    blocks[i] = { ...blocks[i], day_id: dayId, sort_order: at, time_flex: flex, transfer: undefined };
  }
}

/** Busca otro día donde el lugar abra, no llueva si es al aire libre, y entre en la capacidad. El más cercano gana. */
function findDayFor(
  leg: ComposeLeg,
  group: PlannerGroup,
  blocks: ComposedBlock[],
  slot: number[],
  item: CatalogItem | undefined,
  fromDay: string,
): string | null {
  const b = blocks[slot[0]];
  const dur = b.duration_min ?? 60;
  let best: { id: string; cost: number } | null = null;
  for (const d of leg.days) {
    if (d.id === fromDay) continue;
    const f = dayFrame(leg, group, d.date);
    if (item && !isOpenOn(item, d.date, f.start, f.end)) continue;
    if (item && !item.indoor && f.rain >= RAIN_PROB) continue;
    if (dayActivityMinutes(blocks, d.id) + dur > f.cap) continue;
    const c = dayCentroid(blocks, d.id, new Set(slot));
    const cost = c && hasLL(b) ? distanceMeters(c, b as LL) : 2500;
    if (!best || cost < best.cost) best = { id: d.id, cost };
  }
  return best?.id ?? null;
}

/** Reordena las actividades entre comidas de un día por vecino más cercano (las comidas quedan donde están). */
function reorderDay(blocks: ComposedBlock[], dayId: string) {
  const idxs = blocks.map((b, i) => (b.day_id === dayId ? i : -1)).filter((i) => i >= 0);
  idxs.sort((a, b) => (blocks[a].sort_order ?? 0) - (blocks[b].sort_order ?? 0));
  const orders = [...new Set(idxs.map((i) => blocks[i].sort_order ?? 0))].sort((a, b) => a - b);
  // Segmentos separados por comidas o bloques fijos.
  const segs: number[][] = [[]];
  for (const o of orders) {
    const group = idxs.filter((i) => (blocks[i].sort_order ?? 0) === o);
    const fixed = group.some((i) => blocks[i].type === 'meal' || blocks[i].type === 'lodging' || blocks[i].time_flex === 'fixed');
    if (fixed) segs.push([o], []);
    else segs[segs.length - 1].push(o);
  }
  let prev: LL | null = null;
  const newOrder: number[] = [];
  for (const seg of segs) {
    const rest = [...seg];
    const isFixedSeg = rest.length === 1 && idxs.some((i) => (blocks[i].sort_order ?? 0) === rest[0] && (blocks[i].type === 'meal' || blocks[i].type === 'lodging' || blocks[i].time_flex === 'fixed'));
    if (isFixedSeg) {
      newOrder.push(rest[0]);
      const b = idxs.map((i) => blocks[i]).find((x) => x.sort_order === rest[0]);
      if (b && hasLL(b)) prev = b;
      continue;
    }
    while (rest.length) {
      let bi = 0;
      if (prev) {
        let bd = Infinity;
        rest.forEach((o, k) => {
          const b = idxs.map((i) => blocks[i]).find((x) => x.sort_order === o);
          const d = b && hasLL(b) ? distanceMeters(prev!, b) : 1e9;
          if (d < bd) [bd, bi] = [d, k];
        });
      }
      const o = rest.splice(bi, 1)[0];
      newOrder.push(o);
      const b = idxs.map((i) => blocks[i]).find((x) => x.sort_order === o);
      if (b && hasLL(b)) prev = b;
    }
  }
  const map = new Map(newOrder.map((o, k) => [o, k + 1]));
  for (const i of idxs) blocks[i] = { ...blocks[i], sort_order: map.get(blocks[i].sort_order ?? 0) ?? blocks[i].sort_order };
  // Recalcula traslados con el orden nuevo.
  const seq = countsIdx(blocks, idxs.slice().sort((a, b) => (blocks[a].sort_order ?? 0) - (blocks[b].sort_order ?? 0)));
  let last: LL | null = null;
  for (const i of seq) {
    const b = blocks[i];
    if (b.type === 'lodging' || !hasLL(b)) continue;
    if (last) for (const j of slotOf(blocks, i)) if (hasLL(blocks[j])) blocks[j] = { ...blocks[j], transfer: transferFor(last, blocks[j] as LL) };
    last = b;
  }
}

function removeSlot(blocks: ComposedBlock[], slot: number[]): ComposedBlock[] {
  const s = new Set(slot);
  return blocks.filter((_, i) => !s.has(i));
}

/**
 * Arregla lo mínimo y devuelve los avisos que quedaron (texto para el usuario). Un issue por vuelta: después de
 * cada arreglo se vuelve a chequear porque los índices cambian. Lo que no tiene arreglo se informa y no se toca.
 */
export function repairPlan(
  leg: ComposeLeg,
  input: ComposedBlock[],
  _issues: PlanIssue[],
  group: PlannerGroup,
  ctx: CheckContext = {},
): { blocks: ComposedBlock[]; issues: string[] } {
  let blocks = input.map((b) => ({ ...b }));
  const items = new Map((ctx.items ?? []).map((it) => [it.id, it]));
  const notes: string[] = [];
  const unfixable = new Set<string>();
  const must = new Set(ctx.mustIds ?? []);
  const keyOf = (i: PlanIssue) => `${i.kind}|${i.day_id}|${i.text}`;

  for (let guard = 0; guard < 60; guard++) {
    const issues = checkPlan(leg, blocks, group, ctx).filter((i) => !unfixable.has(keyOf(i)));
    const issue = issues.find((i) => ['closed', 'duplicate', 'outdoor_rain', 'far', 'too_long', 'no_meal'].includes(i.kind));
    if (!issue) break;
    const day = leg.days.find((d) => d.id === issue.day_id);

    if (issue.kind === 'duplicate') {
      blocks = removeSlot(blocks, slotOf(blocks, issue.block_idx[1]));
      continue;
    }

    if (issue.kind === 'closed' || issue.kind === 'outdoor_rain') {
      const i = issue.block_idx[0];
      const b = blocks[i];
      const it = b.item_id ? items.get(b.item_id) : undefined;
      // Un evento con fecha no se mueve: es ese día o nada.
      if (b.time_flex === 'fixed' || it?.category === 'event') {
        unfixable.add(keyOf(issue));
        notes.push(issue.text);
        continue;
      }
      const slot = slotOf(blocks, i);
      const to = findDayFor(leg, group, blocks, slot, it, issue.day_id!);
      if (to) {
        moveSlot(blocks, slot, to);
        reorderDay(blocks, to);
        continue;
      }
      if (issue.kind === 'closed') {
        blocks = removeSlot(blocks, slot);
        notes.push(`${issue.text} No hay otro día que abra y tenga lugar: lo saqué.`);
      } else {
        unfixable.add(keyOf(issue));
        notes.push(`${issue.text} Tené un plan B bajo techo.`);
      }
      continue;
    }

    if (issue.kind === 'far') {
      reorderDay(blocks, issue.day_id!);
      const still = checkPlan(leg, blocks, group, ctx).some((x) => x.kind === 'far' && x.day_id === issue.day_id);
      if (still) {
        // Si sigue lejos, que no sea a pie: transporte entre los dos.
        for (const x of checkPlan(leg, blocks, group, ctx).filter((y) => y.kind === 'far' && y.day_id === issue.day_id)) {
          const [a, b] = x.block_idx;
          for (const j of slotOf(blocks, b)) blocks[j] = { ...blocks[j], transfer: { mode: 'transit', duration_min: travelMin(blocks[a] as LL, blocks[j] as LL) } };
        }
      }
      continue;
    }

    if (issue.kind === 'too_long' && day) {
      const f = dayFrame(leg, group, day.date);
      const acts = issue.block_idx.filter((i) => blocks[i].time_flex !== 'fixed');
      let over = dayActivityMinutes(blocks, day.id) - f.cap;
      // 1) Acortar hasta 30 % cada actividad flexible.
      for (const i of acts) {
        if (over <= 0) break;
        const d = blocks[i].duration_min ?? 60;
        const cut = Math.min(Math.floor(d * 0.3), over);
        if (cut <= 0) continue;
        for (const j of slotOf(blocks, i)) blocks[j] = { ...blocks[j], duration_min: Math.max(30, (blocks[j].duration_min ?? 60) - cut) };
        over -= cut;
      }
      if (over <= 0) continue;
      // 2) Mover o sacar el de menor puntaje que no sea imperdible.
      const score = (i: number) => ctx.scores?.[blocks[i].item_id ?? ''] ?? 0.5;
      const cand = acts.filter((i) => !must.has(blocks[i].item_id ?? '')).sort((a, b) => score(a) - score(b));
      if (!cand.length) {
        unfixable.add(keyOf(issue));
        notes.push(issue.text);
        continue;
      }
      const i = cand[0];
      const slot = slotOf(blocks, i);
      const to = findDayFor(leg, group, blocks, slot, blocks[i].item_id ? items.get(blocks[i].item_id!) : undefined, day.id);
      if (to) {
        moveSlot(blocks, slot, to);
        reorderDay(blocks, to);
      } else {
        notes.push(`${cap1(dayLabel(day.date))} quedaba largo: saqué ${label(blocks[i])}.`);
        blocks = removeSlot(blocks, slot);
      }
      continue;
    }

    if (issue.kind === 'no_meal' && day) {
      // Sin red no podemos buscar un lugar: dejamos el hueco marcado para que el grupo elija dónde.
      const lunch = /almuerzo/.test(issue.text);
      const dayIdxs = blocks.map((b, i) => (b.day_id === day.id ? i : -1)).filter((i) => i >= 0);
      const maxOrder = dayIdxs.reduce((m, i) => Math.max(m, blocks[i].sort_order ?? 0), 0);
      const dinner = dayIdxs.find((i) => isDinner(blocks[i]));
      const at = lunch ? Math.ceil((maxOrder + 1) / 2) : maxOrder + 1;
      if (lunch && dinner != null) {
        // El almuerzo va a la mitad; corremos lo que sigue.
        for (const i of dayIdxs) if ((blocks[i].sort_order ?? 0) >= at) blocks[i] = { ...blocks[i], sort_order: (blocks[i].sort_order ?? 0) + 1 };
      }
      blocks.push({
        type: 'meal',
        title: lunch ? 'Almuerzo por la zona' : 'Cena por la zona',
        description: 'Elegí dónde comer cerca de lo que estén haciendo.',
        time_flex: lunch ? 'afternoon' : 'evening',
        duration_min: lunch ? MEALS.lunch.dur : MEALS.dinner.dur,
        status: 'idea',
        sort_order: at,
        day_id: day.id,
        choice_key: null,
        item_id: null,
        option_id: null,
      });
      continue;
    }
    unfixable.add(keyOf(issue));
  }

  const left = checkPlan(leg, blocks, group, ctx)
    .filter((i) => i.kind !== 'far' && !(unfixable.has(keyOf(i)) && (i.kind === 'closed' || i.kind === 'outdoor_rain' || i.kind === 'too_long')))
    .map((i) => i.text);
  return { blocks, issues: [...new Set([...notes, ...left])] };
}
