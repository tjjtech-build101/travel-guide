// Catálogo del destino (PRD 31): la pieza que garantiza que no se pierda nada importante de una ciudad.
// - getCatalog: investiga (generate) → crítico independiente busca lo que falta (review) → merge/dedupe → resuelve
//   cada ítem en Places (nunca inventado) → descarta lo que no existe o cae lejos → horarios y popularidad de lo
//   importante → valida el tier ("imperdible" exige ≥2 fuentes o mucha notoriedad) → cachea en destination_catalog
//   (global por ciudad, 30 días). Una sola corrida por ciudad a la vez (mapa de promesas en memoria).
// - legEvents: eventos con fecha del tramo (reusa el investigador de eventos de PRD 16).
// - scoreItem / scoreItemFor: afinidad × notoriedad × ajustes, igual idea que scoreForGroup de tourRoute.ts.
// - buildLegOptions: el menú del tramo por secciones, con preselección hasta ~85% de la capacidad de los días.
// Todo lo que va a la red entra por deps (CatalogDeps); lo demás es puro y se testea sin red.
import {
  affinityScore,
  BEST_TIMES,
  BOOKING_NEEDS,
  CATALOG_CATEGORIES,
  CATALOG_TIERS,
  COST_HINTS,
  distanceMeters,
  INTEREST_TAGS,
  interestsForName,
  OPTION_SECTIONS,
  type CatalogCategory,
  type CatalogItem,
  type InterestTag,
  type OpeningPeriodLite,
  type OptionSection,
} from '@build101/shared';
import { placeHoursAndPopularity, searchPlaces as googleSearchPlaces, type PlaceSummary } from '../../google/places';
import { EVENTS_SYSTEM, renderEventsUser } from '../eventsPrompts';
import { EventsSearchOutput, type EventItemT } from '../eventsSchemas';
import { sanitizeEvents } from '../eventsSearch';
import { emptyUsage, type Usage } from '../schemas';
import { captureViaTool } from '../tourLlm';
import { normalizeNotability } from '../tourRoute';
import type { Db } from '../../supabase';
import { research } from './catalogLlm';
import { diversityCaps, diversityKind, type DiversityKind } from './check';
import type {
  CatalogDeps,
  CatalogResult,
  CityRef,
  LegOptionDraft,
  PlannerGroup,
  PlannerMember,
  RawCatalogItem,
} from './types';

export const CATALOG_MAX_AGE_DAYS = 30;
/** Menos que esto en caché = corrida que salió mal: se regenera. */
export const CATALOG_MIN_ITEMS = 15;
const RESOLVE_CONCURRENCY = 6;
const HOURS_MAX = 25;
const CITY_RADIUS_M = 30_000;
const DAY_TRIP_RADIUS_M = 150_000;
/** Más lejos que esto del centro = Places encontró otro lugar con el mismo nombre. */
const MAX_CITY_KM = 50;
const MAX_DAY_TRIP_KM = 250;

// ───────────────────────── Normalización

const deaccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s: string) => deaccent(s.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();

/** "Buenos Aires", "Argentina" → "buenos aires|argentina". */
export function cityKey(city: string, country: string | null | undefined): string {
  return `${norm(city)}|${norm(country ?? '')}`;
}

const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'e', 'en', 'the', 'of', 'and', 'a', 'al', 'le', 'il', 'da', 'do', 'des', 'du']);
const tokens = (s: string) => norm(s).split(' ').filter((t) => t && !STOPWORDS.has(t));

/** Clave de deduplicación por nombre: tokens significativos ordenados ("Cementerio de la Recoleta" = "Cementerio Recoleta"). */
export function nameKey(name: string): string {
  return [...new Set(tokens(name))].sort().join(' ');
}

/** ¿El texto libre (un "sí o sí", un guardado) nombra a este ítem? Igualdad de tokens o contención de ≥2 tokens. */
function namesMatch(text: string, itemName: string): boolean {
  const a = new Set(tokens(text));
  const b = new Set(tokens(itemName));
  if (!a.size || !b.size) return false;
  if (nameKey(text) === nameKey(itemName)) return true;
  const contains = (big: Set<string>, small: Set<string>) => small.size >= 2 && [...small].every((t) => big.has(t));
  return contains(a, b) || contains(b, a);
}

