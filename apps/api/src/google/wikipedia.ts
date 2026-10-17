// Wikipedia geosearch (candidatos) + Wikidata (wbgetentities, para contar sitelinks como señal de notoriedad).
// Sin key. PRD 06 "Candidatos en paralelo".
import { upstream } from '../errors';
import { cached } from './cache';

// Política de Wikimedia: User-Agent con nombre, versión y URL de contacto (si no, limita mucho antes).
const UA = 'build101-tour-guide/0.2 (https://build101.dev; hackathon travel guide) node-fetch';

async function getJson<T>(url: string, retries = 1): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (err) {
    if (retries > 0) return getJson<T>(url, retries - 1);
    throw upstream(`Wikipedia/Wikidata no respondió: ${(err as Error).message}`);
  }
  // 429/5xx: un reintento corto (Wikimedia limita ráfagas).
  if ((res.status === 429 || res.status >= 500) && retries > 0) {
    const after = Number(res.headers.get('retry-after'));
    await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after, 3) * 1000 : 1200));
    return getJson<T>(url, retries - 1);
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

// ───────────────────────── Tour director: info de Wikidata en lote + textos de Wikipedia

export type WikidataInfo = { sitelinks: number; eswiki: string | null; enwiki: string | null };

type EntitiesWithLinks = { entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }> };

/** Sitelinks (notoriedad) + títulos en es/en de hasta 50 ítems por llamada. Ids sin datos quedan afuera. */
export async function wikidataInfo(ids: string[]): Promise<Map<string, WikidataInfo>> {
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))];
  const out = new Map<string, WikidataInfo>();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const res = await cached(`wikidata-info:${chunk.join('|')}`, () =>
      getJson<EntitiesWithLinks>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=sitelinks&format=json&origin=*`,
      ),
    );
    for (const [id, e] of Object.entries(res.entities ?? {})) {
      const links = e.sitelinks ?? {};
      out.set(id, { sitelinks: Object.keys(links).length, eswiki: links.eswiki?.title ?? null, enwiki: links.enwiki?.title ?? null });
    }
  }
  return out;
}

type ExtractsResponse = { query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> } };

/** Introducción (primeras oraciones, texto plano) de hasta 20 artículos: resumen barato para el director. */
export async function wikipediaIntros(titles: string[], lang = 'es'): Promise<Map<string, string>> {
  const unique = [...new Set(titles.filter(Boolean))];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const q = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exsentences: '3',
      exlimit: '20',
      redirects: '1',
      titles: chunk.join('|'),
      format: 'json',
      origin: '*',
    });
    const res = await cached(`wiki-intros:${lang}:${chunk.join('|')}`, () =>
      getJson<ExtractsResponse>(`https://${lang}.wikipedia.org/w/api.php?${q}`),
    );
    for (const p of Object.values(res.query?.pages ?? {})) {
      if (p.title && p.extract && p.missing === undefined) out.set(p.title, p.extract.trim());
    }
  }
  return out;
}

export type WikiArticle = { title: string; url: string; text: string; lang: string };

/** Artículo completo en texto plano (recortado a `maxChars`): la fuente principal de datos de una parada. */
export async function wikipediaArticle(title: string, lang = 'es', maxChars = 16_000): Promise<WikiArticle | null> {
  const q = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    inprop: 'url',
    explaintext: '1',
    redirects: '1',
    titles: title,
    format: 'json',
    origin: '*',
  });
  const res = await cached(`wiki-article:${lang}:${title}`, () =>
    getJson<{ query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string; missing?: string }> } }>(
      `https://${lang}.wikipedia.org/w/api.php?${q}`,
    ),
  );
  const page = Object.values(res.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined || !page.extract) return null;
  // Sin las secciones de cola (referencias, enlaces): no aportan datos y gastan tokens.
  const text = page.extract.split(/\n==+\s*(Referencias|Notas|Enlaces externos|Bibliografía|Véase también|References|External links|See also|Notes)\s*==+/i)[0];
  return {
    title: page.title ?? title,
    url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((page.title ?? title).replace(/ /g, '_'))}`,
    text: text.slice(0, maxChars),
    lang,
  };
}
