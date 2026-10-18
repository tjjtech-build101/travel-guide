// Armador de días del planificador colaborativo (PRD 31). Con lo que el grupo eligió del catálogo del destino arma
// días geográficamente lógicos, factibles y personalizados, y deja "elegí 1 de N" donde hay decisiones reales.
// Determinístico salvo la búsqueda de comidas y alojamiento (deps.searchPlaces).
//
// Pasos:
//  1. Marco de cada día (check.ts → dayFrame): capacidad según ritmo recortada por llegada/salida, arranque según
//     cronotipo, horas de comida, lluvia. La instrucción libre ajusta lo obvio ("tranqui", "el martes tarde libre").
//  2. Anclas: eventos con fecha van a su día (hora fija si la hay); escapadas ocupan un día entero que no sea de
//     llegada ni de salida, preferentemente sin lluvia.
//  3. Zonas: agrupamos por `zone` (y por cercanía si viene null o la zona es enorme) y asignamos zonas a días por
//     fases de prioridad: primero los "sí o sí" de alguien, después los imperdibles del catálogo, después el resto.
//     Costo de un día = distancia al centro de lo que ya tiene + carga + clima (lo de afuera nunca el día de lluvia
//     si hay otro; lo cubierto, mejor ese día). Lo que no abre ese día ni se considera.
//  4. "Elegí 1 de N" en actividades: como mucho una por día, con lo bueno que no entró de la misma zona y duración
//     parecida. Nunca con un imperdible.
//  5. Orden del día: vecino más cercano + 2-opt desde el alojamiento, después orden estable por franja (mañana →
//     tarde → atardecer → noche). Almuerzo y cena se intercalan por hora.
//  6. Comidas: primero lo de comida que eligió el grupo y queda cerca; si no, search_places cerca de donde van a
//     estar. La cena siempre es "elegí 1 de 3". Lugares exactos del resultado: nunca inventados.
//  7. Alojamiento si no hay: "elegí 1 de N" hoteles en las zonas recomendadas, el primer día.
//  8. Chequeo + arreglo mínimo (check.ts). Lo que no entró vuelve en `unplaced` con el motivo.
import { distanceMeters, type CatalogItem } from '@build101/shared';
import type { PlaceSummary } from '../../google/places';
import {
  checkPlan,
  dayFrame,
  fmtMin,
  hasLL,
  isOpenOn,
  MEALS,
  RAIN_PROB,
  repairPlan,
  toMin,
  transferFor,
  travelMin,
  weekdayName,
  weekdayOf,
  type DayFrame,
} from './check';
import type { ComposeDeps, ComposedBlock, ComposeInput, ComposeOutput, PickedItem, PlannerGroup } from './types';
import { orFallback } from '../../errors';

type LL = { lat: number; lng: number };

/** Un ítem elegido, con lo que el armado necesita a mano. */
type Prep = {
  pick: PickedItem;
  item: CatalogItem;
  /** 3 = sí o sí de alguien · 2 = imperdible del catálogo · 1 = el resto. */
  rank: number;
  ll: LL | null;
  cluster: number;
};

/** Un lugar del día: una actividad, o una elección entre varias (la primera es la mejor). */
type Unit = { main: Prep; alts: Prep[]; fixedStart: number | null; dayTrip: boolean };

type DayState = {
  id: string;
  date: string;
  frame: DayFrame;
  /** Tarde libre por instrucción. */
  pmOff: boolean;
  units: Unit[];
  used: number;
  dayTrip: boolean;
  hasEvent: boolean;
};

/** Costo "día vacío" en metros: abrir un día nuevo equivale a caminar 2 km. Así las zonas vecinas se juntan. */
const EMPTY_DAY_M = 2000;
/** Un día con zona igual al ítem: bonus fuerte. */
const SAME_ZONE_M = -800;
/** Bonus por minuto de zona que se hace junta el mismo día (en metros equivalentes). */
const MINUTE_M = 5;
/** Distancia máxima de un ítem suelto (no imperdible) al centro de un día que ya tiene cosas. */
const LOOSE_MAX_M = 3500;

// ───────────────────────── Utilidades

const prio = (a: Prep, b: Prep) =>
  b.rank - a.rank || b.pick.score - a.pick.score || b.item.notability - a.item.notability || a.item.id.localeCompare(b.item.id);

const centroid = (pts: LL[]): LL | null =>
  pts.length ? { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length } : null;

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const joinY = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** ¿La franja del ítem existe ese día? (una cosa de noche no va el día que te vas a las 18). */
function fitsTime(item: CatalogItem, f: DayFrame): boolean {
  switch (item.best_time) {
    case 'morning':
      return f.start <= 11 * 60;
    case 'sunset':
      return f.end >= (f.sunset ?? 19 * 60) && f.start <= (f.sunset ?? 19 * 60) - 60;
    case 'night':
      return f.end >= 22 * 60 + 30;
    case 'evening':
      return f.end >= 20 * 60;
    default:
      return f.end - f.start >= Math.min(item.duration_min, 120);
  }
}

/** Orden de franja: mañana 0, mediodía 1, tarde 2, atardecer 3, tardecita 3.5, noche 4. any = hereda. */
function slotRank(u: Unit, f: DayFrame): number | null {
  if (u.fixedStart != null) {
    if (f.lunch != null && u.fixedStart < f.lunch) return 0.5;
    if (f.dinner != null && u.fixedStart >= f.dinner) return 4.5;
    return 2.5;
  }
  const it = u.main.item;
  if (it.category === 'nightlife') return 4;
  switch (it.best_time) {
    case 'morning':
      return 0;
    case 'midday':
      return 1;
    case 'afternoon':
      return 2;
    case 'sunset':
      return 3;
    case 'evening':
      return 3.5;
    case 'night':
      return 4;
    default:
      return null;
  }
}

// ───────────────────────── Instrucción libre

const WD_RX: [RegExp, number][] = [
  [/\bdomingo/, 0],
  [/\blunes/, 1],
  [/\bmartes/, 2],
  [/\bmiercoles/, 3],
  [/\bjueves/, 4],
  [/\bviernes/, 5],
  [/\bsabado/, 6],
];

