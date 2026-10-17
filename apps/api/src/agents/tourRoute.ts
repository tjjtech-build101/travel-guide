// Selección + ruta del tour (tour director). Todo puro y testeable sin red.
// - placeKind: qué tipo de parada es (diversidad, permanencia, geofence, interior/exterior).
// - scoreForGroup: afinidad con el grupo × notoriedad normalizada × ajustes de contexto (ya escuchado, ya en el
//   plan, lluvia, chicos, primera vez vs conocedores).
// - planRoute: "orienteering problem" con ventanas horarias. Inserción golosa por puntaje/minuto agregado, con
//   penalidad de categorías repetidas, paradas obligatorias, final fijo o libre, tope de caminata, y 2-opt.
//   Las distancias son en línea recta × factor de desvío (el total real lo confirma Google Routes después).
import { affinityScore, distanceMeters, type InterestTag } from '@build101/shared';
import type { OpeningPeriod } from '../google/places';
import type { GroupProfile } from './tourContext';

export type PlaceKind =
  | 'plaza'
  | 'church'
  | 'museum'
  | 'theater'
  | 'monument'
  | 'building'
  | 'market'
  | 'park'
  | 'viewpoint'
  | 'street'
  | 'artwork'
  | 'food'
  | 'other';

const KIND_BY_GOOGLE: [string, PlaceKind][] = [
  ['restaurant', 'food'],
  ['cafe', 'food'],
  ['bakery', 'food'],
  ['ice_cream_shop', 'food'],
  ['coffee_shop', 'food'],
  ['vegan_restaurant', 'food'],
  ['vegetarian_restaurant', 'food'],
  ['market', 'market'],
  ['museum', 'museum'],
  ['art_gallery', 'museum'],
  ['performing_arts_theater', 'theater'],
  ['church', 'church'],
  ['place_of_worship', 'church'],
  ['synagogue', 'church'],
  ['mosque', 'church'],
  ['plaza', 'plaza'],
  ['park', 'park'],
  ['observation_deck', 'viewpoint'],
  ['monument', 'monument'],
  ['sculpture', 'artwork'],
  ['historical_landmark', 'building'],
];

const KIND_BY_OSM: [RegExp, PlaceKind][] = [
  [/tourism=viewpoint/, 'viewpoint'],
  [/tourism=museum/, 'museum'],
  [/tourism=artwork|artwork_type=/, 'artwork'],
  [/amenity=place_of_worship|historic=church|building=(church|cathedral|chapel)/, 'church'],
  [/amenity=theatre/, 'theater'],
  [/amenity=marketplace/, 'market'],
  [/historic=(monument|memorial|statue)|memorial=/, 'monument'],
  [/place=square|highway=pedestrian/, 'plaza'],
  [/leisure=(park|garden)/, 'park'],
  [/historic=(building|castle|fort|city_gate|ruins|manor)/, 'building'],
];

const KIND_BY_NAME: [RegExp, PlaceKind][] = [
  [/\b(mirador|viewpoint)\b/i, 'viewpoint'],
  [/\b(museo|museum|galer[ií]a)\b/i, 'museum'],
  [/\b(iglesia|catedral|parroquia|capilla|bas[ií]lica|convento|templo|sinagoga|church|cathedral)\b/i, 'church'],
  [/\b(teatro|theatre|theater|auditorio)\b/i, 'theater'],
  [/\b(mercado|market|feria)\b/i, 'market'],
  [/\b(monumento|monument|estatua|statue|memorial|mausoleo|obelisco|busto)\b/i, 'monument'],
  [/\b(plaza|square|piazza)\b/i, 'plaza'],
  [/\b(parque|park|jard[ií]n|garden)\b/i, 'park'],
  [/\b(peatonal|calle|avenida|pasaje|rambla|street)\b/i, 'street'],
  [/\b(mural|escultura|sculpture)\b/i, 'artwork'],
  [/\b(palacio|palace|edificio|torre|casa|castillo|fortaleza|ciudadela|puerta|cabildo|aduana)\b/i, 'building'],
  [/\b(caf[eé]|bar|restaurante|parrilla|confiter[ií]a)\b/i, 'food'],
];

/** Tipo de parada a partir de los tipos de Google, los tags OSM (`k=v k=v`) y el nombre. */
export function placeKind(c: { name: string; google_types?: string[]; category_hint?: string }): PlaceKind {
  for (const [t, k] of KIND_BY_GOOGLE) if (c.google_types?.includes(t)) return k;
  const hint = c.category_hint ?? '';
  for (const [re, k] of KIND_BY_OSM) if (re.test(hint)) return k;
  for (const [re, k] of KIND_BY_NAME) if (re.test(c.name)) return k;
  return 'other';
}

