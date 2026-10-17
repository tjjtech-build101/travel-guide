// Fallback SIN key para search_places / place_details: OpenStreetMap (Photon para buscar, Nominatim para detalle).
// Solo se usa si falta GOOGLE_MAPS_API_KEY (dev / hackathon). Datos reales, nunca inventados; el id va como
// "osm:<N|W|R><id>" en google_place_id (⚠ no es un id de Google: con la key de Google vuelve el camino normal).
// Desactivable con PLACES_OSM_FALLBACK=false.
import { upstream } from '../errors';
import { cached } from './cache';
import type { PlaceDetails, PlaceSummary, SearchArgs } from './places';

const UA = 'build101-hackathon/0.1 (travel app; dev fallback)';
const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/lookup';

export function osmFallbackEnabled(): boolean {
  return (process.env.PLACES_OSM_FALLBACK ?? 'true').trim().toLowerCase() !== 'false';
}

export const isOsmId = (id: string) => id.startsWith('osm:');

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw upstream(`OpenStreetMap no respondió: ${(err as Error).message}`);
  }
  if (!res.ok) throw upstream(`OpenStreetMap respondió ${res.status}`);
  return (await res.json()) as T;
}

type PhotonFeature = {
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    country?: string;
  };
  geometry: { coordinates: [number, number] };
};

/** bbox alrededor de un punto (Photon filtra por bbox; el "near" de Google es solo sesgo). */
export function bboxAround(lat: number, lng: number, radiusM: number): string {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((n) => n.toFixed(5)).join(',');
}

export function photonToSummary(f: PhotonFeature): PlaceSummary | null {
  const p = f.properties;
  if (!p.name || !p.osm_type || !p.osm_id) return null;
  const address = [p.street && `${p.street}${p.housenumber ? ` ${p.housenumber}` : ''}`, p.district, p.city, p.country]
    .filter(Boolean)
    .join(', ');
  return {
    google_place_id: `osm:${p.osm_type}${p.osm_id}`,
    name: p.name,
    address: address || null,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    rating: null,
    price_level: null,
    open_now: null,
    types: [p.osm_value, p.osm_key].filter((x): x is string => !!x),
  };
}

export async function osmSearch(args: SearchArgs): Promise<PlaceSummary[]> {
  return cached(`osm-search:${JSON.stringify(args)}`, async () => {
    const q = new URLSearchParams({ q: args.query ?? 'restaurant', limit: String(Math.min(args.max_results * 2, 20)) });
    if (args.near) {
      q.set('lat', String(args.near.lat));
      q.set('lon', String(args.near.lng));
      q.set('bbox', bboxAround(args.near.lat, args.near.lng, Math.max(args.radius_m, 4000)));
    }
    const res = await getJson<{ features?: PhotonFeature[] }>(`${PHOTON}?${q}`);
    const seen = new Set<string>();
    return (res.features ?? [])
      .map(photonToSummary)
      .filter((p): p is PlaceSummary => !!p && !seen.has(p.google_place_id) && !!seen.add(p.google_place_id))
      .slice(0, args.max_results);
  });
}

// Nominatim: máximo 1 request por segundo (política de uso) → cola serializada.
let nominatimQueue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(fn, fn);
  nominatimQueue = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100)),
  );
  return run;
}

type NominatimPlace = {
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  extratags?: Record<string, string>;
};

type NominatimReverse = { address?: { city?: string; town?: string; village?: string; municipality?: string; country?: string } };

/** lat/lng → ciudad + país (Nominatim reverse, sin key). Usa la misma cola que osmDetails (1 req/s). */
export async function reverseGeocode(lat: number, lng: number): Promise<{ city: string; country: string } | null> {
  return cached(`osm-reverse:${lat.toFixed(3)}:${lng.toFixed(3)}`, async () => {
    const r = await throttled(() =>
      getJson<NominatimReverse>(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=es`),
    );
    const a = r.address;
    const city = a?.city ?? a?.town ?? a?.village ?? a?.municipality;
    if (!city) return null;
    return { city, country: a?.country ?? '' };
  });
}

export async function osmDetails(id: string): Promise<PlaceDetails> {
  return cached(`osm-details:${id}`, async () => {
    const osmId = id.slice(4);
    const rows = await throttled(() => getJson<NominatimPlace[]>(`${NOMINATIM}?osm_ids=${encodeURIComponent(osmId)}&format=jsonv2&extratags=1&accept-language=es`));
    const p = rows[0];
    if (!p) throw upstream(`OpenStreetMap no tiene ${id}`);
    const tags = p.extratags ?? {};
    return {
      name: p.name ?? '',
      address: p.display_name ?? null,
      lat: p.lat ? Number(p.lat) : null,
      lng: p.lon ? Number(p.lon) : null,
      rating: null,
      user_rating_count: null,
      price_level: null,
      open_now: null,
      // Formato OSM, ej. "Mo-Su 09:30-17:00" (sin dato → [] y el agente no inventa horario).
      weekday_hours: tags.opening_hours ? [`opening_hours (OSM): ${tags.opening_hours}`] : [],
      website: tags.website ?? tags['contact:website'] ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      google_maps_uri: null,
      editorial_summary: tags.description ?? null,
    };
  });
}