export function slugify(s: string): string {
  return norm(s).replace(/ /g, '-').slice(0, 60).replace(/-+$/, '') || 'lugar';
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/** Fuentes independientes = dominios distintos. */
export function independentSources(sources: { url: string }[]): number {
  return new Set(sources.map((s) => host(s.url)).filter(Boolean)).size;
}

// ───────────────────────── Limpieza del investigador (el modelo puede devolver cualquier cosa)

const TIER_RANK = { must: 2, recommended: 1, gem: 0 } as const;
const oneOf = <T extends string>(v: unknown, values: readonly T[], d: T): T => (values.includes(v as T) ? (v as T) : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function cleanRaw(r: RawCatalogItem, city: string): RawCatalogItem | null {
  const name = (r.name ?? '').trim();
  if (!name) return null;
  const category = oneOf(r.category, CATALOG_CATEGORIES, 'landmark');
  if (category === 'event') return null; // los eventos con fecha vienen de legEvents
  const dur = Number(r.duration_min);
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
    .map((s) => ({ url: s.url.trim(), title: s.title ?? null }));
  const interests = (Array.isArray(r.interests) ? r.interests : []).filter((i): i is InterestTag =>
    (INTEREST_TAGS as readonly string[]).includes(i),
  );
  return {
    name,
    query: (r.query ?? '').trim() || `${name}, ${city}`,
    category,
    tier: oneOf(r.tier, CATALOG_TIERS, 'recommended'),
    zone: r.zone?.trim() || null,
    duration_min: category === 'day_trip' ? clamp(Number.isFinite(dur) ? dur : 480, 240, 720) : clamp(Number.isFinite(dur) ? dur : 60, 15, 300),
    best_time: oneOf(r.best_time, BEST_TIMES, 'any'),
    indoor: !!r.indoor,
    booking: oneOf(r.booking, BOOKING_NEEDS, 'none'),
    cost_hint: r.cost_hint == null ? null : oneOf(r.cost_hint, COST_HINTS, 'mid'),
    interests: interests.length ? [...new Set(interests)] : interestsForName(name),
    why: (r.why ?? '').trim(),
    tip: r.tip?.trim() || null,
    closed_days: [...new Set((Array.isArray(r.closed_days) ? r.closed_days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    sources,
  };
}

/** Une dos menciones del mismo lugar: el tier más alto, todas las fuentes, lo que falte de una lo completa la otra. */
function mergeRaw(a: RawCatalogItem, b: RawCatalogItem): RawCatalogItem {
  const seen = new Set<string>();
  const sources = [...a.sources, ...b.sources].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  return {
    ...a,
    tier: TIER_RANK[b.tier] > TIER_RANK[a.tier] ? b.tier : a.tier,
    zone: a.zone ?? b.zone,
    tip: a.tip ?? b.tip,
    why: a.why || b.why,
    cost_hint: a.cost_hint ?? b.cost_hint,
    interests: [...new Set([...a.interests, ...b.interests])] as string[],
    closed_days: a.closed_days.length ? a.closed_days : b.closed_days,
    sources,
  };
}

/** Merge + dedupe por nombre de lo que trajeron generate y review (exportado para tests). */
export function mergeRawItems(lists: RawCatalogItem[][], city: string): RawCatalogItem[] {
  const byKey = new Map<string, RawCatalogItem>();
  for (const list of lists) {
    for (const raw of list) {
      const r = cleanRaw(raw, city);
      if (!r) continue;
      const k = nameKey(r.name);
      const prev = byKey.get(k);
      byKey.set(k, prev ? mergeRaw(prev, r) : r);
    }
  }
  return [...byKey.values()];
}

/** Días en que no abre nunca, según regularOpeningHours.periods. [] si no hay datos o abre siempre. */
export function closedDaysFromPeriods(periods: OpeningPeriodLite[] | null | undefined): number[] {
  if (!periods?.length) return [];
  if (periods.some((p) => !p.close)) return []; // 24 h
  const open = new Set(periods.map((p) => p.open.day));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d));
}

/** Notoriedad 0-1: reseñas de Google + cantidad de fuentes independientes (2 fuentes ≈ 0,5; 4 ≈ 1). */
export function itemNotability(ratingCount: number | null, sources: { url: string }[]): number {
  return Math.round(normalizeNotability({ rating_count: ratingCount, verified_facts: independentSources(sources) * 2 }) * 1000) / 1000;
}

/** "must" exige ≥2 fuentes independientes o notoriedad ≥ 0,6; si no, baja a recommended. */
export function validateTier(tier: CatalogItem['tier'], sources: { url: string }[], notability: number): CatalogItem['tier'] {
  if (tier !== 'must') return tier;
  return independentSources(sources) >= 2 || notability >= 0.6 ? 'must' : 'recommended';
}

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

const sumUsage = (...us: Usage[]): Usage =>
  us.reduce(
    (a, u) => ({
      input_tokens: a.input_tokens + u.input_tokens,
      output_tokens: a.output_tokens + u.output_tokens,
      cache_read_input_tokens: a.cache_read_input_tokens + u.cache_read_input_tokens,
      cache_creation_input_tokens: a.cache_creation_input_tokens + u.cache_creation_input_tokens,
      web_search_requests: a.web_search_requests + u.web_search_requests,
    }),
    emptyUsage(),
  );

function abortIf(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Se canceló el armado del catálogo.');
}

// ───────────────────────── getCatalog

export type CatalogOpts = { signal?: AbortSignal; onProgress?: (text: string) => void; maxAgeDays?: number };

type CatalogRowLite = { items: CatalogItem[] | null; lodging_zones: CatalogResult['lodging_zones'] | null; updated_at: string | null };

const inflight = new Map<string, Promise<CatalogResult>>();

/** Catálogo de una ciudad: de la caché si es fresco (≤30 días y ≥15 ítems); si no, lo investiga y lo guarda. */
export async function getCatalog(admin: Db, city: CityRef, deps: CatalogDeps, opts: CatalogOpts = {}): Promise<CatalogResult> {
  const key = cityKey(city.city, city.country);
  const { data: row } = await admin.from('destination_catalog').select('items,lodging_zones,updated_at').eq('city_key', key).maybeSingle();
  const cached = row as CatalogRowLite | null;
  const maxAgeMs = (opts.maxAgeDays ?? CATALOG_MAX_AGE_DAYS) * 86_400_000;
  const fresh =
    !!cached?.updated_at && deps.now().getTime() - Date.parse(cached.updated_at) < maxAgeMs && (cached.items?.length ?? 0) >= CATALOG_MIN_ITEMS;
  if (fresh) return { items: cached!.items ?? [], lodging_zones: cached!.lodging_zones ?? [], cached: true, usage: emptyUsage() };

  // Dos tramos en la misma ciudad (o dos viajes a la vez): una sola investigación.
  const running = inflight.get(key);
  if (running) return running;
  const p = buildCatalog(admin, key, city, deps, opts)
    .catch((err) => {
      // Si la investigación falla pero tenemos un catálogo viejo con contenido, mejor eso que nada.
      if ((cached?.items?.length ?? 0) > 0) return { items: cached!.items ?? [], lodging_zones: cached!.lodging_zones ?? [], cached: true, usage: emptyUsage() };
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function buildCatalog(admin: Db, key: string, city: CityRef, deps: CatalogDeps, opts: CatalogOpts): Promise<CatalogResult> {
  const say = (t: string) => opts.onProgress?.(t);
  const { signal } = opts;

  say(`Investigando qué no te podés perder en ${city.city}…`);
  const gen = await deps.research({ city, mode: 'generate', known: [], signal });
  abortIf(signal);
  const firstPass = mergeRawItems([gen.items], city.city);

  say(`Buscando lo que se le escapa a las guías de ${city.city}…`);
  let review: Awaited<ReturnType<CatalogDeps['research']>> = { items: [], lodging_zones: [], usage: emptyUsage() };
  try {
    review = await deps.research({ city, mode: 'review', known: firstPass.map((i) => i.name), signal });
  } catch (err) {
    console.warn('[catalog] la revisión falló, sigo con la primera pasada:', (err as Error).message);
  }
  abortIf(signal);
  const raws = mergeRawItems([firstPass, review.items], city.city);

  // Centro: el que vino o geocodificamos la ciudad.
  let center = city.lat != null && city.lng != null ? { lat: city.lat, lng: city.lng } : null;
  if (!center) {
    const [c] = await deps.searchPlaces({ query: [city.city, city.country].filter(Boolean).join(', '), max_results: 1 }).catch(() => [] as PlaceSummary[]);
    if (c?.lat != null && c.lng != null) center = { lat: c.lat, lng: c.lng };
  }

  say(`Ubicando ${raws.length} lugares en el mapa…`);
  const resolved = await mapLimit(raws, RESOLVE_CONCURRENCY, async (r) => {
    if (signal?.aborted) return null;
    const dayTrip = r.category === 'day_trip';
    const [place] = await deps
      .searchPlaces({ query: r.query, near: center ?? undefined, radius_m: dayTrip ? DAY_TRIP_RADIUS_M : CITY_RADIUS_M, max_results: 1 })
      .catch(() => [] as PlaceSummary[]);
    const hasPoint = place?.google_place_id && place.lat != null && place.lng != null;
    if (!hasPoint) return dayTrip ? { raw: r, place: null } : null; // no existe en Places: afuera (una escapada puede quedar sin punto)
    if (center) {
      const km = distanceMeters(center, { lat: place.lat!, lng: place.lng! }) / 1000;
      if (km > (dayTrip ? MAX_DAY_TRIP_KM : MAX_CITY_KM)) return dayTrip ? { raw: r, place: null } : null;
    }
    return { raw: r, place };
  });
  abortIf(signal);

  // Dedupe por google_place_id (dos nombres para el mismo lugar).
  const byPlace = new Map<string, { raw: RawCatalogItem; place: PlaceSummary | null }>();
  const noPlace: { raw: RawCatalogItem; place: null }[] = [];
  for (const r of resolved) {
    if (!r) continue;
    if (!r.place) {
      noPlace.push(r as { raw: RawCatalogItem; place: null });
      continue;
    }
    const prev = byPlace.get(r.place.google_place_id);
    byPlace.set(r.place.google_place_id, prev ? { raw: mergeRaw(prev.raw, r.raw), place: prev.place } : r);
  }
  const entries = [...byPlace.values(), ...noPlace];

  // Horarios + popularidad de lo que más importa (imperdibles primero, después museos/mercados/experiencias).
  const HOURS_CATS: CatalogCategory[] = ['museum', 'market', 'experience', 'landmark'];
  const wantHours = entries
    .filter((e) => e.place && (e.raw.tier === 'must' || HOURS_CATS.includes(e.raw.category)))
    .sort((a, b) => TIER_RANK[b.raw.tier] - TIER_RANK[a.raw.tier] || HOURS_CATS.indexOf(a.raw.category) - HOURS_CATS.indexOf(b.raw.category))
    .slice(0, HOURS_MAX);
  if (wantHours.length) say(`Chequeando horarios de ${wantHours.length} lugares…`);
  const hours = new Map<string, Awaited<ReturnType<CatalogDeps['placeHours']>>>();
  await mapLimit(wantHours, RESOLVE_CONCURRENCY, async (e) => {
    if (signal?.aborted) return;
    const id = e.place!.google_place_id;
    hours.set(id, await deps.placeHours(id).catch(() => null));
  });
  abortIf(signal);

  const usedIds = new Set<string>();
  const uniqueId = (name: string) => {
    const base = slugify(name);
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  const items: CatalogItem[] = entries.map(({ raw, place }) => {
    const h = place ? hours.get(place.google_place_id) : null;
    const periods = h?.periods?.length ? h.periods : null;
    const fromPeriods = closedDaysFromPeriods(periods);
    const notability = itemNotability(h?.rating_count ?? null, raw.sources);
    return {
      id: uniqueId(raw.name),
      name: raw.name,
      category: raw.category,
      tier: validateTier(raw.tier, raw.sources, notability),
      zone: raw.zone,
      google_place_id: place?.google_place_id ?? null,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      duration_min: raw.duration_min,
      best_time: raw.best_time,
      indoor: raw.indoor,
      booking: raw.booking,
      cost_hint: raw.cost_hint,
      interests: raw.interests as InterestTag[],
      why: raw.why,
      tip: raw.tip,
      closed_days: periods ? fromPeriods : raw.closed_days,
      periods,
      event_dates: null,
      event_time: null,
      sources: raw.sources,
      notability,
      rating: place?.rating ?? null,
      rating_count: h?.rating_count ?? null,
    };
  });
  items.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.notability - a.notability);

  // Zonas para alojarse: con su punto (para que el armado sepa dónde "duerme" el grupo si no reservó).
  const lodging_zones = await mapLimit(gen.lodging_zones.slice(0, 4), RESOLVE_CONCURRENCY, async (z) => {
    const [p] = await deps
      .searchPlaces({ query: `${z.zone}, ${city.city}`, near: center ?? undefined, radius_m: CITY_RADIUS_M, max_results: 1 })
      .catch(() => [] as PlaceSummary[]);
    return { zone: z.zone, why: z.why, lat: p?.lat ?? null, lng: p?.lng ?? null };
  });

  const { error } = await admin.from('destination_catalog').upsert(
    {
      city_key: key,
      city: city.city,
      country: city.country,
      lat: center?.lat ?? null,
      lng: center?.lng ?? null,
      items,
      lodging_zones,
      model: 'claude-opus-5-5',
      updated_at: deps.now().toISOString(),
    },
    { onConflict: 'city_key' },
  );
  if (error) console.warn('[catalog] no pude guardar el catálogo:', error.message);

  const musts = items.filter((i) => i.tier === 'must').length;
  say(`Encontré ${items.length} lugares, ${musts} imperdibles`);
  return { items, lodging_zones, cached: false, usage: sumUsage(gen.usage, review.usage) };
}

// ───────────────────────── Eventos del tramo

export type EventsDeps = {
  /** Investigador de eventos (PRD 16). Por defecto: Claude + web_search con los prompts de events_search. */
  searchEvents?: (args: { city: string; country: string | null; date_from: string; date_to: string; signal?: AbortSignal }) => Promise<EventItemT[]>;
};

export const searchEventsLive: NonNullable<EventsDeps['searchEvents']> = async ({ city, country, date_from, date_to, signal }) => {
  const r = await captureViaTool<{ events: EventItemT[] }>({
    system: EVENTS_SYSTEM,
    user: renderEventsUser({ city, country: country ?? undefined, date_from, date_to, lang: 'es' }),
    captureName: 'report_events',
    captureDescription: 'Reportá los eventos confirmados que encontraste (puede ser una lista vacía).',
    captureSchema: EventsSearchOutput,
    serverTools: ['web_search'],
    config: { effort: 'medium', maxTokens: 4000, maxIterations: 6, fallbacks: true },
    signal,
  });
  return r.value?.events ?? [];
};

function bestTimeFor(hhmm: string | null): CatalogItem['best_time'] {
  const h = hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? Number(hhmm.split(':')[0]) : null;
  if (h == null) return 'any';
  if (h < 12) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** Eventos con fecha dentro del tramo como ítems de catálogo (category 'event'). Si algo falla: [] (nunca rompe el plan). */
export async function legEvents(
  city: CityRef,
  dates: string[],
  deps: Pick<CatalogDeps, 'searchPlaces'> & EventsDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<CatalogItem[]> {
  const sorted = [...dates].sort();
  if (!sorted.length) return [];
  const [from, to] = [sorted[0], sorted[sorted.length - 1]];
  try {
    const raw = await (deps.searchEvents ?? searchEventsLive)({ city: city.city, country: city.country, date_from: from, date_to: to, signal: opts.signal });
    const inLeg = new Set(sorted);
    const events = sanitizeEvents(raw, from, to).filter((e) => inLeg.has(e.date));
    // El mismo evento en varias fechas = un ítem con varias event_dates.
    const byTitle = new Map<string, { e: EventItemT; dates: string[] }>();
    for (const e of events) {
      const k = nameKey(`${e.title} ${e.venue}`);
      const prev = byTitle.get(k);
      if (prev) prev.dates.push(e.date);
      else byTitle.set(k, { e, dates: [e.date] });
    }
    const center = city.lat != null && city.lng != null ? { lat: city.lat, lng: city.lng } : undefined;
    const used = new Set<string>();
    return await mapLimit([...byTitle.values()], RESOLVE_CONCURRENCY, async ({ e, dates: ds }) => {
      const [place] = await deps
        .searchPlaces({ query: `${e.venue}, ${city.city}`, near: center, radius_m: CITY_RADIUS_M, max_results: 1 })
        .catch(() => [] as PlaceSummary[]);
      let id = `evento-${slugify(e.title)}`;
      for (let n = 2; used.has(id); n++) id = `evento-${slugify(e.title)}-${n}`;
      used.add(id);
      const sources = [{ url: e.source_url, title: null }, ...(e.url && e.url !== e.source_url ? [{ url: e.url, title: e.title }] : [])];
      const free = /gratis|gratuit|free|sin cargo/i.test(e.price_text ?? '');
      return {
        id,
        name: e.title,
        category: 'event' as const,
        tier: 'recommended' as const,
        zone: null,
        google_place_id: place?.google_place_id || null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        duration_min: 120,
        best_time: bestTimeFor(e.start_time),
        indoor: false,
        booking: free ? ('none' as const) : ('recommended' as const),
        cost_hint: free ? ('free' as const) : null,
        interests: interestsForName(`${e.title} ${e.venue}`),
        why: `${e.title} en ${e.venue}.`,
        tip: e.price_text ? `Entrada: ${e.price_text}.` : null,
        closed_days: [],
        periods: null,
        event_dates: [...new Set(ds)].sort(),
        event_time: e.start_time && /^\d{1,2}:\d{2}$/.test(e.start_time) ? e.start_time.padStart(5, '0') : null,
        sources,
        notability: itemNotability(null, sources),
        rating: place?.rating ?? null,
        rating_count: null,
      };
    });
  } catch (err) {
    console.warn('[catalog] eventos del tramo fallaron:', (err as Error).message);
    return [];
  }
}

// ───────────────────────── Puntaje

/** Texto libre de "evitar" → categorías/intereses que tapa. */
const AVOID_MAP: [RegExp, { categories: CatalogCategory[]; interests: InterestTag[] }][] = [
  [/museo/, { categories: ['museum'], interests: ['museos'] }],
  [/noche|boliche|disco|alcohol|fiesta|bares?\b/, { categories: ['nightlife'], interests: ['vida_nocturna'] }],
  [/playa/, { categories: ['beach'], interests: ['playa'] }],
  [/compra|shopping|tienda/, { categories: ['shopping'], interests: ['compras'] }],
  [/iglesia|religio|templo/, { categories: [], interests: ['religion'] }],
  [/futbol|deporte|estadio/, { categories: [], interests: ['deporte'] }],
  [/excursion|escapada/, { categories: ['day_trip'], interests: [] }],
  [/mercado|feria/, { categories: ['market'], interests: ['mercados'] }],
  [/parque|naturaleza/, { categories: ['park'], interests: ['naturaleza'] }],
  [/arte|galeria/, { categories: [], interests: ['arte'] }],
  [/historia/, { categories: [], interests: ['historia'] }],
];

/** 'block' = sacarlo (0) · 'soft' = toca algo que evitan pero tiene otros atractivos (×0,5). */
export function avoidHit(item: Pick<CatalogItem, 'name' | 'category' | 'interests'>, avoid: string[]): 'block' | 'soft' | null {
  const name = norm(item.name);
  let soft = false;
  for (const a of avoid) {
    const t = norm(a);
    if (!t) continue;
    if (t.length >= 4 && (` ${name} `.includes(` ${t} `) || namesMatch(a, item.name))) return 'block';
    // "Museo Evita" (nombre propio: alguna palabra después de la primera en mayúscula) tapa ese lugar, no todos los museos.
    if (a.trim().split(/\s+/).slice(1).some((w) => /^\p{Lu}/u.test(w))) continue;
    const cats = new Set<CatalogCategory>();
    const ints = new Set<InterestTag>();
    for (const [re, m] of AVOID_MAP) if (re.test(t)) (m.categories.forEach((c) => cats.add(c)), m.interests.forEach((i) => ints.add(i)));
    for (const tag of INTEREST_TAGS) if (t === tag.replace('_', ' ')) ints.add(tag);
    if (cats.has(item.category)) return 'block';
    const hits = item.interests.filter((i) => ints.has(i));
    if (hits.length && hits.length === item.interests.length) return 'block';
    if (hits.length) soft = true;
  }
  return soft ? 'soft' : null;
}

type AdjustCtx = {
  avoid: string[];
  must: string[];
  dietary: string[];
  budget: PlannerGroup['budget'];
  stepFree: boolean;
  hasKids: boolean;
};

const MEAT_RE = /parrilla|asado|carne|bife|chorip|steak|asador|cordero/;
const GLUTEN_RE = /pizza|pasta|panader|factura|empanada|medialuna|pastel/;
const STAIRS_RE = /escaler|escalon|subida|cuesta|cerro|trekking|sendero|stairs/;

/** Multiplicador de contexto (0 = no va). */
function adjust(item: CatalogItem, c: AdjustCtx): number {
  const hit = avoidHit(item, c.avoid);
  if (hit === 'block') return 0;
  let m = hit === 'soft' ? 0.5 : 1;
  const text = norm(`${item.name} ${item.why} ${item.tip ?? ''}`);
  if (item.category === 'food' || item.category === 'market') {
    const diet = norm(c.dietary.join(' '));
    if (/vegan|veget/.test(diet) && MEAT_RE.test(text) && !/vegan|veget/.test(text)) m *= 0.4;
    if (/celiac|tacc|gluten/.test(diet) && GLUTEN_RE.test(text) && !/sin tacc|gluten free|sin gluten/.test(text)) m *= 0.6;
  }
  if (c.hasKids) {
    if (item.category === 'nightlife') m *= 0.15;
    else if (item.category === 'museum') m *= 0.85;
    else if (item.category === 'park' || item.category === 'beach' || item.category === 'experience') m *= 1.2;
  }
  if (c.stepFree && STAIRS_RE.test(text)) m *= 0.5;
  if (item.cost_hint === 'high') m *= c.budget === 'low' ? 0.5 : c.budget === 'mid' ? 0.85 : 1;
  if (item.cost_hint === 'mid' && c.budget === 'low') m *= 0.85;
  return m;
}

const isGroupMust = (item: CatalogItem, must: string[]) => must.some((m) => namesMatch(m, item.name) || nameKey(m) === nameKey(item.name));
const round3 = (x: number) => Math.round(clamp(x, 0, 1) * 1000) / 1000;

/**
 * Pesos que cuentan para la afinidad: un interés flojo (< 3) solo suma si salió de la conversación / la entrevista
 * (group.spoken). Así un {religion: 2} del perfil no tira 7 iglesias arriba de todo lo demás.
 */
export function effectiveWeights(group: Pick<PlannerGroup, 'weights' | 'spoken'>): Record<string, number> {
  const spoken = new Set(group.spoken ?? []);
  return Object.fromEntries(Object.entries(group.weights).filter(([k, w]) => w >= 3 || spoken.has(k)));
}

/** Afinidad 0-1 de un ítem con el grupo: gustos × notoriedad (primera vez: pesa lo canónico) × ajustes. */
export function scoreItem(item: CatalogItem, group: PlannerGroup): number {
  const m = adjust(item, group);
  if (m === 0) return 0;
  const affinity = affinityScore(item.interests, effectiveWeights(group));
  const n = item.notability;
  // Igual que scoreForGroup: primera vez → lo esencial; conocedores → lo menos obvio sube.
  const fame = group.firstTime ? 0.3 + 0.7 * n : 0.55 + 0.45 * (1 - Math.abs(n - 0.45));
  let s = affinity * fame * m;
  if (item.tier === 'must') s *= group.firstTime ? 1.25 : 0.95;
  if (item.tier === 'gem') s *= group.firstTime ? 1 : 1.25;
  if (isGroupMust(item, group.must)) s = Math.max(s, 0.95);
  return round3(s);
}

/** Lo mismo para una sola persona (para "Para vos, Sofi"): pesa más la afinidad que la fama. */
export function scoreItemFor(item: CatalogItem, member: PlannerMember): number {
  const m = adjust(item, {
    avoid: member.avoid,
    must: member.must,
    dietary: member.dietary,
    budget: member.budget,
    stepFree: member.step_free,
    hasKids: false,
  });
  if (m === 0) return 0;
  let s = affinityScore(item.interests, member.interests) * (0.6 + 0.4 * item.notability) * m;
  if (isGroupMust(item, member.must)) s = Math.max(s, 0.95);
  return round3(s);
}

// ───────────────────────── Menú del tramo

/** Minutos de actividades por día según el ritmo (sin comidas ni traslados largos). */
export const PACE_ACTIVITY_MIN = { relaxed: 330, balanced: 450, intense: 570 } as const;
const PRESELECT_SHARE = 0.85;
const FOR_USER_MIN = 0.6;
const SECTION_CAP: Record<OptionSection, number> = { must: 25, for_you: 14, gems: 8, food: 8, day_trips: 4, events: 6 };
export const MAX_OPTIONS = 45;

/** Capacidad (min) del tramo: el primer y el último día valen la mitad (llegada/salida). */
export function legCapacityMin(days: number, pace: PlannerGroup['pace']): number {
  if (days <= 0) return 0;
  const per = PACE_ACTIVITY_MIN[pace];
  if (days === 1) return per * 0.5;
  return per * (days - 1); // (n-2) días completos + 2 medios
}

const firstName = (m: PlannerMember) => m.name;
const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

function forUsers(item: CatalogItem, group: PlannerGroup): { ids: string[]; reason: string | null } {
  const scored = group.members
    .map((m) => ({ m, s: scoreItemFor(item, m) }))
    .filter((x) => x.s >= FOR_USER_MIN)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  if (!scored.length) return { ids: [], reason: null };
  const names = scored.map((x) => firstName(x.m));
  const liked = item.interests
    .map((i) => ({ i, w: scored.reduce((a, x) => a + (x.m.interests[i] ?? 0), 0) }))
    .filter((x) => x.w >= 4)
    .sort((a, b) => b.w - a.w)
    .slice(0, 2)
    .map((x) => x.i.replace('_', ' '));
  const verb = names.length > 1 ? 'les va a encantar' : 'le va a encantar';
  return { ids: scored.map((x) => x.m.user_id), reason: `A ${joinNames(names)} ${verb}${liked.length ? `: ${liked.join(' y ')}` : ''}` };
}

export function buildLegOptions(args: {
  trip_id: string;
  leg_id: string;
  dates: string[];
  items: CatalogItem[];
  events: CatalogItem[];
  group: PlannerGroup;
  saved: { name: string; google_place_id: string | null }[];
}): LegOptionDraft[] {
  const { group, dates } = args;
  const days = new Set(dates).size;
  const inLeg = new Set(dates);
  const savedIds = new Set(args.saved.map((s) => s.google_place_id).filter(Boolean) as string[]);
  const isSaved = (i: CatalogItem) => (!!i.google_place_id && savedIds.has(i.google_place_id)) || args.saved.some((s) => nameKey(s.name) === nameKey(i.name));

  // Eventos: solo los que caen en el tramo, sin repetir algo que ya está en el catálogo.
  const itemKeys = new Set(args.items.map((i) => nameKey(i.name)));
  const events = args.events
    .map((e) => ({ ...e, event_dates: (e.event_dates ?? []).filter((d) => inLeg.has(d)) }))
    .filter((e) => e.event_dates.length && !itemKeys.has(nameKey(e.name)));

  type Cand = { item: CatalogItem; section: OptionSection; score: number; forced: boolean; reason: string | null; ids: string[] };
  const seen = new Set<string>();
  const cands: Cand[] = [];
  for (const item of [...args.items, ...events]) {
    // Un evento puede ser en un lugar del catálogo (mismo place id): se deduplica aparte.
    const k = item.category === 'event' ? `event:${item.id}` : (item.google_place_id ?? `name:${nameKey(item.name)}`);
    if (seen.has(k) || seen.has(item.id)) continue;
    seen.add(k);
    seen.add(item.id);
    let score = scoreItem(item, group);
    if (score === 0) continue; // lo evitan
    const saved = isSaved(item);
    const asked = isGroupMust(item, group.must);
    if (saved) score = round3(Math.max(score * 1.5, score + 0.2));
    let section: OptionSection;
    if (item.category === 'event') section = 'events';
    else if (item.category === 'day_trip') {
      if (days < 3 && !asked) continue; // en 1-2 días no hay escapada que valga
      section = 'day_trips';
    } else if (item.tier === 'must') section = 'must';
    else if (item.category === 'food') section = 'food';
    else if (item.tier === 'gem') section = 'gems';
    else section = 'for_you';
    const fu = forUsers(item, group);
    const reason = asked ? 'Lo pidieron sí o sí' : saved ? 'Está en tus guardados' : fu.reason;
    cands.push({ item, section, score, forced: saved || asked, reason, ids: fu.ids });
  }

  // Topes por sección y total: lo forzado (guardado / pedido) siempre entra.
  cands.sort((a, b) => Number(b.forced) - Number(a.forced) || b.score - a.score);
  const count: Record<OptionSection, number> = { must: 0, for_you: 0, gems: 0, food: 0, day_trips: 0, events: 0 };
  const kept: Cand[] = [];
  const ordered = [...cands.filter((c) => c.forced), ...cands.filter((c) => !c.forced && c.section === 'must'), ...cands.filter((c) => !c.forced && c.section !== 'must')];
  for (const c of ordered) {
    if (!c.forced && (count[c.section] >= SECTION_CAP[c.section] || kept.length >= MAX_OPTIONS)) continue;
    count[c.section]++;
    kept.push(c);
  }

  // Preselección: forzados siempre; imperdibles salvo que pasen el tope de su tipo (2 iglesias por tramo, 2 museos
  // por día…); después lo mejor por gustos hasta ~85% de la capacidad, con los mismos topes.
  const budget = legCapacityMin(days, group.pace) * PRESELECT_SHARE;
  const pre = new Set<Cand>();
  let used = 0;
  const caps = diversityCaps(group);
  const kindCount = new Map<DiversityKind, number>();
  const kindOf = (c: Cand) => diversityKind(c.item);
  const legCap = (k: DiversityKind) => caps[k].perLeg ?? caps[k].perDay * Math.max(1, days);
  const overCap = (c: Cand) => {
    const k = kindOf(c);
    return !!k && (kindCount.get(k) ?? 0) >= legCap(k);
  };
  const take = (c: Cand) => {
    pre.add(c);
    used += c.item.duration_min;
    const k = kindOf(c);
    if (k) kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
  };
  for (const c of kept) if (c.forced) take(c);
  for (const c of kept.filter((x) => !x.forced && x.section === 'must').sort((a, b) => b.score - a.score)) if (!overCap(c)) take(c);
  let foodPre = 0;
  let tripPre = 0;
  const rest = kept.filter((c) => !pre.has(c)).sort((a, b) => b.score - a.score);
  for (const c of rest) {
    if (c.score < 0.3) break;
    if (c.section === 'food' && foodPre >= days) continue; // las comidas las pone el armado; acá solo las míticas
    if (c.section === 'day_trips' && (days < 4 || tripPre >= 1 || c.score < 0.5)) continue;
    if (used + c.item.duration_min > budget || overCap(c)) continue;
    take(c);
    if (c.section === 'food') foodPre++;
    if (c.section === 'day_trips') tripPre++;
  }

  const out: LegOptionDraft[] = [];
  for (const section of OPTION_SECTIONS) {
    const list = kept.filter((c) => c.section === section).sort((a, b) => Number(b.forced) - Number(a.forced) || b.score - a.score);
    for (const c of list) {
      out.push({
        trip_id: args.trip_id,
        leg_id: args.leg_id,
        item: c.item,
        section,
        score: c.score,
        for_user_ids: c.ids,
        reason: c.reason,
        preselected: pre.has(c),
        sort_order: out.length,
      });
    }
  }
  return out;
}

// ───────────────────────── Deps reales

export function defaultCatalogDeps(): CatalogDeps & Required<EventsDeps> {
  return {
    research,
    searchPlaces: ({ query, near, radius_m, max_results }) =>
      googleSearchPlaces({ query, near, radius_m: radius_m ?? CITY_RADIUS_M, max_results: max_results ?? 1 }),
    placeHours: placeHoursAndPopularity,
    searchEvents: searchEventsLive,
    now: () => new Date(),
  };
}
