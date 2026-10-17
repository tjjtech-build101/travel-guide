// Overpass API (OSM): candidatos por tags (historic=*, tourism=attraction|artwork|viewpoint|museum, memorial=*)
// + wheelchair=* para accesibilidad (PRD 06 "Candidatos en paralelo" y "Accesibilidad"). Sin key.
import { upstream } from '../errors';
import { cached } from './cache';
import { interestsForOsmTags, type InterestTag } from '@build101/shared';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
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
  tags?: Record<string, string>;
};
type OverpassResponse = { elements?: OverpassElement[] };

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
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw upstream(`Overpass no respondió: ${(err as Error).message}`);
    }
    if (!res.ok) throw upstream(`Overpass respondió ${res.status}`);
    const body = (await res.json()) as OverpassResponse;
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
