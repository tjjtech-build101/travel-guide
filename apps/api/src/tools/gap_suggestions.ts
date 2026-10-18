// gap_suggestions (Ahora v2): hasta 3 ideas para un hueco libre. Solo reglas (sin Claude):
// banco de ideas del tramo + lugares abiertos cerca (Google) + eventos de hoy ya cacheados por events_search.
import { walkEstimateMin, type GapSuggestion, type ToolInput } from '@build101/shared';
import { cachedEventsOn } from '../agents/eventsSearch';
import type { EventItemT } from '../agents/eventsSchemas';
import { env } from '../env';
import { badInput, dbError, notFound } from '../errors';
import { searchPlaces, type PlaceSummary } from '../google/places';
import type { Db } from '../supabase';
import { toMin } from '../schedule';
import type { ToolCtx, ToolOk } from './types';

type LatLng = { lat: number; lng: number };

/** Idea del banco (blocks con day_id null) que el usuario puede ver. */
export type BankIdea = {
  id: string;
  title: string;
  type: string;
  place_name: string | null;
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
  duration_min: number | null;
  /** Privada (propia): sirve en gap_suggestions (la ve solo uno), nunca en una propuesta compartida. */
  is_private: boolean;
};

/** Caminata máxima para un hueco: un tercio del tiempo (ida, estadía y vuelta), entre 5 y 25 min. */
export function maxWalkFor(minutes: number): number {
  return Math.max(5, Math.min(25, Math.floor(minutes / 3)));
}

/** Radio de búsqueda para esa caminata (walkEstimateMin: distancia × 1,3 a 80 m/min). */
export function radiusFor(maxWalkMin: number): number {
  return Math.round((maxWalkMin * 80) / 1.3);
}

/** Banco de ideas del tramo, sin privados ajenos. */
export async function loadBankIdeas(admin: Db, legId: string, userId: string): Promise<BankIdea[]> {
  const { data, error } = await admin
    .from('blocks')
    .select('id,title,type,place_name,google_place_id,lat,lng,duration_min,is_private,created_by,plan_variant')
    .eq('leg_id', legId)
    .is('day_id', null)
    .limit(100);
  if (error) throw dbError(error, 'blocks');
  return (data ?? [])
    .filter((b) => !b.is_private || b.created_by === userId)
    .filter((b) => !b.plan_variant || b.plan_variant === 'main')
    .map((b) => ({
      id: b.id as string,
      title: b.title as string,
      type: b.type as string,
      place_name: (b.place_name as string | null) ?? null,
      google_place_id: (b.google_place_id as string | null) ?? null,
      lat: (b.lat as number | null) ?? null,
      lng: (b.lng as number | null) ?? null,
      duration_min: (b.duration_min as number | null) ?? null,
      is_private: !!b.is_private,
    }));
}

/** Tipos de Google que tienen sentido para un rato libre (sacamos bancos, farmacias, estaciones…). */
const LEISURE_TYPES = new Set([
  'cafe',
  'coffee_shop',
  'bakery',
  'ice_cream_shop',
  'restaurant',
  'bar',
  'museum',
  'art_gallery',
  'park',
  'tourist_attraction',
  'book_store',
  'market',
  'church',
  'historical_landmark',
  'plaza',
  'viewpoint',
  'garden',
]);

/** Lugares abiertos ahora cerca. Sin GOOGLE_MAPS_API_KEY o si Google falla → []. */
export async function nearbyOpenPlaces(here: LatLng, radiusM: number, max = 8): Promise<PlaceSummary[]> {
  if (!env().GOOGLE_MAPS_API_KEY) return [];
  try {
    const places = await searchPlaces({ near: here, radius_m: radiusM, open_now: true, max_results: 20 });
    return places.filter((p) => p.open_now !== false && p.types.some((t) => LEISURE_TYPES.has(t))).slice(0, max);
  } catch (err) {
    console.warn('[gap_suggestions] sin lugares:', (err as Error).message);
    return [];
  }
}

const walkTo = (here: LatLng, p: { lat: number | null; lng: number | null }) =>
  p.lat != null && p.lng != null ? walkEstimateMin(here, { lat: p.lat, lng: p.lng }) : null;

const walkText = (w: number | null) => (w == null ? null : w <= 1 ? 'A un paso' : `${w} min a pie`);

type Scored = GapSuggestion & { score: number };