/** Tipos que se pueden "visitar" desde afuera aunque estén cerrados (fachada, plaza, monumento). */
const EXTERIOR_OK: Record<PlaceKind, boolean> = {
  plaza: true,
  church: true,
  museum: true,
  theater: true,
  monument: true,
  building: true,
  market: false,
  park: true,
  viewpoint: true,
  street: true,
  artwork: true,
  food: false,
  other: true,
};
export const exteriorOk = (k: PlaceKind) => EXTERIOR_OK[k];

/** Tipos que sirven con lluvia. */
const COVERED: PlaceKind[] = ['church', 'museum', 'theater', 'market', 'food'];
const OPEN_AIR: PlaceKind[] = ['plaza', 'park', 'viewpoint', 'street'];
const KID_FRIENDLY: PlaceKind[] = ['park', 'plaza', 'market', 'viewpoint', 'monument', 'artwork'];

const BASE_DWELL: Record<PlaceKind, number> = {
  plaza: 5,
  church: 4,
  museum: 4,
  theater: 4,
  monument: 3,
  building: 4,
  market: 8,
  park: 6,
  viewpoint: 5,
  street: 4,
  artwork: 3,
  food: 25,
  other: 4,
};
const INTERIOR_DWELL: Partial<Record<PlaceKind, number>> = { church: 8, museum: 15, theater: 6, market: 12 };

/** Minutos de permanencia según tipo, si se entra, y ritmo del grupo. */
export function dwellFor(kind: PlaceKind, opts: { interior: boolean; pace: GroupProfile['pace'] }): number {
  const base = opts.interior ? (INTERIOR_DWELL[kind] ?? BASE_DWELL[kind]) : BASE_DWELL[kind];
  const mult = opts.pace === 'relaxed' ? 1.3 : opts.pace === 'intense' ? 0.8 : 1;
  return Math.max(2, Math.round(base * mult));
}

/** Radio del geofence (PRD 06): 50 m en espacios abiertos, 25 m en calles angostas, 35 m por defecto. */
export function geofenceFor(kind: PlaceKind): number {
  if (kind === 'plaza' || kind === 'park') return 50;
  if (kind === 'market' || kind === 'viewpoint') return 40;
  if (kind === 'street') return 25;
  if (kind === 'monument' || kind === 'artwork') return 30;
  return 35;
}

/** Cantidad de paradas objetivo según duración y ritmo (PRD: ≈ duración/8, entre 3 y 12). */
export function targetStops(durationMin: number, pace: GroupProfile['pace']): number {
  const per = pace === 'relaxed' ? 10 : pace === 'intense' ? 7 : 8;
  return Math.min(12, Math.max(3, Math.round(durationMin / per)));
}

/** Velocidad de caminata (km/h) según ritmo y accesibilidad. */
export function walkKmh(pace: GroupProfile['pace'], stepFree: boolean, kids: boolean): number {
  let v = pace === 'relaxed' ? 3.8 : pace === 'intense' ? 4.8 : 4.3;
  if (stepFree) v -= 0.5;
  if (kids) v -= 0.3;
  return v;
}

// ───────────────────────── Horarios

/** Función "¿abierto en este minuto de la semana?" (0 = domingo 00:00). null = no sabemos. */
export function openAtFn(periods: OpeningPeriod[] | null | undefined): (minuteOfWeek: number) => boolean | null {
  if (!periods || !periods.length) return () => null;
  if (periods.length === 1 && !periods[0].close) return () => true; // 24/7
  const W = 7 * 1440;
  const ranges = periods
    .filter((p) => p.close)
    .map((p) => {
      const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
      let c = p.close!.day * 1440 + p.close!.hour * 60 + p.close!.minute;
      if (c <= o) c += W;
      return [o, c] as const;
    });
  return (m) => {
    const x = ((m % W) + W) % W;
    return ranges.some(([o, c]) => (x >= o && x < c) || (x + W >= o && x + W < c));
  };
}

// ───────────────────────── Puntaje

export type ScoreInput = {
  interests: InterestTag[];
  kind: PlaceKind;
  /** 0-1, ya normalizada (normalizeNotability). */
  notability: number;
  curated: boolean;
  must: boolean;
  /** Capas ya escuchadas por alguien del grupo. */
  toldLayers: number;
  inPreviousTour: boolean;
  /** Está en el itinerario (futuro: se lo contamos otro día; pasado: ya lo vieron). */
  inItinerary: 'past' | 'future' | null;
  /** El grupo evita museos y esto es un museo: solo fachada. */
  exteriorOnly: boolean;
  /** Está en saved_places de alguien. */
  saved: boolean;
};

