// Wikipedia geosearch (candidatos) + Wikidata (wbgetentities, para contar sitelinks como señal de notoriedad).
// Sin key. PRD 06 "Candidatos en paralelo".
import { upstream } from '../errors';
import { cached } from './cache';

const UA = 'build101-hackathon/0.1 (travel app; tour generator)';

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw upstream(`Wikipedia/Wikidata no respondió: ${(err as Error).message}`);
  }
  if (!res.ok) throw upstream(`Wikipedia/Wikidata respondió ${res.status}`);
  return (await res.json()) as T;
}

export type WikiGeoResult = {
  pageid: number;
  title: string;
  lat: number;
  lng: number;
  dist_m: number;
  wikidata_id: string | null;
};

type GeosearchResponse = {
  query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] };
};
type PagePropsResponse = {
  query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
};

/** `action=query&list=geosearch`: hasta `limit` artículos con coordenadas cerca de (lat,lng). */
export async function wikipediaGeosearch(args: { lat: number; lng: number; radius_m: number; limit?: number; lang?: string }): Promise<WikiGeoResult[]> {
  const lang = args.lang ?? 'es';
  const radius = Math.min(Math.max(Math.round(args.radius_m), 10), 10_000);
  const limit = Math.min(args.limit ?? 50, 50);
  return cached(`wiki-geo:${lang}:${args.lat}:${args.lng}:${radius}:${limit}`, async () => {
    const base = `https://${lang}.wikipedia.org/w/api.php`;
    const geo = await getJson<GeosearchResponse>(
      `${base}?action=query&list=geosearch&gscoord=${args.lat}|${args.lng}&gsradius=${radius}&gslimit=${limit}&format=json&origin=*`,
    );
    const pages = geo.query?.geosearch ?? [];
    if (!pages.length) return [];
    const ids = pages.map((p) => p.pageid).join('|');
    let wikidataByPage = new Map<number, string>();
    try {
      const props = await getJson<PagePropsResponse>(`${base}?action=query&pageids=${ids}&prop=pageprops&format=json&origin=*`);
      for (const [pid, page] of Object.entries(props.query?.pages ?? {})) {
        if (page.pageprops?.wikibase_item) wikidataByPage.set(Number(pid), page.pageprops.wikibase_item);
      }
    } catch {
      wikidataByPage = new Map(); // sin wikidata_id no bloquea: el lugar igual sirve como candidato
    }
    return pages.map((p) => ({
      pageid: p.pageid,
      title: p.title,
      lat: p.lat,
      lng: p.lon,
      dist_m: p.dist,
      wikidata_id: wikidataByPage.get(p.pageid) ?? null,
    }));
  });
}

type EntityResponse = { entities?: Record<string, { sitelinks?: Record<string, unknown> }> };

/** Cantidad de sitelinks de un ítem de Wikidata (señal de notoriedad, PRD 06 "Score"). */
export async function wikidataSitelinkCount(wikidataId: string): Promise<number> {
  return cached(`wikidata-sitelinks:${wikidataId}`, async () => {
    const res = await getJson<EntityResponse>(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(wikidataId)}&props=sitelinks&format=json&origin=*`,
    );
    const entity = res.entities?.[wikidataId];
    return entity?.sitelinks ? Object.keys(entity.sitelinks).length : 0;
  });
}