/** Arma y ordena los candidatos. Pura (testeable): menos caminata y abierto suben; después, diversidad de fuente. */
export function rankSuggestions(args: {
  here: LatLng;
  minutes: number;
  localTime: string;
  ideas: BankIdea[];
  places: PlaceSummary[];
  events: EventItemT[];
  limit: number;
}): GapSuggestion[] {
  const { here, minutes } = args;
  const maxWalk = maxWalkFor(minutes);
  const nowMin = toMin(args.localTime) ?? 0;
  const out: Scored[] = [];

  const ideaPlaceIds = new Set<string>();
  for (const i of args.ideas) {
    if (i.lat == null || i.lng == null) continue;
    const w = walkTo(here, i)!;
    if (w > maxWalk) continue;
    if (i.duration_min != null && i.duration_min + 2 * w > minutes) continue;
    if (i.google_place_id) ideaPlaceIds.add(i.google_place_id);
    out.push({
      id: i.id,
      source: 'idea',
      title: i.title,
      place_name: i.place_name,
      lat: i.lat,
      lng: i.lng,
      walk_min: w,
      why: ['Tu idea', walkText(w)].filter(Boolean).join(' · '),
      block_id: i.id,
      google_place_id: i.google_place_id,
      // Las ideas que eligió el grupo valen más que un lugar cualquiera.
      score: 30 - w,
    });
  }

  for (const p of args.places) {
    if (!p.google_place_id || ideaPlaceIds.has(p.google_place_id)) continue;
    const w = walkTo(here, p);
    if (w == null || w > maxWalk) continue;
    out.push({
      id: `place:${p.google_place_id}`,
      source: 'place',
      title: p.name,
      place_name: p.address,
      lat: p.lat,
      lng: p.lng,
      walk_min: w,
      why: ['Abierto ahora', walkText(w), p.rating ? `★ ${p.rating.toFixed(1)}` : null].filter(Boolean).join(' · '),
      google_place_id: p.google_place_id,
      score: 20 - w + (p.rating ? (p.rating - 4) * 4 : 0),
    });
  }

  for (const e of args.events) {
    const start = toMin(e.start_time);
    // Solo lo que empieza dentro del hueco (o sin hora conocida).
    if (start != null && (start < nowMin || start > nowMin + minutes - 30)) continue;
    out.push({
      id: `event:${e.url || e.title}`,
      source: 'event',
      title: e.title,
      place_name: e.venue,
      lat: null,
      lng: null,
      walk_min: null,
      why: [start != null ? `Hoy a las ${e.start_time}` : 'Hoy', e.venue].filter(Boolean).join(' · '),
      start_time: e.start_time,
      url: e.url || null,
      score: 15 - (start != null ? (start - nowMin) / 10 : 3),
    });
  }

  // Diversidad: primero el mejor de cada fuente (por puntaje), después el resto.
  const sorted = out.sort((a, b) => b.score - a.score);
  const picked: Scored[] = [];
  const seenSource = new Set<string>();
  for (const s of sorted) {
    if (picked.length >= args.limit) break;
    if (!seenSource.has(s.source)) {
      picked.push(s);
      seenSource.add(s.source);
    }
  }
  for (const s of sorted) {
    if (picked.length >= args.limit) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return picked.sort((a, b) => b.score - a.score).map(({ score: _s, ...g }) => g);
}

/** Corta una promesa a los `ms`: si tarda, devuelve `fallback`. */
async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p.catch(() => fallback), t]);
  } finally {
    clearTimeout(timer);
  }
}

export async function gap_suggestions(input: ToolInput<'gap_suggestions'>, ctx: ToolCtx): Promise<ToolOk> {
  // RLS: si no sos miembro, el tramo no aparece.
  const { data: leg, error } = await ctx.db.from('legs').select('id,trip_id,city,country').eq('id', input.leg_id).maybeSingle();
  if (error) throw dbError(error, 'legs');
  if (!leg) throw notFound('No encontré ese tramo (o no sos miembro del viaje).');
  if (leg.trip_id !== input.trip_id) throw badInput('El tramo (leg_id) no es de este viaje.');

  const here = { lat: input.lat, lng: input.lng };
  const radius = radiusFor(maxWalkFor(input.minutes));
  const city = (leg.city as string | null) ?? null;
  const [ideas, places, events] = await Promise.all([
    loadBankIdeas(ctx.admin, input.leg_id, ctx.userId),
    within(nearbyOpenPlaces(here, radius), 3000, []),
    city ? within(cachedEventsOn(ctx.admin, { city, country: leg.country as string | null, date: input.date }), 1500, []) : [],
  ]);
  const items = rankSuggestions({ here, minutes: input.minutes, localTime: input.local_time, ideas, places, events, limit: input.limit });
  return { ok: true, data: { items } };
}