/** Lo obvio de la instrucción, determinístico. Lo que no entendemos se ignora (lo usa el LLM en otra capa). */
export function parseInstruction(text: string | null | undefined, dates: string[]): { capFactor: number; pmOff: Set<string> } {
  const t = norm(text);
  const pmOff = new Set<string>();
  if (!t) return { capFactor: 1, pmOff };
  const capFactor = /tranqu|relajad|mas lento|descans|sin apuro/.test(t) ? 0.8 : 1;
  if (/tarde libre|tardes libres|libres? (a|por) la tarde|nada (a|por) la tarde/.test(t)) {
    for (const [rx, wd] of WD_RX) if (rx.test(t)) dates.filter((d) => weekdayOf(d) === wd).forEach((d) => pmOff.add(d));
    for (const m of t.matchAll(/\bel (\d{1,2})\b/g)) dates.filter((d) => Number(d.slice(8, 10)) === Number(m[1])).forEach((d) => pmOff.add(d));
    if (/primer dia/.test(t) && dates[0]) pmOff.add(dates[0]);
    if (/ultimo dia/.test(t) && dates.length) pmOff.add(dates[dates.length - 1]);
  }
  return { capFactor, pmOff };
}

// ───────────────────────── Zonas

/** Agrupa por zona; los sin zona se suman a la zona más cercana (≤1,5 km) y las zonas enormes se parten en dos. */
export function clusterItems(items: { id: string; zone: string | null; ll: LL | null }[]): Map<string, number> {
  type C = { ids: string[]; pts: LL[]; zone: string | null };
  const clusters: C[] = [];
  const byZone = new Map<string, C>();
  const located = items.filter((x) => x.ll);
  for (const x of located) {
    if (!x.zone) continue;
    const k = norm(x.zone);
    if (!byZone.has(k)) {
      const c = { ids: [], pts: [], zone: k };
      byZone.set(k, c);
      clusters.push(c);
    }
    byZone.get(k)!.ids.push(x.id);
    byZone.get(k)!.pts.push(x.ll!);
  }
  for (const x of located) {
    if (x.zone) continue;
    let best: C | null = null;
    let bd = 1500;
    for (const c of clusters) {
      const d = distanceMeters(centroid(c.pts)!, x.ll!);
      if (d < bd) [bd, best] = [d, c];
    }
    if (best) {
      best.ids.push(x.id);
      best.pts.push(x.ll!);
    } else clusters.push({ ids: [x.id], pts: [x.ll!], zone: null });
  }
  // Zonas enormes (radio > 2,5 km) → 2-means sembrado con el par más lejano.
  const out: C[] = [];
  const queue = [...clusters];
  while (queue.length) {
    const c = queue.shift()!;
    const cen = centroid(c.pts)!;
    const radius = Math.max(...c.pts.map((p) => distanceMeters(cen, p)));
    if (c.pts.length < 4 || radius <= 2500 || out.length + queue.length > 40) {
      out.push(c);
      continue;
    }
    let [ai, bi, bd] = [0, 0, -1];
    for (let i = 0; i < c.pts.length; i++)
      for (let j = i + 1; j < c.pts.length; j++) {
        const d = distanceMeters(c.pts[i], c.pts[j]);
        if (d > bd) [ai, bi, bd] = [i, j, d];
      }
    let seeds = [c.pts[ai], c.pts[bi]];
    let assign: number[] = [];
    for (let it = 0; it < 6; it++) {
      assign = c.pts.map((p) => (distanceMeters(p, seeds[0]) <= distanceMeters(p, seeds[1]) ? 0 : 1));
      seeds = [0, 1].map((k) => centroid(c.pts.filter((_, i) => assign[i] === k)) ?? seeds[k]);
    }
    const parts = [0, 1].map((k) => ({
      ids: c.ids.filter((_, i) => assign[i] === k),
      pts: c.pts.filter((_, i) => assign[i] === k),
      zone: c.zone,
    }));
    if (parts.some((p) => !p.ids.length)) out.push(c);
    else queue.push(...parts);
  }
  const res = new Map<string, number>();
  out.forEach((c, k) => c.ids.forEach((id) => res.set(id, k)));
  // Sin coordenadas: por nombre de zona si coincide; si no, sueltos (-1).
  for (const x of items) {
    if (res.has(x.id)) continue;
    const k = x.zone ? out.findIndex((c) => c.zone === norm(x.zone)) : -1;
    res.set(x.id, k);
  }
  return res;
}

// ───────────────────────── Ruta del día

/** Vecino más cercano desde `home` + 2-opt (camino abierto). Devuelve el orden de índices. */
export function routeOrder(home: LL | null, pts: LL[]): number[] {
  if (pts.length <= 2) {
    if (pts.length === 2 && home && distanceMeters(home, pts[1]) < distanceMeters(home, pts[0])) return [1, 0];
    return pts.map((_, i) => i);
  }
  const left = new Set(pts.map((_, i) => i));
  const order: number[] = [];
  let cur = home ?? pts[0];
  while (left.size) {
    let bi = -1;
    let bd = Infinity;
    for (const i of left) {
      const d = distanceMeters(cur, pts[i]);
      if (d < bd) [bd, bi] = [d, i];
    }
    order.push(bi);
    left.delete(bi);
    cur = pts[bi];
  }
  const P = (k: number) => (k < 0 ? (home ?? pts[order[0]]) : pts[order[k]]);
  let improved = true;
  for (let pass = 0; improved && pass < 20; pass++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++)
      for (let j = i + 1; j < order.length; j++) {
        const a = P(i - 1);
        const b = P(i);
        const c = P(j);
        const d = j + 1 < order.length ? P(j + 1) : null;
        const before = distanceMeters(a, b) + (d ? distanceMeters(c, d) : 0);
        const after = distanceMeters(a, c) + (d ? distanceMeters(b, d) : 0);
        if (after + 1 < before) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
          improved = true;
        }
      }
  }
  return order;
}

type Step =
  | { kind: 'unit'; unit: Unit; t: number; flex: 'morning' | 'afternoon' | 'evening' | 'fixed' }
  | { kind: 'lunch' | 'dinner'; t: number; anchor: LL | null; near: string | null };

