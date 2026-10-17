// Google Places API (New): searchText / searchNearby / place details, con X-Goog-FieldMask mínimo.
import { env } from '../env';
import { notConfigured, upstream } from '../errors';
import { cached } from './cache';
import { isOsmId, osmDetails, osmFallbackEnabled, osmSearch } from './osm';

const BASE = 'https://places.googleapis.com/v1';
const LANG = 'es';

export type PlaceSummary = {
  google_place_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  price_level: number | null;
  open_now: boolean | null;
  types: string[];
};

/** regularOpeningHours.periods de Places (New). day: 0=domingo. Sin `close` = abierto 24 h. */
export type OpeningPeriod = { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } };

export type PlaceDetails = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  user_rating_count: number | null;
  price_level: number | null;
  open_now: boolean | null;
  weekday_hours: string[];
  website: string | null;
  phone: string | null;
  google_maps_uri: string | null;
  editorial_summary: string | null;
};

type GPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[]; periods?: OpeningPeriod[] };
  types?: string[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  editorialSummary?: { text?: string };
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean };
};

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export function googleKey(): string {
  const key = env().GOOGLE_MAPS_API_KEY;
  if (!key) throw notConfigured('Google Maps (GOOGLE_MAPS_API_KEY)');
  return key;
}

export async function googleFetch<T>(url: string, init: { method: 'GET' | 'POST'; fieldMask: string; body?: unknown }): Promise<T> {
  const key = googleKey();
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': init.fieldMask,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw upstream(`Google no respondió: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw upstream(`Google respondió ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function toSummary(p: GPlace): PlaceSummary {
  return {
    google_place_id: p.id ?? '',
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    price_level: p.priceLevel ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
    open_now: p.currentOpeningHours?.openNow ?? null,
    types: p.types ?? [],
  };
}

const SEARCH_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.priceLevel',
  'places.currentOpeningHours.openNow',
  'places.types',
].join(',');

export type SearchArgs = {
  query?: string;
  near?: { lat: number; lng: number };
  radius_m: number;
  open_now?: boolean;
  max_results: number;
};

export async function searchPlaces(args: SearchArgs): Promise<PlaceSummary[]> {
  if (!env().GOOGLE_MAPS_API_KEY && osmFallbackEnabled()) return osmSearch(args);
  googleKey();
  return cached(`search:${JSON.stringify(args)}`, async () => {
    const circle = args.near
      ? { center: { latitude: args.near.lat, longitude: args.near.lng }, radius: Math.min(args.radius_m, 50_000) }
      : undefined;
    let places: GPlace[];
    if (args.query) {
      const body: Record<string, unknown> = { textQuery: args.query, pageSize: args.max_results, languageCode: LANG };
      if (circle) body.locationBias = { circle };
      if (args.open_now) body.openNow = true;
      const res = await googleFetch<{ places?: GPlace[] }>(`${BASE}/places:searchText`, {
        method: 'POST',
        fieldMask: SEARCH_MASK,
        body,
      });
      places = res.places ?? [];
    } else {
      const res = await googleFetch<{ places?: GPlace[] }>(`${BASE}/places:searchNearby`, {
        method: 'POST',
        fieldMask: SEARCH_MASK,
        body: { maxResultCount: Math.min(args.max_results, 20), languageCode: LANG, locationRestriction: { circle } },
      });
      places = res.places ?? [];
      // searchNearby no filtra por abierto: lo hacemos acá.
      if (args.open_now) places = places.filter((p) => p.currentOpeningHours?.openNow !== false);
    }
    return places.map(toSummary).slice(0, args.max_results);
  });
}

const DETAILS_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'priceLevel',
  'currentOpeningHours.openNow',
  'regularOpeningHours.weekdayDescriptions',
  'websiteUri',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'googleMapsUri',
  'editorialSummary',
].join(',');

export async function placeDetails(googlePlaceId: string): Promise<PlaceDetails> {
  if (isOsmId(googlePlaceId)) return osmDetails(googlePlaceId);
  googleKey();
  return cached(`details:${googlePlaceId}`, async () => {
    const p = await googleFetch<GPlace>(
      `${BASE}/places/${encodeURIComponent(googlePlaceId)}?languageCode=${LANG}`,
      { method: 'GET', fieldMask: DETAILS_MASK },
    );
    return {
      name: p.displayName?.text ?? '',
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      user_rating_count: p.userRatingCount ?? null,
      price_level: p.priceLevel ? (PRICE_LEVELS[p.priceLevel] ?? null) : null,
      open_now: p.currentOpeningHours?.openNow ?? null,
      weekday_hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
      website: p.websiteUri ?? null,
      phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
      google_maps_uri: p.googleMapsUri ?? null,
      editorial_summary: p.editorialSummary?.text ?? null,
    };
  });
}

// ───────────────────────── Tour director: búsqueda rica (popularidad, horarios, resumen, accesibilidad)

export type RichPlace = PlaceSummary & {
  user_rating_count: number | null;
  periods: OpeningPeriod[] | null;
  editorial_summary: string | null;
  wheelchair_entrance: boolean | null;
  weekday_hours: string[];
};

const RICH_MASK = [
  SEARCH_MASK,
  'places.userRatingCount',
  'places.regularOpeningHours.periods',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.editorialSummary',
  'places.accessibilityOptions.wheelchairAccessibleEntrance',
].join(',');

/**
 * searchNearby por tipos (restricción al círculo, por popularidad), con los campos que necesita el tour.
 * Un tipo inválido hace fallar solo esa llamada: el caller manda grupos chicos y atrapa cada uno.
 * Sin key de Google: [] (el tour sigue con OSM/Wikipedia/place_library).
 */
export async function searchPlacesRich(args: { near: { lat: number; lng: number }; radius_m: number; types: string[]; max_results?: number }): Promise<RichPlace[]> {
  if (!env().GOOGLE_MAPS_API_KEY) return [];
  return cached(`rich:${JSON.stringify(args)}`, async () => {
    const res = await googleFetch<{ places?: GPlace[] }>(`${BASE}/places:searchNearby`, {
      method: 'POST',
      fieldMask: RICH_MASK,
      body: {
        includedTypes: args.types,
        maxResultCount: Math.min(args.max_results ?? 20, 20),
        rankPreference: 'POPULARITY',
        languageCode: LANG,
        locationRestriction: { circle: { center: { latitude: args.near.lat, longitude: args.near.lng }, radius: Math.min(args.radius_m, 50_000) } },
      },
    });
    return (res.places ?? []).map((p) => ({
      ...toSummary(p),
      user_rating_count: p.userRatingCount ?? null,
      periods: p.regularOpeningHours?.periods ?? null,
      editorial_summary: p.editorialSummary?.text ?? null,
      wheelchair_entrance: p.accessibilityOptions?.wheelchairAccessibleEntrance ?? null,
      weekday_hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
    }));
  });
}
