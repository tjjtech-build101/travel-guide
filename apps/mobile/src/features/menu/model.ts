// Lógica pura del menú colaborativo por tramo (PRD 31): secciones, reacciones, conteos y textos.
// Sin React ni red. Tests: model.test.ts (`pnpm --filter mobile test:menu`).
import {
  OPTION_SECTIONS,
  optionIncluded,
  type BestTime,
  type CatalogCategory,
  type CatalogTier,
  type LegOptionReactionRow,
  type LegOptionRow,
  type OptionReaction,
  type OptionSection,
  type PlanCoverage,
} from '@build101/shared';

// ───────────────────────── Textos

export const SECTION_COPY: Record<OptionSection, { title: string; subtitle: string }> = {
  must: { title: 'Imperdibles', subtitle: 'Lo que no te podés perder' },
  for_you: { title: 'Para ustedes', subtitle: 'Elegidos por los gustos del grupo' },
  gems: { title: 'Joyas locales', subtitle: 'Lo que conoce la gente de acá' },
  food: { title: 'Comida', subtitle: 'Dónde y qué comer' },
  day_trips: { title: 'Escapadas', subtitle: 'Para salir un día de la ciudad' },
  events: { title: 'En tus fechas', subtitle: 'Pasa justo mientras están' },
};

export const TIER_LABEL: Record<CatalogTier, string> = {
  must: 'Imperdible',
  recommended: 'Muy recomendado',
  gem: 'Joya local',
};

export const BEST_TIME_LABEL: Record<BestTime, string> = {
  morning: 'a la mañana',
  midday: 'al mediodía',
  afternoon: 'a la tarde',
  sunset: 'al atardecer',
  evening: 'a la noche',
  night: 'de noche',
  any: 'cuando sea',
};

export const REACTION_LABEL: Record<OptionReaction, string> = { love: 'Me copa', no: 'Paso', must: 'Sí o sí' };

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  landmark: 'Lugar emblemático',
  neighborhood: 'Barrio',
  museum: 'Museo',
  viewpoint: 'Mirador',
  park: 'Parque',
  beach: 'Playa',
  market: 'Mercado',
  food: 'Comida',
  nightlife: 'Noche',
  experience: 'Experiencia',
  shopping: 'Compras',
  day_trip: 'Escapada',
  event: 'Evento',
};