/** Ordena los lugares del día y les intercala almuerzo y cena según la hora. */
function sequenceDay(d: DayState, home: LL | null): Step[] {
  const f = d.frame;
  if (d.dayTrip) {
    const u = d.units.find((x) => x.dayTrip)!;
    const steps: Step[] = [{ kind: 'unit', unit: u, t: f.start, flex: 'morning' }];
    if (f.lunch != null) steps.push({ kind: 'lunch', t: f.lunch, anchor: u.main.ll, near: u.main.item.name });
    if (f.dinner != null) steps.push({ kind: 'dinner', t: f.dinner, anchor: home ?? u.main.ll, near: null });
    return steps;
  }
  const located = d.units.filter((u) => u.main.ll);
  const order = routeOrder(home, located.map((u) => u.main.ll!));
  const seq = [...order.map((i) => located[i]), ...d.units.filter((u) => !u.main.ll)];
  // Lo que tiene franja va en orden de franja (y de ruta dentro de la franja). Lo "cuando quieras" se inserta
  // donde menos desvío agrega, después de lo de mañana y antes del atardecer/noche.
  const withRank = seq.map((u, k) => ({ u, r: slotRank(u, f), k }));
  const line = withRank
    .filter((x) => x.r != null)
    .sort((a, b) => a.r! - b.r! || (a.u.fixedStart ?? 0) - (b.u.fixedStart ?? 0) || a.k - b.k)
    .map((x) => ({ u: x.u, r: x.r! }));
  for (const { u } of withRank.filter((x) => x.r == null)) {
    const lastMorning = line.reduce((m, x, i) => (x.r === 0 ? i : m), -1);
    const firstLate = line.findIndex((x) => x.r >= 3);
    const lo = lastMorning + 1;
    const hi = firstLate < 0 ? line.length : Math.max(lo, firstLate);
    let pos = hi;
    if (u.main.ll) {
      let bc = Infinity;
      for (let i = lo; i <= hi; i++) {
        const a = i === 0 ? home : line[i - 1].u.main.ll;
        const b = i < line.length ? line[i].u.main.ll : null;
        const c = (a ? distanceMeters(a, u.main.ll) : 0) + (b ? distanceMeters(u.main.ll, b) : 0) - (a && b ? distanceMeters(a, b) : 0);
        if (c < bc) [bc, pos] = [c, i];
      }
    }
    // Hereda la franja del vecino para que el orden de comidas lo trate igual.
    const r = pos > 0 ? Math.min(line[pos - 1].r, 2) : 0;
    line.splice(pos, 0, { u, r });
  }
  const ranked = line;

  const steps: Step[] = [];
  let t = f.start;
  let prev: LL | null = home;
  let lunchDone = f.lunch == null;
  let dinnerDone = f.dinner == null;
  const anchorNear = (next: Unit | null): { anchor: LL | null; near: string | null } => {
    const lastUnit = [...steps].reverse().find((s) => s.kind === 'unit') as Extract<Step, { kind: 'unit' }> | undefined;
    const pts = [lastUnit?.unit.main.ll, next?.main.ll].filter(Boolean) as LL[];
    return { anchor: centroid(pts) ?? prev ?? home, near: lastUnit?.unit.main.item.name ?? next?.main.item.name ?? null };
  };
  const meals = (next: Unit | null, r: number) => {
    const dur = next ? next.main.item.duration_min : 0;
    const L = f.lunch;
    if (!lunchDone && L != null) {
      const fixedAfter = next?.fixedStart != null && next.fixedStart >= L + MEALS.lunch.dur - 15;
      if (!next || t >= L - 30 || (r >= 2 && t >= L - 120) || (t + dur > L + 60 && t >= L - 90) || fixedAfter) {
        const at = Math.max(t, L - 30);
        steps.push({ kind: 'lunch', t: at, ...anchorNear(next) });
        t = at + MEALS.lunch.dur;
        lunchDone = true;
      }
    }
    const D = f.dinner;
    if (!dinnerDone && D != null) {
      const fixedAfter = next?.fixedStart != null && next.fixedStart >= D + MEALS.dinner.dur - 15;
      if (!next || t >= D - 15 || r >= 4 || (t + dur > D + 45 && t >= D - 90) || fixedAfter) {
        const at = Math.max(t, D);
        steps.push({ kind: 'dinner', t: at, ...anchorNear(next) });
        t = at + MEALS.dinner.dur;
        dinnerDone = true;
      }
    }
  };
  const queue = [...ranked];
  const hop = (u: Unit) => (u.main.ll && prev ? travelMin(prev, u.main.ll) : 0);
  while (queue.length) {
    let k = 0;
    const head = queue[0].u;
    if (head.fixedStart != null) {
      // Hueco antes de una hora fija: lo llenamos con lo flexible de día que entre, en el orden de la ruta.
      const gapEnd = head.fixedStart - hop(head);
      const cand = queue.findIndex((x, j) => j > 0 && x.u.fixedStart == null && x.r < 3 && t + hop(x.u) + x.u.main.item.duration_min <= gapEnd);
      if (cand > 0) k = cand;
    }
    const { u, r } = queue.splice(k, 1)[0];
    meals(u, r);
    if (u.main.ll && prev) t += travelMin(prev, u.main.ll);
    if (u.fixedStart != null) t = Math.max(t, u.fixedStart);
    const flex: Extract<Step, { kind: 'unit' }>['flex'] =
      u.fixedStart != null ? 'fixed' : !lunchDone ? 'morning' : !dinnerDone ? (t < 13 * 60 ? 'morning' : 'afternoon') : 'evening';
    steps.push({ kind: 'unit', unit: u, t, flex: f.lunch == null && f.dinner == null ? (t < 780 ? 'morning' : t < 1200 ? 'afternoon' : 'evening') : flex });
    t += u.main.item.duration_min;
    if (u.main.ll) prev = u.main.ll;
  }
  meals(null, 9);
  return steps;
}

// ───────────────────────── Textos

function titleFor(it: CatalogItem): string {
  const n = it.name;
  let t: string;
  if (it.category === 'day_trip') t = `Escapada a ${n}`;
  else if (it.category === 'event') t = n;
  else if (it.best_time === 'sunset') t = `Atardecer en ${n}`;
  else if (it.category === 'nightlife') t = `Noche en ${n}`;
  else if (it.category === 'neighborhood') t = `Caminata por ${n}`;
  else if (it.category === 'market') t = `Recorrida por ${n}`;
  else if ((it.category === 'park' || it.category === 'beach') && it.best_time === 'afternoon') t = `Tarde en ${n}`;
  else if (it.category === 'viewpoint') t = `Vista desde ${n}`;
  else t = n;
  return t.slice(0, 200);
}

function namesOf(ids: string[], group: PlannerGroup): string[] {
  return ids.map((id) => group.members.find((m) => m.user_id === id)?.name).filter((x): x is string => !!x);
}