/** Notoriedad 0-1 en una escala común: reseñas de Google, sitelinks de Wikidata y datos verificados propios. */
export function normalizeNotability(s: { rating_count?: number | null; sitelinks?: number | null; verified_facts?: number | null }): number {
  const r = Math.log10(1 + Math.max(0, s.rating_count ?? 0)) / 4.5; // 30k reseñas ≈ 1
  const w = Math.log10(1 + Math.max(0, s.sitelinks ?? 0)) / 2.2; // ~160 idiomas ≈ 1
  const f = Math.max(0, s.verified_facts ?? 0) / 8;
  return Math.min(1, Math.max(r, w, f, 0.05));
}

export function scoreForGroup(c: ScoreInput, g: GroupProfile): number {
  let affinity = affinityScore(c.interests, g.weights);
  if (g.themes.includes('curiosidades') && c.notability < 0.5) affinity = Math.max(affinity, 0.7);
  // Primera vez: pesa la notoriedad (lo esencial). Conocedores: lo menos conocido sube.
  const fame = g.firstTime ? 0.3 + 0.7 * c.notability : 0.55 + 0.45 * (1 - Math.abs(c.notability - 0.45));
  let s = affinity * fame;
  if (c.curated) s *= 1.3;
  if (c.saved) s *= 1.5;
  if (c.must) s *= 4;
  if (c.toldLayers > 0) s *= c.toldLayers >= 2 ? 0.1 : 0.35;
  if (c.inPreviousTour) s *= 0.15;
  if (c.inItinerary === 'future') s *= 0.4;
  if (c.inItinerary === 'past') s *= 0.5;
  if (c.exteriorOnly) s *= 0.5;
  if (g.indoor === 'indoor') s *= COVERED.includes(c.kind) ? 1.4 : OPEN_AIR.includes(c.kind) ? 0.5 : 1;
  if (g.indoor === 'outdoor') s *= OPEN_AIR.includes(c.kind) ? 1.2 : 1;
  if (g.hasKids) s *= KID_FRIENDLY.includes(c.kind) ? 1.25 : c.kind === 'museum' && !c.exteriorOnly ? 0.85 : 1;
  return s;
}

// ───────────────────────── Ruta

export type RouteCandidate = {
  key: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  score: number;
  dwell: number;
  openAt?: (minuteOfWeek: number) => boolean | null;
  must?: boolean;
};

export type RouteProblem = {
  start: { lat: number; lng: number };
  /** Final fijo (end_point o vuelta al inicio). null = termina en la última parada. */
  end: { lat: number; lng: number } | null;
  /** Candidato que tiene que ser la última parada (finish view/food). */
  lastKey?: string | null;
  budgetMin: number;
  walkKmh: number;
  maxWalkM: number | null;
  maxStops: number;
  startMinuteOfWeek: number;
  candidates: RouteCandidate[];
  /** Multiplicador por cada parada del mismo tipo ya elegida (diversidad). */
  diversityDecay?: number;
  /** Factor de desvío sobre la línea recta (calles reales). */
  detour?: number;
  /**
   * Distancia mínima entre paradas (m). Lo que está más cerca se cuenta DESDE la parada vecina ("también se ve
   * desde acá"): evita 4 paradas en la misma plaza y geofences encimados en el tour en vivo. Default 90.
   */
  minGapM?: number;
};

export type RoutePlan = {
  keys: string[];
  /** Minuto (desde el inicio) en que se llega a cada parada. */
  arrivals: number[];
  walkMin: number;
  walkM: number;
  dwellMin: number;
  totalMin: number;
  /** Paradas cerradas a la hora de llegada que quedan como exterior. */
  exteriorKeys: string[];
};

type Eval = { ok: boolean; total: number; walkM: number; walkMin: number; dwell: number; arrivals: number[]; exterior: string[] };