/** "1 h 30", "45 min", "Día entero" (≥ 6 h). */
export function durationText(min: number | null | undefined): string {
  if (!min || min <= 0) return '';
  if (min >= 360) return 'Día entero';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** "Recoleta · 1 h 30 · al atardecer" (salta lo que falta). */
export function metaLine(item: Pick<LegOptionRow['item'], 'zone' | 'duration_min' | 'best_time'>): string {
  const best = item.best_time && item.best_time !== 'any' ? `Mejor ${BEST_TIME_LABEL[item.best_time]}` : '';
  return [item.zone, durationText(item.duration_min), best].filter(Boolean).join(' · ');
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "Para vos" · "Para vos y Ana" · "Para Ana" · "Para Ana y Leo" · "Para Ana, Leo y Sofi". */
export function forWhomLabel(ids: string[], me: string, nameOf: (id: string) => string | null | undefined): string | null {
  if (!ids.length) return null;
  const others = ids.filter((id) => id !== me).map((id) => firstName(nameOf(id))).filter(Boolean);
  const parts = [...(ids.includes(me) ? ['vos'] : []), ...others];
  if (!parts.length) return null;
  if (parts.length === 1) return `Para ${parts[0]}`;
  return `Para ${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

// ───────────────────────── Reacciones

export type ReactionLite = Pick<LegOptionReactionRow, 'option_id' | 'user_id' | 'reaction'>;

export function reactionsByOption<R extends ReactionLite>(reactions: R[]): Map<string, R[]> {
  const m = new Map<string, R[]>();
  for (const r of reactions) m.set(r.option_id, [...(m.get(r.option_id) ?? []), r]);
  return m;
}

export function myReaction(reactions: ReactionLite[], optionId: string, me: string): OptionReaction | null {
  return reactions.find((r) => r.option_id === optionId && r.user_id === me)?.reaction ?? null;
}

/** Tocar el botón de la reacción que ya tengo la saca (null); otro botón la reemplaza. */
export function nextReaction(current: OptionReaction | null, tapped: OptionReaction): OptionReaction | null {
  return current === tapped ? null : tapped;
}

/** Aplica (optimista) mi reacción a la lista: reemplaza la mía de esa opción o la saca con null. */
export function applyReaction<R extends ReactionLite>(
  reactions: R[],
  optionId: string,
  me: string,
  reaction: OptionReaction | null,
  extra: Omit<R, keyof ReactionLite>,
): R[] {
  const rest = reactions.filter((r) => !(r.option_id === optionId && r.user_id === me));
  if (!reaction) return rest;
  return [...rest, { ...extra, option_id: optionId, user_id: me, reaction } as R];
}

// ───────────────────────── Secciones y conteos

export type MenuSection = { section: OptionSection; title: string; subtitle: string; options: LegOptionRow[] };

/** Secciones en el orden del producto (Imperdibles → En tus fechas), sin las vacías; dentro, por sort_order. */
export function buildMenuSections(options: LegOptionRow[], legId: string): MenuSection[] {
  const byLeg = options.filter((o) => o.leg_id === legId);
  const out: MenuSection[] = [];
  for (const section of OPTION_SECTIONS) {
    const list = byLeg
      .filter((o) => o.section === section)
      .sort((a, b) => a.sort_order - b.sort_order || b.score - a.score || a.id.localeCompare(b.id));
    if (list.length) out.push({ section, ...SECTION_COPY[section], options: list });
  }
  return out;
}

export type MenuCounts = { total: number; included: number; mustTotal: number; mustIncluded: number };

export function menuCounts(options: LegOptionRow[], reactions: ReactionLite[], legIds?: string[] | null): MenuCounts {
  const by = reactionsByOption(reactions);
  const list = legIds ? options.filter((o) => legIds.includes(o.leg_id)) : options;
  let included = 0;
  let mustTotal = 0;
  let mustIncluded = 0;
  for (const o of list) {
    const inc = optionIncluded(o, by.get(o.id) ?? []);
    const isMust = o.section === 'must' || o.item.tier === 'must';
    if (inc) included++;
    if (isMust) {
      mustTotal++;
      if (inc) mustIncluded++;
    }
  }
  return { total: list.length, included, mustTotal, mustIncluded };
}

// ───────────────────────── Tramos

type LegLite = { id: string; city: string; start_date: string; end_date: string; sort_order: number };
type BlockLite = { leg_id: string; day_id: string | null; type: string };

export type MenuLegState = { legId: string; city: string; options: number; planned: boolean };

/**
 * Por tramo: cuántas opciones tiene el menú y si ya está armado (algún bloque agendado que no sea traslado).
 * Solo devuelve tramos con menú (para el banner y el "Ver menú" del plan).
 */
export function menuLegStates(legs: LegLite[], options: Pick<LegOptionRow, 'leg_id'>[], blocks: BlockLite[]): MenuLegState[] {
  const count = new Map<string, number>();
  for (const o of options) count.set(o.leg_id, (count.get(o.leg_id) ?? 0) + 1);
  const planned = new Set(blocks.filter((b) => b.day_id && b.type !== 'transfer').map((b) => b.leg_id));
  return sortLegsLite(legs)
    .filter((l) => (count.get(l.id) ?? 0) > 0)
    .map((l) => ({ legId: l.id, city: l.city, options: count.get(l.id) ?? 0, planned: planned.has(l.id) }));
}

export function sortLegsLite<L extends LegLite>(legs: L[]): L[] {
  return [...legs].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order);
}

/** Tramo inicial del menú: el pedido si tiene menú, si no el primero sin armar, si no el primero con menú. */
export function initialMenuLeg(states: MenuLegState[], requested?: string | null): string | null {
  if (requested && states.some((s) => s.legId === requested)) return requested;
  return states.find((s) => !s.planned)?.legId ?? states[0]?.legId ?? null;
}

// ───────────────────────── Cobertura

export type CoverageTotals = { mustTotal: number; mustCovered: number; missing: number; choices: number };

export function coverageTotals(coverage: PlanCoverage[] | null | undefined): CoverageTotals {
  const list = coverage ?? [];
  return {
    mustTotal: list.reduce((n, c) => n + c.must_total, 0),
    mustCovered: list.reduce((n, c) => n + c.must_covered, 0),
    missing: list.reduce((n, c) => n + c.missing.length, 0),
    choices: list.reduce((n, c) => n + c.choices, 0),
  };
}

// ───────────────────────── Ideas y fechas

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "17–19 oct" · "30 oct – 2 nov" (sin año, para los chips de tramo). */
export function shortRange(start: string, end: string): string {
  const p = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? { m: Number(m[2]) - 1, d: Number(m[3]) } : null;
  };
  const a = p(start);
  const b = p(end);
  if (!a || !b) return '';
  if (a.m === b.m) return a.d === b.d ? `${a.d} ${MONTHS[a.m]}` : `${a.d}–${b.d} ${MONTHS[a.m]}`;
  return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]}`;
}

type IdeaInput = {
  trip_id: string;
  leg_id: string;
  type: 'meal' | 'activity';
  title: string;
  description?: string;
  place_name?: string;
  google_place_id?: string;
  lat?: number;
  lng?: number;
  duration_min?: number;
  reason?: string;
};

/** Input de add_idea para un imperdible que quedó afuera (con lo que se sepa del ítem; si no, solo el nombre). */
export function ideaFromItem(
  tripId: string,
  legId: string,
  name: string,
  item: Pick<LegOptionRow['item'], 'name' | 'category' | 'why' | 'google_place_id' | 'lat' | 'lng' | 'duration_min'> | null,
): IdeaInput {
  const out: IdeaInput = {
    trip_id: tripId,
    leg_id: legId,
    type: item?.category === 'food' ? 'meal' : 'activity',
    title: (item?.name || name).slice(0, 200),
    reason: 'Imperdible que no entró en los días',
  };
  if (!item) return out;
  if (item.why) out.description = item.why.slice(0, 4000);
  if (item.google_place_id) out.google_place_id = item.google_place_id;
  out.place_name = item.name.slice(0, 200);
  if (item.lat !== null && item.lng !== null) {
    out.lat = item.lat;
    out.lng = item.lng;
  }
  if (item.duration_min > 0 && item.duration_min <= 24 * 60) out.duration_min = Math.round(item.duration_min);
  return out;
}