function descriptionFor(p: Prep, group: PlannerGroup): string {
  const it = p.item;
  const parts: string[] = [];
  if (it.category === 'day_trip') {
    const h = Math.round(it.duration_min / 60);
    parts.push(`Escapada de día completo (~${h} h con el traslado ida y vuelta): conviene salir temprano.`);
  }
  if (it.why) parts.push(it.why.trim());
  if (p.pick.reason) parts.push(p.pick.reason.trim());
  else {
    const names = namesOf(p.pick.for_user_ids, group);
    if (names.length) parts.push(`Ideal para ${joinY(names)}.`);
  }
  const mustBy = namesOf(
    p.pick.reactions.filter((r) => r.reaction === 'must').map((r) => r.user_id),
    group,
  );
  if (mustBy.length) parts.push(`Sí o sí para ${joinY(mustBy)}.`);
  if (it.tip) parts.push(`Tip: ${it.tip.trim()}`);
  return parts.join(' ').slice(0, 4000);
}

function sourcesFor(it: CatalogItem): ComposedBlock['sources'] {
  const out: NonNullable<ComposedBlock['sources']> = [];
  for (const s of it.sources ?? []) {
    try {
      const u = new URL(s.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    out.push(s.title ? { url: s.url, title: s.title.slice(0, 200) } : { url: s.url });
    if (out.length >= 5) break;
  }
  return out.length ? out : undefined;
}

const toHHMM = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function geo(x: { google_place_id?: string | null; lat?: number | null; lng?: number | null }) {
  const o: Pick<ComposedBlock, 'google_place_id' | 'lat' | 'lng'> = {};
  if (x.google_place_id) o.google_place_id = x.google_place_id;
  if (typeof x.lat === 'number' && typeof x.lng === 'number') {
    o.lat = x.lat;
    o.lng = x.lng;
  }
  return o;
}

// ───────────────────────── Comidas

const RIOPLATENSE = /argentin|urugu/i;
const RIOPLATENSE_CITIES = /buenos aires|montevideo|cordoba|rosario|mendoza|punta del este|colonia|mar del plata|bariloche|salta/;

function mealQueries(kind: 'lunch' | 'dinner', dayIdx: number, country: string | null, city: string, group: PlannerGroup): string[] {
  const diet = norm(group.dietary.join(' '));
  if (/vegan/.test(diet)) return ['restaurante vegano', 'restaurante vegetariano'];
  if (/veget/.test(diet)) return ['restaurante vegetariano', 'restaurante'];
  if (/celi|gluten|tacc/.test(diet)) return ['restaurante sin TACC', 'restaurante'];
  if (/kosher/.test(diet)) return ['restaurante kosher', 'restaurante'];
  const local = RIOPLATENSE.test(country ?? '') || RIOPLATENSE_CITIES.test(norm(city));
  if (!local) return ['restaurante'];
  const rot = kind === 'dinner' ? ['parrilla', 'restaurante', 'bodegón'] : ['bodegón', 'restaurante'];
  const q = rot[dayIdx % rot.length];
  return [q, ...rot.filter((x) => x !== q)].slice(0, 2);
}

function priceOk(p: PlaceSummary, budget: PlannerGroup['budget']): boolean {
  if (p.price_level == null) return true;
  if (budget === 'low') return p.price_level <= 2;
  if (budget === 'mid') return p.price_level <= 3;
  if (budget === 'high') return p.price_level >= 2;
  return true;
}

/** Elige los mejores lugares de los resultados: con id y coordenadas, sin repetir, rating ≥ 4,2 y precio del grupo. */
function pickPlaces(results: PlaceSummary[], n: number, used: Set<string>, anchor: LL | null, budget: PlannerGroup['budget']): PlaceSummary[] {
  const ok = results.filter((p) => p.google_place_id && hasLL(p) && !used.has(p.google_place_id));
  const rank = (p: PlaceSummary) => (p.rating ?? 4.0) - (anchor ? distanceMeters(anchor, p as LL) / 2000 : 0) * 0.3;
  const tiers = [
    ok.filter((p) => (p.rating == null || p.rating >= 4.2) && priceOk(p, budget)),
    ok.filter((p) => priceOk(p, budget)),
    ok,
  ];
  const out: PlaceSummary[] = [];
  for (const tier of tiers) {
    for (const p of [...tier].sort((a, b) => rank(b) - rank(a) || a.google_place_id.localeCompare(b.google_place_id))) {
      if (out.length >= n) break;
      if (!out.includes(p)) out.push(p);
    }
    if (out.length >= n) break;
  }
  return out;
}

// ───────────────────────── Armado

export async function composeLeg(input: ComposeInput, deps: ComposeDeps): Promise<ComposeOutput> {
  const { leg, group } = input;
  const dates = leg.days.map((d) => d.date);
  const { capFactor, pmOff } = parseInstruction(input.instruction, dates);
  const unplaced: ComposeOutput['unplaced'] = [];
  const nDays = leg.days.length;

  const days: DayState[] = leg.days.map((d) => {
    const frame = dayFrame(leg, group, d.date, capFactor);
    const off = pmOff.has(d.date);
    // Tarde libre: solo entra la mañana.
    if (off) frame.cap = Math.max(0, Math.min(frame.cap, (frame.lunch ?? 13 * 60) - frame.start - 15));
    return { id: d.id, date: d.date, frame, pmOff: off, units: [], used: 0, dayTrip: false, hasEvent: false };
  });

  const zoneLL = leg.lodgingZones.find((z) => z.lat != null && z.lng != null);
  const home: LL | null = leg.lodging ?? (zoneLL ? { lat: zoneLL.lat!, lng: zoneLL.lng! } : null) ?? leg.center ?? null;
  const homeLL = home && hasLL(home) ? { lat: home.lat, lng: home.lng } : null;

  // Deduplicamos picks por ítem (el mismo lugar no entra dos veces aunque venga de dos secciones).
  const seenItems = new Set<string>();
  const preps: Prep[] = [];
  for (const pick of input.picks) {
    if (seenItems.has(pick.item.id)) continue;
    seenItems.add(pick.item.id);
    const it = pick.item;
    preps.push({
      pick,
      item: it,
      rank: pick.must ? 3 : it.tier === 'must' ? 2 : 1,
      ll: hasLL(it) ? { lat: it.lat, lng: it.lng } : null,
      cluster: -1,
    });
  }
  const isEvent = (p: Prep) => !!p.item.event_dates?.length;
  const food = preps.filter((p) => p.item.category === 'food' && !isEvent(p)).sort(prio);
  const events = preps.filter(isEvent).sort(prio);
  const trips = preps.filter((p) => p.item.category === 'day_trip' && !isEvent(p)).sort(prio);
  const regular = preps.filter((p) => !isEvent(p) && p.item.category !== 'food' && p.item.category !== 'day_trip');

  // Los eventos entran al clustering para que su zona tire hacia su día (el partido en La Boca atrae a La Boca).
  const clusters = clusterItems([...regular, ...events].map((p) => ({ id: p.item.id, zone: p.item.zone, ll: p.ll })));
  for (const p of [...regular, ...events]) p.cluster = clusters.get(p.item.id) ?? -1;

  const openOn = (p: Prep, d: DayState) => isOpenOn(p.item, d.date, d.frame.start, d.frame.end);
  const legWds = [...new Set(dates.map(weekdayOf))];
  const closedReason = (it: CatalogItem): string => {
    const closes = it.closed_days.filter((w) => legWds.includes(w));
    const cl = closes.length ? `cierra los ${joinY(closes.map(weekdayName))}` : 'no abre en los horarios que estás';
    const legTxt = legWds.length === 1 ? `estás solo el ${weekdayName(legWds[0])}` : `estás ${joinY(legWds.map((w) => `el ${weekdayName(w)}`))}`;
    return `${cl} y ${legTxt}`;
  };
  const capReason = () => `no entró en ${nDays} ${nDays === 1 ? 'día' : 'días'}: priorizá otro o sumá un día`;
  const place = (d: DayState, u: Unit) => {
    d.units.push(u);
    d.used += u.main.item.duration_min;
  };
  const unitOf = (p: Prep, fixedStart: number | null = null, dayTrip = false): Unit => ({ main: p, alts: [], fixedStart, dayTrip });

  // ── 2a. Eventos con fecha: a su día (el menos cargado si hay varias fechas).
  for (const p of events) {
    const inLeg = (p.item.event_dates ?? []).filter((d) => dates.includes(d));
    if (!inLeg.length) {
      const ds = (p.item.event_dates ?? []).slice(0, 2).join(' y ');
      unplaced.push({ item: p.item, option_id: p.pick.option_id, reason: `es ${ds ? `el ${ds}` : 'otro día'} y no estás en ${leg.city} esa fecha` });
      continue;
    }
    const tm = toMin(p.item.event_time);
    const cands = days
      .filter((d) => inLeg.includes(d.date) && !d.dayTrip)
      .filter((d) => tm == null || (tm >= d.frame.start - 60 && tm + Math.min(p.item.duration_min, 60) <= d.frame.end))
      .filter((d) => d.used + p.item.duration_min <= d.frame.cap * 1.15)
      .sort((a, b) => a.used - b.used || a.date.localeCompare(b.date));
    if (!cands.length) {
      const why = tm != null ? `es a las ${fmtMin(tm)} y ese día no te da el horario (llegada o salida)` : 'ese día ya está lleno';
      unplaced.push({ item: p.item, option_id: p.pick.option_id, reason: why });
      continue;
    }
    place(cands[0], unitOf(p, tm));
    cands[0].hasEvent = true;
  }

  // ── 2b. Escapadas: día entero, nunca llegada/salida, mejor sin lluvia. Si no es imperdible, solo si quedan ≥2 días
  // enteros (para no comerse la ciudad).
  // El primero y el último del tramo son de llegada/salida (traslado de por medio): nunca escapada.
  const fullDays = days.filter((d, k) => d.frame.full && ((k > 0 && k < days.length - 1) || !leg.dayWindows[d.date]));
  let tripsPlaced = 0;
  for (const p of trips) {
    const maxTrips = Math.floor(fullDays.length / 2) + (p.rank >= 2 && fullDays.length === 1 ? 1 : 0);
    if (tripsPlaced >= maxTrips) {
      const reason = fullDays.length
        ? tripsPlaced
          ? 'ya hay una escapada y otra te come la ciudad: si te tienta más, cambiala por esta'
          : 'es una escapada de día completo y con un solo día entero te quedás sin ciudad'
        : 'es una escapada de día completo y no te queda ningún día entero (los de llegada y salida no alcanzan)';
      unplaced.push({ item: p.item, option_id: p.pick.option_id, reason });
      continue;
    }
    const cands = fullDays
      .filter((d) => !d.dayTrip && !d.hasEvent && !d.units.length && !d.pmOff && openOn(p, d))
      .sort((a, b) => (p.item.indoor ? 0 : a.frame.rain - b.frame.rain) || a.date.localeCompare(b.date));
    if (!cands.length) {
      unplaced.push({ item: p.item, option_id: p.pick.option_id, reason: 'es de día completo y no queda un día entero libre (sin eventos ni llegada/salida)' });
      continue;
    }
    const d = cands[0];
    place(d, unitOf(p, null, true));
    d.dayTrip = true;
    d.used = Math.max(d.used, d.frame.cap);
    tripsPlaced++;
  }

  // ── 3. Zonas → días, por fases de prioridad.
  const dayCenter = (d: DayState) => centroid(d.units.map((u) => u.main.ll).filter(Boolean) as LL[]);
  const outdoorShare = (g: Prep[]) => {
    const tot = g.reduce((s, p) => s + p.item.duration_min, 0) || 1;
    return g.filter((p) => !p.item.indoor).reduce((s, p) => s + p.item.duration_min, 0) / tot;
  };
  const eligible = (d: DayState, g: Prep[], allowRain: boolean) => {
    if (d.dayTrip) return false;
    const mins = g.reduce((s, p) => s + p.item.duration_min, 0);
    if (d.used + mins > d.frame.cap) return false;
    for (const p of g) {
      if (!openOn(p, d) || !fitsTime(p.item, d.frame)) return false;
      if (!allowRain && !p.item.indoor && d.frame.rain >= RAIN_PROB) return false;
      // Tarde libre: nada que sea de tarde/noche.
      if (d.pmOff && ['afternoon', 'sunset', 'evening', 'night'].includes(p.item.best_time)) return false;
    }
    return true;
  };
  const cost = (d: DayState, g: Prep[]) => {
    const c = centroid(g.map((p) => p.ll).filter(Boolean) as LL[]);
    const dc = dayCenter(d);
    let geoCost = dc && c ? distanceMeters(c, dc) : EMPTY_DAY_M;
    if (d.units.some((u) => g.some((p) => p.cluster >= 0 && p.cluster === u.main.cluster))) geoCost += SAME_ZONE_M;
    const mins = g.reduce((s, p) => s + p.item.duration_min, 0);
    const load = ((d.used + mins) / Math.max(1, d.frame.cap)) * 800;
    const out = outdoorShare(g);
    // Lluvia: lo de afuera paga, lo cubierto gana un poco (es el día ideal para el museo).
    const wx = d.frame.rain * (out * 2500 - (1 - out) * 400);
    return geoCost + load + wx;
  };
  const best = (g: Prep[], allowRain: boolean, maxDistM = Infinity): DayState | null => {
    let b: DayState | null = null;
    let bc = Infinity;
    for (const d of days) {
      if (!eligible(d, g, allowRain)) continue;
      const dc = dayCenter(d);
      const gc = centroid(g.map((p) => p.ll).filter(Boolean) as LL[]);
      if (dc && gc && distanceMeters(dc, gc) > maxDistM) continue;
      const c = cost(d, g);
      if (c < bc) [bc, b] = [c, d];
    }
    return b;
  };

  const leftovers: Prep[] = [];
  const rainAlert = new Set<string>();
  /** Un ítem suelto a su mejor día. Lo de afuera solo va a un día de lluvia si es imperdible (con aviso). */
  let allowRainForMust = false;
  const placeOne = (p: Prep) => {
    // Lo que no es imperdible no cruza la ciudad para meterse en un día de otra zona: mejor queda afuera (y puede
    // ser opción de una elección) que armar un día en zigzag.
    const d = best([p], false, p.rank >= 2 ? Infinity : LOOSE_MAX_M) ?? (p.rank >= 2 && allowRainForMust ? best([p], true) : null);
    if (!d) return false;
    if (!p.item.indoor && d.frame.rain >= RAIN_PROB) rainAlert.add(p.item.id);
    place(d, unitOf(p));
    return true;
  };
  // Zonas enteras primero (así un día es "Recoleta" y no "un poco de todo"). Orden: las que tienen lo más
  // prioritario, después las de más puntaje total. Dentro de la zona, por prioridad.
  const zoneGroups = new Map<string, Prep[]>();
  for (const p of regular) {
    const k = p.cluster >= 0 ? `c${p.cluster}` : `i:${p.item.id}`;
    if (!zoneGroups.has(k)) zoneGroups.set(k, []);
    zoneGroups.get(k)!.push(p);
  }
  const sumScore = (g: Prep[]) => g.reduce((s, p) => s + p.pick.score, 0);
  const ordered = [...zoneGroups.values()]
    .map((g) => g.sort(prio))
    .sort((a, b) => b[0].rank - a[0].rank || sumScore(b) - sumScore(a) || prio(a[0], b[0]));
  // Dos pasadas: primero solo los imperdibles de cada zona (así ningún "lindo" le gana el día a un imperdible),
  // después el resto, que se pega a donde quedó su zona gracias al bonus de misma zona.
  for (const pass of ['must', 'rest'] as const) {
    for (const full of ordered) {
      const g = full.filter((p) => (pass === 'must' ? p.rank >= 2 : p.rank < 2));
      if (!g.length) continue;
      // Para cada día, la parte de la zona que se puede hacer ese día (abre, no llueve si es de afuera, entra en la
      // franja y en la capacidad, en orden de prioridad). Gana el día más barato entre los que se llevan lo más
      // prioritario, con bonus por minutos juntos: preferimos la zona entera, pero un museo que cierra el lunes no
      // arrastra a toda Recoleta a un día lejano.
      let pickDay: { d: DayState; sub: Prep[]; c: number } | null = null;
      for (const d of days) {
        const free = { ...d, used: 0 };
        if (!eligible(free, [g[0]], false)) continue;
        const sub: Prep[] = [];
        let used = d.used;
        for (const p of g) {
          if (!eligible(free, [p], false) || used + p.item.duration_min > d.frame.cap) continue;
          sub.push(p);
          used += p.item.duration_min;
        }
        if (!sub.length || sub[0] !== g[0]) continue;
        const c = cost(d, sub) - sub.reduce((s, p) => s + p.item.duration_min, 0) * MINUTE_M;
        if (!pickDay || c < pickDay.c) pickDay = { d, sub, c };
      }
      const rest = pickDay ? g.filter((p) => !pickDay!.sub.includes(p)) : g;
      if (pickDay) for (const p of pickDay.sub) place(pickDay.d, unitOf(p));
      for (const p of rest) if (!placeOne(p)) leftovers.push(p);
    }
  }

  // Un imperdible que no entró desplaza a lo de menor prioridad del día donde mejor queda.
  for (const p of leftovers.filter((x) => x.rank >= 2).sort(prio)) {
    let bestDay: { d: DayState; evict: Unit[]; cost: number } | null = null;
    for (const d of days) {
      if (d.dayTrip) continue;
      const free = { ...d, used: 0 } as DayState;
      if (!eligible(free, [p], false)) continue;
      const evictable = d.units
        .filter((u) => u.fixedStart == null && !u.dayTrip && u.main.rank < p.rank && !u.alts.length)
        .sort((a, b) => prio(b.main, a.main));
      const evict: Unit[] = [];
      let used = d.used;
      while (used + p.item.duration_min > d.frame.cap && evict.length < evictable.length) {
        const u = evictable[evict.length];
        evict.push(u);
        used -= u.main.item.duration_min;
      }
      if (used + p.item.duration_min > d.frame.cap) continue;
      const c = evict.reduce((s, u) => s + u.main.pick.score * 1000 + u.main.rank * 5000, 0) + cost(d, [p]);
      if (!bestDay || c < bestDay.cost) bestDay = { d, evict, cost: c };
    }
    if (!bestDay) continue;
    for (const u of bestDay.evict) {
      bestDay.d.units.splice(bestDay.d.units.indexOf(u), 1);
      bestDay.d.used -= u.main.item.duration_min;
      leftovers.push(u.main);
    }
    leftovers.splice(leftovers.indexOf(p), 1);
    if (!p.item.indoor && bestDay.d.frame.rain >= RAIN_PROB) rainAlert.add(p.item.id);
    place(bestDay.d, unitOf(p));
  }
  // Lo desplazado prueba suerte en otro día; un imperdible al aire libre, como último recurso, va con lluvia (y aviso).
  allowRainForMust = true;
  for (const p of [...leftovers].sort(prio)) if (placeOne(p)) leftovers.splice(leftovers.indexOf(p), 1);

  // ── 4. "Elegí 1 de N" en actividades: como mucho una por día, con lo bueno que no entró.
  const DAYTIME = ['any', 'morning', 'midday', 'afternoon'];
  const sameSlot = (a: CatalogItem, b: CatalogItem) =>
    a.best_time === b.best_time || (DAYTIME.includes(a.best_time) && DAYTIME.includes(b.best_time));
  const similar = (a: Prep, b: Prep) =>
    sameSlot(a.item, b.item) &&
    Math.abs(a.item.duration_min - b.item.duration_min) <= Math.max(30, a.item.duration_min * 0.35) &&
    ((a.cluster >= 0 && a.cluster === b.cluster) || (!!a.ll && !!b.ll && distanceMeters(a.ll, b.ll) <= 1200));
  const choosable = (p: Prep) => p.rank === 1 && p.item.tier !== 'must' && p.item.category !== 'event' && p.item.category !== 'day_trip';
  for (const d of days) {
    if (d.dayTrip) continue;
    const mains = d.units.filter((u) => u.fixedStart == null && !u.dayTrip && choosable(u.main)).sort((a, b) => prio(a.main, b.main));
    for (const u of mains) {
      const alts = leftovers
        .filter((p) => choosable(p) && similar(u.main, p) && openOn(p, d) && fitsTime(p.item, d.frame))
        .filter((p) => p.item.indoor || d.frame.rain < RAIN_PROB)
        .sort(prio)
        .slice(0, 2);
      if (!alts.length) continue;
      u.alts = alts;
      for (const a of alts) leftovers.splice(leftovers.indexOf(a), 1);
      break;
    }
  }
  for (const p of leftovers) {
    const open = days.filter((d) => openOn(p, d));
    let reason: string;
    if (!open.length) reason = closedReason(p.item);
    else if (!open.some((d) => fitsTime(p.item, d.frame)))
      reason = p.item.best_time === 'night' || p.item.best_time === 'evening' ? 'es de noche y ningún día te queda la noche libre' : 'no hay un día con el horario que pide';
    else reason = capReason();
    unplaced.push({ item: p.item, option_id: p.pick.option_id, reason });
  }

  // ── 5. Orden de cada día.
  const plans = days.map((d) => ({ d, steps: sequenceDay(d, homeLL) }));

  // ── 6. Comidas: primero lo de comida que eligió el grupo, después búsqueda.
  type MealSlot = { d: DayState; dayIdx: number; step: Extract<Step, { kind: 'lunch' | 'dinner' }>; food: Prep | null; places: PlaceSummary[] };
  const slots: MealSlot[] = [];
  plans.forEach(({ d, steps }, dayIdx) => {
    for (const s of steps) if (s.kind !== 'unit') slots.push({ d, dayIdx, step: s, food: null, places: [] });
  });
  for (const p of food) {
    const wantsDinner = ['evening', 'night', 'sunset'].includes(p.item.best_time);
    const wantsLunch = ['morning', 'midday'].includes(p.item.best_time);
    let bs: MealSlot | null = null;
    let bd = Infinity;
    for (const s of slots) {
      if (s.food) continue;
      if ((wantsDinner && s.step.kind !== 'dinner') || (wantsLunch && s.step.kind !== 'lunch')) continue;
      if (!isOpenOn(p.item, s.d.date, s.step.t, s.step.t + 120)) continue;
      const dist = p.ll && s.step.anchor ? distanceMeters(p.ll, s.step.anchor) : 1e7;
      if (dist < bd) [bd, bs] = [dist, s];
    }
    // Un "sí o sí" va a la comida más cercana aunque quede lejos; lo demás, solo si está a ≤2 km.
    if (bs && (p.rank >= 2 || bd <= 2000)) bs.food = p;
    else
      unplaced.push({
        item: p.item,
        option_id: p.pick.option_id,
        reason: bs
          ? `no quedó cerca de ninguna comida del plan${p.item.zone ? ` (está en ${p.item.zone})` : ''}: si lo querés sí o sí, marcalo y lo armo alrededor`
          : slots.length
            ? closedReason(p.item)
            : 'no hay comidas en el plan de este tramo',
      });
  }

  // Búsquedas en paralelo (con caché), selección en serie para no repetir lugares.
  const cache = new Map<string, Promise<PlaceSummary[]>>();
  const search = (query: string, near: LL | null) => {
    const key = `${query}|${near ? `${near.lat.toFixed(3)},${near.lng.toFixed(3)}` : ''}`;
    if (!cache.has(key))
      cache.set(
        key,
        deps
          .searchPlaces({ query: `${query} ${near ? '' : leg.city}`.trim(), near: near ?? undefined, radius_m: 1500, max_results: 10 })
          .catch(orFallback([] as PlaceSummary[])),
      );
    return cache.get(key)!;
  };
  const used = new Set<string>(food.map((p) => p.item.google_place_id).filter((x): x is string => !!x));
  const need = (s: MealSlot) => {
    if (s.step.kind === 'lunch') return s.food ? 0 : 1;
    if (s.food) return s.food.rank >= 2 || s.food.item.tier === 'must' ? 0 : 2;
    return 3;
  };
  const results = await Promise.all(
    slots.map(async (s) => {
      if (!need(s)) return [] as PlaceSummary[];
      const qs = mealQueries(s.step.kind, s.dayIdx, leg.country, leg.city, group);
      const lists = await Promise.all(qs.map((q) => search(q, s.step.anchor ?? leg.center)));
      return lists.flat();
    }),
  );
  slots.forEach((s, i) => {
    s.places = pickPlaces(results[i], need(s), used, s.step.anchor, group.budget);
    for (const p of s.places) used.add(p.google_place_id);
  });

  // ── 7. Alojamiento si no hay.
  const lodgingBlocks: ComposedBlock[] = [];
  if (!leg.lodging && leg.lodgingZones.length && days.length) {
    const zones = leg.lodgingZones.slice(0, 3);
    const lists = await Promise.all(
      zones.map((z) => {
        const near = z.lat != null && z.lng != null ? { lat: z.lat, lng: z.lng } : leg.center;
        return deps
          .searchPlaces({ query: `hotel ${z.zone}${near ? '' : ` ${leg.city}`}`, near: near ?? undefined, radius_m: 1500, max_results: 5 })
          .catch(orFallback([] as PlaceSummary[]));
      }),
    );
    const chosen: { p: PlaceSummary; z: (typeof zones)[number] }[] = [];
    const usedHotels = new Set<string>();
    const sorted = lists.map((l) => l.filter((p) => p.google_place_id && hasLL(p)).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)));
    // Uno por zona primero (variedad de barrios), después completamos con los siguientes mejores.
    for (let round = 0; round < 3 && chosen.length < 3; round++)
      sorted.forEach((l, k) => {
        if (chosen.length >= 3) return;
        const p = l.find((x) => !usedHotels.has(x.google_place_id));
        if (p && (round === 0 || zones.length < 3)) {
          chosen.push({ p, z: zones[k] });
          usedHotels.add(p.google_place_id);
        }
      });
    const key = chosen.length > 1 ? `lodging:${leg.id}` : null;
    chosen.forEach(({ p, z }) =>
      lodgingBlocks.push({
        type: 'lodging',
        title: `Alojarse en ${z.zone}: ${p.name}`.slice(0, 200),
        description: `Por qué ${z.zone}: ${z.why}${p.rating ? ` · ${p.rating.toFixed(1).replace('.', ',')} ★ en Google` : ''}`.slice(0, 4000),
        place_name: p.name,
        ...geo(p),
        status: 'idea',
        sort_order: 0,
        day_id: days[0].id,
        choice_key: key,
        item_id: null,
        option_id: null,
      }),
    );
  }

  // ── Bloques.
  const blocks: ComposedBlock[] = [...lodgingBlocks];
  const slotByStep = new Map(slots.map((s) => [s.step, s]));
  for (const { d, steps } of plans) {
    let order = 1;
    let prev: LL | null = null;
    const withTransfer = (ll: LL | null) => (ll && prev ? { transfer: transferFor(prev, ll) } : {});
    for (const s of steps) {
      if (s.kind === 'unit') {
        const u = s.unit;
        const opts = [u.main, ...u.alts];
        const key = u.alts.length ? `act:${d.id}` : null;
        for (const p of opts) {
          const it = p.item;
          const b: ComposedBlock = {
            type: 'activity',
            title: titleFor(it),
            description: descriptionFor(p, group),
            place_name: it.name,
            ...geo(it),
            time_flex: s.flex,
            duration_min: Math.max(1, Math.min(24 * 60, Math.round(it.duration_min))),
            status: key ? 'proposed' : 'confirmed',
            sort_order: order,
            day_id: d.id,
            choice_key: key,
            item_id: it.id,
            option_id: p.pick.option_id,
            ...withTransfer(p.ll),
          };
          if (u.fixedStart != null) b.start_time = toHHMM(u.fixedStart);
          if (it.booking !== 'none') b.notes = it.booking === 'required' ? 'Conviene reservar: sin reserva no se entra.' : 'Conviene reservar.';
          const src = sourcesFor(it);
          if (src) b.sources = src;
          if (rainAlert.has(it.id)) b.alerts = [{ kind: 'rain', text: 'Pronóstico de lluvia: es al aire libre, tené un plan B bajo techo.' }];
          blocks.push(b);
        }
        if (u.main.ll) prev = u.main.ll;
        order++;
        continue;
      }
      const slot = slotByStep.get(s)!;
      const lunch = s.kind === 'lunch';
      const flex = lunch ? 'afternoon' : 'evening';
      const dur = lunch ? MEALS.lunch.dur : MEALS.dinner.dur;
      const nearTxt = (pl: LL) => {
        if (!s.anchor || !s.near) return '';
        const m = Math.round(distanceMeters(s.anchor, pl) / 50) * 50;
        return m <= 1500 ? `A ${m < 1000 ? `${Math.max(50, m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`} de ${s.near}.` : '';
      };
      const opts: ComposedBlock[] = [];
      if (slot.food) {
        const p = slot.food;
        opts.push({
          type: 'meal',
          title: `${lunch ? 'Almuerzo' : 'Cena'} en ${p.item.name}`.slice(0, 200),
          description: descriptionFor(p, group),
          place_name: p.item.name,
          ...geo(p.item),
          time_flex: flex,
          duration_min: dur,
          status: 'confirmed',
          sort_order: order,
          day_id: d.id,
          choice_key: null,
          item_id: p.item.id,
          option_id: p.pick.option_id,
          ...(p.item.booking !== 'none' ? { notes: 'Conviene reservar.' } : {}),
          ...(sourcesFor(p.item) ? { sources: sourcesFor(p.item) } : {}),
        });
      }
      for (const pl of slot.places) {
        const rating = pl.rating ? `${pl.rating.toFixed(1).replace('.', ',')} ★ en Google.` : '';
        opts.push({
          type: 'meal',
          title: `${lunch ? 'Almuerzo' : 'Cena'} en ${pl.name}`.slice(0, 200),
          description: [nearTxt(pl as LL), rating].filter(Boolean).join(' ') || undefined,
          place_name: pl.name,
          ...geo(pl),
          time_flex: flex,
          duration_min: dur,
          status: 'confirmed',
          sort_order: order,
          day_id: d.id,
          choice_key: null,
          item_id: null,
          option_id: null,
        });
      }
      if (!opts.length) {
        // Sin resultados: dejamos el hueco marcado (nunca un lugar inventado).
        opts.push({
          type: 'meal',
          title: lunch ? 'Almuerzo por la zona' : 'Cena por la zona',
          description: s.near ? `Buscá algo cerca de ${s.near}.` : 'Elegí dónde comer cerca de lo que estén haciendo.',
          time_flex: flex,
          duration_min: dur,
          status: 'idea',
          sort_order: order,
          day_id: d.id,
          choice_key: null,
          item_id: null,
          option_id: null,
        });
      }
      if (opts.length > 1) {
        const key = `${s.kind}:${d.id}`;
        for (const o of opts) {
          o.choice_key = key;
          o.status = 'proposed';
        }
      }
      const first = opts[0];
      for (const o of opts) blocks.push({ ...o, ...(hasLL(o) ? withTransfer({ lat: o.lat, lng: o.lng }) : {}) });
      if (hasLL(first)) prev = { lat: first.lat, lng: first.lng };
      order++;
    }
  }

  // ── 8. Chequeo + arreglo mínimo.
  const ctx = {
    items: preps.map((p) => p.item),
    scores: Object.fromEntries(preps.map((p) => [p.item.id, p.pick.score])),
    mustIds: preps.filter((p) => p.rank >= 2).map((p) => p.item.id).filter((id) => !unplaced.some((u) => u.item.id === id)),
  };
  const issues = checkPlan(leg, blocks, group, ctx);
  const fixed = repairPlan(leg, blocks, issues, group, ctx);
  // Lo que el arreglo tuvo que sacar también es "no entró".
  const after = new Set(fixed.blocks.map((b) => b.item_id));
  for (const p of preps)
    if (blocks.some((b) => b.item_id === p.item.id) && !after.has(p.item.id))
      unplaced.push({ item: p.item, option_id: p.pick.option_id, reason: 'lo saqué al chequear el día: no entraba sin pasarse de largo' });
  return { blocks: fixed.blocks, unplaced, issues: fixed.issues };
}