export function planRoute(p: RouteProblem): RoutePlan {
  const detour = p.detour ?? 1.3;
  const mPerMin = (p.walkKmh * 1000) / 60;
  const decay = p.diversityDecay ?? 0.55;
  const cands = p.candidates;
  const byKey = new Map(cands.map((c, i) => [c.key, i]));
  const lastIdx = p.lastKey != null ? (byKey.get(p.lastKey) ?? -1) : -1;
  const minGap = p.minGapM ?? 90;
  const tooClose = (i: number, route: number[]) => route.some((j) => distanceMeters(cands[i], cands[j]) < minGap);

  const pts = [p.start, ...cands.map((c) => ({ lat: c.lat, lng: c.lng }))];
  const legM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => distanceMeters(a, b) * detour;

  const evaluate = (route: number[], strictBudget = true): Eval => {
    let t = 0;
    let walkM = 0;
    let dwell = 0;
    const arrivals: number[] = [];
    const exterior: string[] = [];
    let prev = pts[0];
    for (const i of route) {
      const c = cands[i];
      const d = legM(prev, c);
      walkM += d;
      t += d / mPerMin;
      const open = c.openAt?.(p.startMinuteOfWeek + Math.round(t)) ?? null;
      if (open === false) {
        if (!EXTERIOR_OK[c.kind]) return { ok: false, total: Infinity, walkM, walkMin: 0, dwell, arrivals, exterior };
        exterior.push(c.key);
      }
      arrivals.push(Math.round(t));
      const stay = open === false ? Math.min(c.dwell, BASE_DWELL[c.kind]) : c.dwell;
      dwell += stay;
      t += stay;
      prev = c;
    }
    if (p.end) {
      const d = legM(prev, p.end);
      walkM += d;
      t += d / mPerMin;
    }
    const walkMin = walkM / mPerMin;
    const ok = (!strictBudget || t <= p.budgetMin) && (p.maxWalkM == null || walkM <= p.maxWalkM);
    return { ok, total: t, walkM, walkMin, dwell, arrivals, exterior };
  };

  // Inserta respetando que lastIdx quede al final.
  const positions = (route: number[]) => {
    const n = route.length;
    const lastFixed = lastIdx >= 0 && route[n - 1] === lastIdx;
    return Array.from({ length: (lastFixed ? n - 1 : n) + 1 }, (_, k) => k);
  };

  let route: number[] = [];
  if (lastIdx >= 0) route = [lastIdx];

  // 1) Obligatorias primero (aunque no entren en el presupuesto: las pidió la persona), mejor posición.
  for (const i of cands.map((_, i) => i).filter((i) => cands[i].must && i !== lastIdx).sort((a, b) => cands[b].score - cands[a].score)) {
    let best: number[] | null = null;
    let bestT = Infinity;
    for (const pos of positions(route)) {
      const r = [...route.slice(0, pos), i, ...route.slice(pos)];
      const e = evaluate(r, false);
      if (e.total < bestT) {
        bestT = e.total;
        best = r;
      }
    }
    if (best && route.length < p.maxStops) route = best;
  }

  // 2) Inserción golosa: mejor (puntaje con diversidad) / (minutos agregados).
  let current = evaluate(route, false);
  while (route.length < p.maxStops) {
    const kindCount = new Map<PlaceKind, number>();
    for (const i of route) kindCount.set(cands[i].kind, (kindCount.get(cands[i].kind) ?? 0) + 1);
    let best: { r: number[]; e: Eval; ratio: number } | null = null;
    for (let i = 0; i < cands.length; i++) {
      if (route.includes(i) || tooClose(i, route)) continue;
      const c = cands[i];
      const same = kindCount.get(c.kind) ?? 0;
      if (c.kind === 'food' && same > 0) continue; // una sola parada de comida
      const eff = c.score * decay ** same;
      if (eff <= 0) continue;
      for (const pos of positions(route)) {
        const r = [...route.slice(0, pos), i, ...route.slice(pos)];
        const e = evaluate(r);
        if (!e.ok) continue;
        const added = Math.max(1, e.total - current.total);
        const ratio = eff / added;
        if (!best || ratio > best.ratio) best = { r, e, ratio };
      }
    }
    if (!best) break;
    route = best.r;
    current = best.e;
  }

  // 3) 2-opt sobre el tramo interno (sin mover la última fija), mientras siga siendo factible.
  const fixedTail = lastIdx >= 0 && route[route.length - 1] === lastIdx ? 1 : 0;
  let improved = true;
  while (improved && route.length - fixedTail >= 3) {
    improved = false;
    const n = route.length - fixedTail;
    for (let i = 0; i < n - 1 && !improved; i++) {
      for (let k = i + 1; k < n; k++) {
        const r = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        const e = evaluate(r, false);
        if (e.total + 1e-6 < current.total && (e.ok || !current.ok)) {
          const strict = evaluate(r);
          if (strict.ok || !current.ok) {
            route = r;
            current = e;
            improved = true;
            break;
          }
        }
      }
    }
  }

  const fin = evaluate(route, false);
  return {
    keys: route.map((i) => cands[i].key),
    arrivals: fin.arrivals,
    walkMin: Math.round(fin.walkMin),
    walkM: Math.round(fin.walkM),
    dwellMin: Math.round(fin.dwell),
    totalMin: Math.round(fin.total),
    exteriorKeys: fin.exterior,
  };
}

/** Rumbo cardinal de a → b ("norte", "noreste", …) para las indicaciones de cómo seguir. */
export function cardinal(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  const y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x =
    Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lng - a.lng) * Math.PI) / 180);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'][Math.round(deg / 45) % 8];
}
