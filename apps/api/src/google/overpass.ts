// Overpass API (OSM): candidatos por tags (historic=*, tourism=attraction|artwork|viewpoint|museum, memorial=*)
// + wheelchair=* para accesibilidad (PRD 06 "Candidatos en paralelo" y "Accesibilidad"). Sin key.
import { upstream } from '../errors';
import { cached } from './cache';
import { interestsForOsmTags, type InterestTag } from '@build101/shared';

// El servidor principal se satura seguido: probamos espejos públicos en orden.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'build101-hackathon/0.1 (travel app; tour generator)';

export type OverpassCandidate = {
  osm_id: string; // "N1234" | "W1234" | "R1234"
  name: string;
  lat: number;
  lng: number;
  tags: Record<string, string>;
  interests: InterestTag[];
  wheelchair: 'yes' | 'no' | 'limited' | null;
};

const KIND_PREFIX: Record<string, string> = { node: 'N', way: 'W', relation: 'R' };

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  tags?: Record<string, string>;
};
type OverpassResponse = { elements?: OverpassElement[] };

async function overpassQuery(query: string): Promise<OverpassResponse> {
  let lastErr = '';
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        lastErr = `${endpoint} respondió ${res.status}`;
        continue;
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastErr = `${endpoint}: ${(err as Error).message}`;
    }
  }
  throw upstream('OpenStreetMap (Overpass) no respondió.', 'osm', String(lastErr));
}

const WHEELCHAIR: Record<string, 'yes' | 'no' | 'limited'> = { yes: 'yes', no: 'no', limited: 'limited', designated: 'yes' };

/** Candidatos OSM con historia/turismo/memoriales en un radio. `out center` para ways/relations. */
export async function overpassCandidates(args: { lat: number; lng: number; radius_m: number }): Promise<OverpassCandidate[]> {
  const radius = Math.min(Math.max(Math.round(args.radius_m), 50), 3000);
  return cached(`overpass:${args.lat}:${args.lng}:${radius}`, async () => {
    const around = `(around:${radius},${args.lat},${args.lng})`;
    const filters = ['historic', 'memorial'].map((k) => `nwr["${k}"]${around};`).join('\n          ');
    const tourismFilter = `nwr["tourism"~"^(attraction|artwork|viewpoint|museum)$"]${around};`;
    const query = `
      [out:json][timeout:20];
      (
          ${filters}
          ${tourismFilter}
      );
      out center tags;
    `;
    const body = await overpassQuery(query);
    const seen = new Set<string>();
    const out: OverpassCandidate[] = [];
    for (const el of body.elements ?? []) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) continue;
      const osm_id = `${KIND_PREFIX[el.type]}${el.id}`;
      if (seen.has(osm_id)) continue;
      seen.add(osm_id);
      out.push({
        osm_id,
        name,
        lat,
        lng,
        tags,
        interests: interestsForOsmTags(tags),
        wheelchair: WHEELCHAIR[tags.wheelchair ?? ''] ?? null,
      });
    }
    return out;
  });
}

// ───────────────────────── where_am_i sin key de Google: áreas que contienen el punto (is_in) + lugares con nombre cerca

const POI_KEYS = 'amenity|shop|tourism|leisure|historic';
/** Valores OSM → tipos de Google, para que where_am_i reconozca los "contenedores". */
const OSM_TO_GOOGLE: Record<string, string> = { mall: 'shopping_mall', place_of_worship: 'church', attraction: 'tourist_attraction', college: 'university' };

export type OsmNearby = {
  osm_id: string;
  name: string;
  lat: number;
  lng: number;
  types: string[];
  bounds: { low: { lat: number; lng: number }; high: { lat: number; lng: number } } | null;
};

export async function overpassWhereAmI(args: { lat: number; lng: number; radius_m: number }): Promise<OsmNearby[]> {
  const radius = Math.min(Math.max(Math.round(args.radius_m), 50), 600);
  const { lat, lng } = args;
  return cached(`overpass-wai:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`, async () => {
    // Uniones por clave (más livianas que un filtro de clave por regex).
    const keys = POI_KEYS.split('|');
    const inside = keys.flatMap((k) => [`way(pivot.a)[name]["${k}"];`, `relation(pivot.a)[name]["${k}"];`]).join(' ');
    const around = keys.map((k) => `nwr(around:${radius},${lat},${lng})[name]["${k}"];`).join(' ');
    const query = `
      [out:json][timeout:15];
      is_in(${lat},${lng})->.a;
      (${inside});
      out center bb tags;
      (${around});
      out center bb tags;
    `;
    const body = await overpassQuery(query);
    const out: OsmNearby[] = [];
    for (const el of body.elements ?? []) {
      const tags = el.tags ?? {};
      const plat = el.lat ?? el.center?.lat;
      const plng = el.lon ?? el.center?.lon;
      if (!tags.name || plat == null || plng == null) continue;
      const raw = POI_KEYS.split('|').map((k) => tags[k]).filter((v): v is string => !!v && v !== 'yes');
      const b = el.bounds;
      out.push({
        osm_id: `${KIND_PREFIX[el.type]}${el.id}`,
        name: tags.name,
        lat: plat,
        lng: plng,
        types: raw.map((v) => OSM_TO_GOOGLE[v] ?? v),
        bounds: b ? { low: { lat: b.minlat, lng: b.minlon }, high: { lat: b.maxlat, lng: b.maxlon } } : null,
      });
    }
    return out;
  });
}
