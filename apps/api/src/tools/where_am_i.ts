// where_am_i: contexto de dónde está la persona. Google Places por DISTANCIA (no popularidad) + viewport para saber
// en qué lugar grande está adentro (campus, parque, shopping) + barrio/ciudad de OSM.
import type { ToolInput } from '@build101/shared';
import { badInput } from '../errors';
import { osmFallbackEnabled, reverseGeocode, type ReverseGeo } from '../google/osm';
import { overpassWhereAmI } from '../google/overpass';
import { env } from '../env';
import { searchNearbyByDistance, type NearbyRaw, type Viewport } from '../google/places';
import type { ToolCtx, ToolOk } from './types';

/** Lugares "contenedores": si el punto cae en su viewport, la persona está ahí (aunque el pin esté a 300 m). */
export const VENUE_TYPES = [
  'university',
  'school',
  'park',
  'national_park',
  'museum',
  'art_gallery',
  'shopping_mall',
  'stadium',
  'hospital',
  'airport',
  'train_station',
  'bus_station',
  'tourist_attraction',
  'historical_landmark',
  'amusement_park',
  'zoo',
  'church',
  'library',
];
const VENUE_RADIUS_M = 600;
/** Viewports más grandes que esto son barrios o ciudades, no "un lugar". */
const MAX_VENUE_AREA_M2 = 5_000_000;
const IGNORED_TYPES = new Set(['route', 'street_address', 'locality', 'political', 'sublocality', 'neighborhood', 'postal_code']);
const NEARBY_LIMIT = 8;

type Pt = { lat: number; lng: number };

export type WhereAmIPlace = {
  google_place_id: string;
  name: string;
  type: string | null;
  address: string | null;
  distance_m: number;
  open_now: boolean | null;
  rating: number | null;
};

export type WhereAmI = {
  here: Pt & { accuracy_m: number | null };
  /** Dónde está probablemente adentro. confidence: high = cae dentro de un lugar grande; medium = pegado a un lugar. */
  inside: (WhereAmIPlace & { confidence: 'high' | 'medium' }) | null;
  /** Lo más cercano, ordenado por distancia (sin el de `inside`). */
  nearby: WhereAmIPlace[];
  area: { neighborhood: string | null; city: string | null; country: string | null } | null;
};

export function distanceM(a: Pt, b: Pt): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

const contains = (v: Viewport, p: Pt) => p.lat >= v.low.lat && p.lat <= v.high.lat && p.lng >= v.low.lng && p.lng <= v.high.lng;
const areaM2 = (v: Viewport) => distanceM(v.low, { lat: v.high.lat, lng: v.low.lng }) * distanceM(v.low, { lat: v.low.lat, lng: v.high.lng });
const isVenue = (p: NearbyRaw) => p.types.some((t) => VENUE_TYPES.includes(t));

function toPlace(p: NearbyRaw, here: Pt): WhereAmIPlace {
  return {
    google_place_id: p.google_place_id,
    name: p.name,
    type: p.primary_type_label ?? p.primary_type,
    address: p.address,
    distance_m: p.lat != null && p.lng != null ? distanceM(here, { lat: p.lat, lng: p.lng }) : Number.POSITIVE_INFINITY,
    open_now: p.open_now,
    rating: p.rating,
  };
}

/** Puro (testeable): elige en qué lugar está adentro y ordena lo cercano. */
export function summarizeLocation(here: Pt, accuracyM: number | null, raw: NearbyRaw[], area: ReverseGeo | null): Omit<WhereAmI, 'here'> {
  const seen = new Set<string>();
  const places = raw.filter(
    (p) => p.google_place_id && p.name && !p.types.some((t) => IGNORED_TYPES.has(t)) && !seen.has(p.google_place_id) && !!seen.add(p.google_place_id),
  );

  // 1) Un lugar grande cuyo viewport contiene el punto: el más chico gana (museo dentro de un parque → el museo).
  const venue = places
    .filter((p) => isVenue(p) && p.viewport && contains(p.viewport, here) && areaM2(p.viewport) <= MAX_VENUE_AREA_M2)
    .sort((a, b) => areaM2(a.viewport!) - areaM2(b.viewport!))[0];
  // 2) Si no, el lugar más cercano si está pegado (dentro del error del GPS).
  const near = Math.max(accuracyM ?? 0, 30);
  const closest = venue ? null : places.map((p) => ({ p, d: toPlace(p, here).distance_m })).sort((a, b) => a.d - b.d)[0];
  const insideRaw = venue ?? (closest && closest.d <= near ? closest.p : null);
  const inside = insideRaw ? { ...toPlace(insideRaw, here), confidence: venue ? ('high' as const) : ('medium' as const) } : null;

  const nearby = places
    .filter((p) => p.google_place_id !== insideRaw?.google_place_id)
    .map((p) => toPlace(p, here))
    .filter((p) => Number.isFinite(p.distance_m))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, NEARBY_LIMIT);

  return { inside, nearby, area: area ? { neighborhood: area.neighborhood, city: area.city, country: area.country } : null };
}

/** Sin key de Google: lo mismo desde OSM (is_in da los polígonos que contienen el punto; su bbox hace de viewport). */
async function osmNearby(here: Pt, radius: number): Promise<NearbyRaw[]> {
  const rows = await overpassWhereAmI({ ...here, radius_m: radius }).catch((err) => {
    console.warn('[where_am_i] overpass:', (err as Error).message);
    return [];
  });
  return rows.map((r) => ({
    google_place_id: `osm:${r.osm_id}`,
    name: r.name,
    address: null,
    lat: r.lat,
    lng: r.lng,
    rating: null,
    price_level: null,
    open_now: null,
    types: r.types,
    primary_type: r.types[0] ?? null,
    primary_type_label: null,
    viewport: r.bounds,
  }));
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]).catch(() => fallback);

export async function where_am_i(input: ToolInput<'where_am_i'>, _ctx: ToolCtx): Promise<ToolOk> {
  if (input.lat == null || input.lng == null) throw badInput('No tengo la posición fresca del celu: mandá lat/lng (la "Ubicación actual del celu" de tus instrucciones).');
  const here = { lat: input.lat, lng: input.lng };
  const accuracy = input.accuracy_m ?? null;
  // Radio chico para lo cercano (ajustado al error del GPS); radio más grande solo para lugares "contenedores".
  const radius = Math.min(Math.max((accuracy ?? 40) * 2, 120), 400);
  const google = !!env().GOOGLE_MAPS_API_KEY;
  const [all, venues, area] = await Promise.all([
    google ? searchNearbyByDistance({ near: here, radius_m: radius }) : osmFallbackEnabled() ? osmNearby(here, radius) : Promise.resolve([]),
    google
      ? searchNearbyByDistance({ near: here, radius_m: VENUE_RADIUS_M, types: VENUE_TYPES }).catch((err) => {
          console.warn('[where_am_i] venues:', (err as Error).message);
          return [] as NearbyRaw[];
        })
      : Promise.resolve([] as NearbyRaw[]),
    withTimeout(reverseGeocode(here.lat, here.lng), 2500, null),
  ]);
  const data: WhereAmI = { here: { ...here, accuracy_m: accuracy }, ...summarizeLocation(here, accuracy, [...venues, ...all], area) };
  return { ok: true, data };
}
