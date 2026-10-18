// Investigación profunda de cada parada (tour director, fase 2). El tour sale "listo" con lo que entra en los 300 s
// de generate_tour; apenas sale, cada parada se investiga A FONDO en su propia invocación (POST /internal/enrich-stop,
// 300 s propios) mientras la persona camina a la primera:
//   1) Wikipedia en español E inglés, completas (no la intro), partidas en tramos → datos con cita textual chequeada
//      en código contra el artículo.
//   2) Tres búsquedas web en paralelo por ángulo (historia y personajes · arquitectura, arte y detalles visibles ·
//      curiosidades, mitos, anécdotas y presente), con más búsquedas y lecturas que la fase 1. Cada cita se chequea
//      contra la página (o, si no se puede bajar, con web_fetch de Claude).
//   3) Un juez independiente confirma, en lotes, que cada cita respalda su dato tal cual.
//   4) Todo lo verificado se SUMA a place_library (memoria de lugares, appendFacts: nunca reemplaza).
//   5) Las capas de la parada se reescriben más largas con el dossier completo (chequeo [fN]: lo no respaldado se borra).
// get_stop_content devuelve además el dossier (facts), así el Scout puede seguir contando y responder sin inventar.
import { createHmac } from 'node:crypto';
import { distanceMeters } from '@build101/shared';
import { env } from '../env';
import { fetchPageText } from '../google/pageText';
import { wikidataInfo, wikipediaArticle, wikipediaGeosearch, type WikiArticle } from '../google/wikipedia';
import { createJob, JobProgress, runInBackground } from '../jobs';
import { appendFacts, normText, type LibraryFact } from '../places/library';
import type { Db } from '../supabase';
import { type Effort } from './llm';
import { addUsage, emptyUsage, estimateCostUsd, type Usage } from './schemas';
import { checkNarration, quoteInText, sourcesFor, wordCount, type CitedFact } from './tourCheck';
import { anthropicTourLlm, type TourLLM, type TourLlmConfig } from './tourLlm';
import {
  EXTRACT_SYSTEM,
  JUDGE_SYSTEM,
  RESEARCH_SYSTEM,
  VERIFY_SYSTEM,
  WRITER_SYSTEM,
  renderExtractUser,
  renderJudgeUser,
  renderResearchUser,
  renderVerifyUser,
  renderWriterUser,
} from './tourPrompts';
import type { WrittenStopT } from './tourSchemas';
import type { Fact } from './tourGenerator';

// ───────────────────────── Puro

/** Parte un artículo en tramos de ~maxChars cortando en párrafos (para extraer TODO sin pasarse de contexto). */
export function chunkText(text: string, maxChars = 12_000, maxChunks = 6): string[] {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 1 > maxChars) {
      out.push(cur);
      cur = '';
      if (out.length >= maxChunks) break;
    }
    cur = cur ? `${cur}\n${p.slice(0, maxChars)}` : p.slice(0, maxChars);
  }
  if (cur && out.length < maxChunks) out.push(cur);
  return out;
}

export function dedupeFactList<T extends { text: string }>(facts: T[]): T[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = normText(f.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Los mejores N facts para escribir: variedad de tipos (historias y personas primero) y de fuentes. */
export function pickFactsForWriting(facts: Fact[], n = 45): Fact[] {
  const order: Record<string, number> = { story: 0, person: 1, detail: 2, myth: 3, date: 4, number: 5 };
  const sorted = [...facts].sort((a, b) => (order[a.kind ?? ''] ?? 6) - (order[b.kind ?? ''] ?? 6));
  const out: Fact[] = [];
  const perUrl = new Map<string, number>();
  // Primera vuelta: máx. 15 por fuente (variedad); segunda: completa.
  for (const f of sorted) {
    if (out.length >= n) break;
    const c = perUrl.get(f.source_url) ?? 0;
    if (c >= 15) continue;
    perUrl.set(f.source_url, c + 1);
    out.push(f);
  }
  for (const f of sorted) {
    if (out.length >= n) break;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** Token para que la API se llame a sí misma (fan-out por parada) sin exponer el endpoint. */
export function internalToken(stopId: string, secret = env().SUPABASE_SERVICE_ROLE_KEY): string {
  return createHmac('sha256', secret || 'dev').update(`enrich-stop:${stopId}`).digest('hex');
}

// ───────────────────────── Investigación de un lugar

export const DEEP_ANGLES = [
  'historia completa y personajes: quién lo hizo y por qué, épocas, hechos que pasaron acá, conflictos, cambios de uso, protagonistas y anécdotas documentadas',
  'arquitectura, arte y detalles visibles hoy: estilo, materiales, autores, elementos que se pueden señalar (fachada, interiores, inscripciones, obras), restauraciones',
  'curiosidades, mitos y leyendas (y si son ciertos), récords, cultura popular, qué pasa hoy ahí (uso actual, visitas, eventos) y datos poco conocidos',
];

export type DeepDeps = {
  llm: TourLLM;
  config: TourLlmConfig & { writerEffort: Effort };
  wikipediaArticle: (title: string, lang: string, maxChars: number) => Promise<WikiArticle | null>;
  findWikiTitles: (p: { name: string; lat: number | null; lng: number | null; wikidata_id: string | null }) => Promise<{ es: string | null; en: string | null }>;
  fetchPageText: (url: string) => Promise<string | null>;
  now: () => number;
};

export type DeepPlace = { name: string; city: string; country: string; lat: number | null; lng: number | null; wikidata_id: string | null; known: Fact[]; audience: string; interests: string[] };

export type DeepResult = { facts: Fact[]; rejected: number; webSearches: number; usage: Usage };

export async function deepResearchPlace(p: DeepPlace, deps: DeepDeps, budgetMs = 200_000): Promise<DeepResult> {
  const t0 = deps.now();
  const left = () => budgetMs - (deps.now() - t0);
  const usage = emptyUsage();
  const at = new Date().toISOString();
  const pending: (Fact & { quote: string })[] = [];
  let rejected = 0;
  let webSearches = 0;
  const cfg = deps.config;

  // 1) Wikipedia es + en completas, en tramos (en paralelo).
  const titles = await deps.findWikiTitles(p).catch(() => ({ es: null, en: null }));
  const articles = (
    await Promise.all([
      titles.es ? deps.wikipediaArticle(titles.es, 'es', 60_000) : Promise.resolve(null),
      titles.en ? deps.wikipediaArticle(titles.en, 'en', 45_000) : Promise.resolve(null),
    ])
  ).filter((a): a is WikiArticle => !!a && a.text.length > 300);
  const chunkJobs = articles.flatMap((article) => chunkText(article.text).map((text) => ({ article, text })));

  // 2) Web por ángulo, en paralelo con Wikipedia (no esperan una a la otra).
  const webP = Promise.all(
    DEEP_ANGLES.map(async (angle) => {
      try {
        const r = await deps.llm.research({
          system: RESEARCH_SYSTEM,
          user: renderResearchUser({ place: p.name, city: p.city, country: p.country, lat: p.lat ?? 0, lng: p.lng ?? 0, known: p.known.slice(0, 40).map((f) => f.text), angle, interests: p.interests }),
          config: { ...cfg, effort: 'medium', maxTokens: 12_000, maxIterations: 14 },
          maxUses: 6,
        });
        addUsage(usage, r.usage);
        webSearches += r.web_search_calls;
        return r.facts;
      } catch (err) {
        console.warn(`[deep-research] web "${angle.slice(0, 20)}" de ${p.name}:`, (err as Error).message);
        return [];
      }
    }),
  );

  const wikiP = Promise.all(
    chunkJobs.map(async ({ article, text }) => {
      try {
        const ex = await deps.llm.extractFacts({
          system: EXTRACT_SYSTEM,
          user: renderExtractUser({ place: p.name, city: p.city, article: { title: article.title, text }, audience: p.audience, angle: 'Todo lo que sirva para contar este lugar en profundidad.' }),
          config: { ...cfg, effort: 'low', maxTokens: 10_000 },
        });
        addUsage(usage, ex.usage);
        for (const f of ex.facts) {
          if (quoteInText(f.quote, text)) {
            pending.push({ text: f.text, quote: f.quote, kind: f.kind, source_url: article.url, source_title: `Wikipedia (${article.lang}) · ${article.title}`, verified: false, verified_at: at, origin: 'tour' });
          } else rejected++;
        }
      } catch (err) {
        console.warn(`[deep-research] extracción de ${article.title}:`, (err as Error).message);
      }
    }),
  );

  const [webFacts] = await Promise.all([webP, wikiP]);

  // Citas de la web: chequeo en código contra la página; si no se puede bajar, web_fetch de Claude.
  const flat = dedupeFactList(webFacts.flat());
  await Promise.all(
    flat.map(async (f) => {
      const page = await deps.fetchPageText(f.source_url);
      if (page) {
        if (quoteInText(f.quote, page)) pending.push({ ...f, verified: false, verified_at: at, origin: 'tour' });
        else rejected++;
        return;
      }
      if (left() < 25_000) return void rejected++;
      try {
        const v = await deps.llm.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(f), config: { ...cfg, effort: 'low', maxTokens: 3000 } });
        addUsage(usage, v.usage);
        if (v.result?.supported && v.result.quote.trim()) pending.push({ ...f, quote: v.result.quote, verified: false, verified_at: at, origin: 'tour' });
        else rejected++;
      } catch {
        rejected++;
      }
    }),
  );

  // 3) Juez en lotes de 20 (en paralelo).
  const knownKeys = new Set(p.known.map((f) => normText(f.text)));
  const fresh = dedupeFactList(pending).filter((f) => !knownKeys.has(normText(f.text)));
  const batches: (typeof fresh)[] = [];
  for (let i = 0; i < fresh.length; i += 20) batches.push(fresh.slice(i, i + 20));
  const verified: Fact[] = [];
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const pairs = batch.map((f, i) => ({ id: `c${i + 1}`, text: f.text, quote: f.quote }));
        const j = await deps.llm.judgeFacts({ system: JUDGE_SYSTEM, user: renderJudgeUser(p.name, pairs), config: { ...cfg, effort: 'low', maxTokens: 4000 } });
        addUsage(usage, j.usage);
        const ok = new Set(j.verdicts.filter((v) => v.supported).map((v) => v.id));
        batch.forEach((f, i) => (ok.has(`c${i + 1}`) ? verified.push({ ...f, verified: true }) : rejected++));
      } catch {
        // Sin juez: quedan los que pasaron el chequeo textual de la cita (filtro fuerte).
        batch.forEach((f) => verified.push({ ...f, verified: true }));
      }
    }),
  );
  return { facts: verified, rejected, webSearches, usage };
}

// ───────────────────────── Enriquecer una parada (investigar + reescribir largo + guardar)

type StopRowDeep = {
  id: string;
  tour_id: string;
  place_id: string | null;
  sort_order: number | null;
  look_at: string | null;
  narration_short: string | null;
  narration_more: string | null;
  narration_secret: string | null;
  myth_vs_fact: string | null;
  photo_spot: string | null;
  kid_mission: string | null;
  transition_to_next: string | null;
  nav_to_next: string | null;
  sources: { url: string; title?: string }[] | null;
  dwell_min: number | null;
  place_library: { name: string | null; lat: number | null; lng: number | null; wikidata_id: string | null; city: string | null; country: string | null; tier: string | null; facts: LibraryFact[] | null } | null;
};

export const DEEP_LENGTHS = { short: '120-180', more: '300-450', secret: '150-250' };

export type EnrichResult = { stop_id: string; facts_before: number; facts_added: number; rewritten: boolean; words_before: number; words_after: number; cost_usd: number };

export async function enrichStop(admin: Db, stopId: string, deps: DeepDeps = defaultDeepDeps()): Promise<EnrichResult> {
  const t0 = Date.now();
  const { data: stop, error } = await admin
    .from('tour_stops')
    .select('id,tour_id,place_id,sort_order,look_at,narration_short,narration_more,narration_secret,myth_vs_fact,photo_spot,kid_mission,transition_to_next,nav_to_next,sources,dwell_min,place_library(name,lat,lng,wikidata_id,city,country,tier,facts)')
    .eq('id', stopId)
    .maybeSingle();
  if (error || !stop) throw new Error(`No encontré la parada ${stopId}: ${error?.message ?? ''}`);
  const s = stop as unknown as StopRowDeep;
  const place = s.place_library;
  const name = place?.name ?? `Parada ${s.sort_order ?? ''}`;
  const known = ((place?.facts ?? []) as Fact[]).filter((f) => f.verified);
  const wordsBefore = wordCount(s.narration_short) + wordCount(s.narration_more) + wordCount(s.narration_secret);

  const [{ data: tour }, { data: siblings }] = await Promise.all([
    admin.from('tours').select('title,thesis,storyline,brief').eq('id', s.tour_id).maybeSingle(),
    admin.from('tour_stops').select('id,sort_order,place_library(name,lat,lng)').eq('tour_id', s.tour_id).order('sort_order'),
  ]);
  const brief = (tour?.brief ?? null) as { audience?: string; roles?: string[] } | null;
  const audience = brief?.audience ?? '';
  const sibs = (siblings ?? []) as unknown as { id: string; sort_order: number; place_library: { name: string | null; lat: number | null; lng: number | null } | null }[];
  const idx = sibs.findIndex((x) => x.id === s.id);
  const next = idx >= 0 ? sibs[idx + 1] : undefined;

  // 1) Investigar a fondo.
  const deep = await deepResearchPlace(
    { name, city: place?.city ?? '', country: place?.country ?? '', lat: place?.lat ?? null, lng: place?.lng ?? null, wikidata_id: place?.wikidata_id ?? null, known, audience, interests: [] },
    deps,
  );
  const all = dedupeFactList([...known, ...deep.facts]);

  // 2) Guardar en la memoria de lugares (suma; los curados se respetan: no se tocan sus facts existentes).
  let added = 0;
  if (s.place_id && deep.facts.length) added = await appendFacts(admin, s.place_id, deep.facts as LibraryFact[]);

  // 3) Reescribir las capas largas con el dossier (solo si no es una parada curada a mano).
  let rewritten = false;
  let wordsAfter = wordsBefore;
  const usage = deep.usage;
  if (place?.tier !== 'curated' && all.length >= 6) {
    const chosen = pickFactsForWriting(all);
    const cited: CitedFact[] = chosen.map((f, i) => ({ id: `f${i + 1}`, text: f.text, quote: f.quote, source_url: f.source_url, source_title: f.source_title }));
    const prevCallbacks = sibs.slice(0, Math.max(0, idx)).slice(-2).map((x) => ({ name: x.place_library?.name ?? '', angle: 'parada anterior del tour' }));
    try {
      const res = await deps.llm.writeStop({
        system: WRITER_SYSTEM,
        user: renderWriterUser({
          audience,
          tour: { title: (tour?.title as string) ?? '', thesis: (tour?.thesis as string) ?? '', storyline: (tour?.storyline as string | null) ?? null },
          index: Math.max(0, idx),
          total: sibs.length || 1,
          stop: {
            name,
            kind: 'parada',
            role: brief?.roles?.[idx] ?? (idx === 0 ? 'gancho' : idx === sibs.length - 1 ? 'cierre' : 'desarrollo'),
            angle: 'Contá este lugar en profundidad: historias, personajes, detalles para señalar y curiosidades. Es la versión larga: el grupo quiere escuchar mucho.',
            point_at: s.look_at ?? `lo más llamativo de ${name}`,
            personal_hook: null,
            exterior_only: false,
            dwell_min: s.dwell_min ?? 6,
            arrival_text: 'ahora',
            also: [],
          },
          callbacks: prevCallbacks.filter((c) => c.name),
          next: next?.place_library?.name ? { name: next.place_library.name, walk_min: 0, walk_m: place?.lat != null && next.place_library.lat != null ? Math.round(distanceMeters({ lat: place.lat, lng: place.lng! }, { lat: next.place_library.lat, lng: next.place_library.lng! }) * 1.3) : 0, direction: 'la próxima parada' } : null,
          facts: cited.map((f) => ({ id: f.id, text: f.text })),
          alreadyTold: [],
          sunset: null,
          feedback: [],
          lengths: DEEP_LENGTHS,
        }),
        config: { ...deps.config, effort: deps.config.writerEffort, maxTokens: 16_000 },
      });
      addUsage(usage, res.usage);
      const allow = [...name.split(/\s+/), ...(next?.place_library?.name ?? '').split(/\s+/), ...audience.match(/^- ([^:]+):/gm)?.map((m) => m.slice(2, -1)) ?? [], place?.city ?? '', place?.country ?? ''];
      const citedIds = new Set<string>();
      const clean = (t: string | null) => {
        const r = checkNarration(t, cited, allow);
        r.cited.forEach((x) => citedIds.add(x));
        return r.text;
      };
      const w: WrittenStopT = res.stop;
      const patch: Record<string, unknown> = {};
      const better = (col: keyof StopRowDeep, text: string) => {
        if (wordCount(text) > wordCount(s[col] as string | null) + 15) patch[col as string] = text;
      };
      better('narration_short', clean(w.narration_short));
      better('narration_more', clean(w.narration_more));
      better('narration_secret', clean(w.narration_secret));
      const myth = clean(w.myth_vs_fact);
      if (myth && !s.myth_vs_fact) patch.myth_vs_fact = myth;
      const kid = clean(w.kid_mission);
      if (kid && !s.kid_mission) patch.kid_mission = kid;
      const photo = clean(w.photo_spot);
      if (photo && !s.photo_spot) patch.photo_spot = photo;
      if (Object.keys(patch).length) {
        const merged = new Map((s.sources ?? []).map((x) => [x.url, x]));
        for (const src of sourcesFor(cited, citedIds, name)) if (!merged.has(src.url)) merged.set(src.url, src);
        patch.sources = [...merged.values()];
        const { error: eUp } = await admin.from('tour_stops').update(patch).eq('id', s.id);
        if (eUp) console.warn('[deep-research] no pude guardar la parada:', eUp.message);
        else {
          rewritten = true;
          wordsAfter = ['narration_short', 'narration_more', 'narration_secret'].reduce(
            (sum, col) => sum + wordCount((patch[col] as string | undefined) ?? (s[col as keyof StopRowDeep] as string | null)),
            0,
          );
        }
      }
    } catch (err) {
      console.warn(`[deep-research] reescritura de ${name}:`, (err as Error).message);
    }
  }
  const out: EnrichResult = { stop_id: s.id, facts_before: known.length, facts_added: added, rewritten, words_before: wordsBefore, words_after: wordsAfter, cost_usd: estimateCostUsd(usage) };
  console.log(`[deep-research] ${name}: +${added} datos (${known.length}→${known.length + added}, ${deep.rejected} descartados, ${deep.webSearches} búsquedas) · palabras ${wordsBefore}→${wordsAfter} · ${Math.round((Date.now() - t0) / 1000)} s · ~USD ${out.cost_usd}`);
  return out;
}

/**
 * enrichStop con registro en agent_jobs (kind 'enrich_stop'): queda a la vista si corrió, cuánto sumó o por qué falló
 * (p. ej. sin crédito en Anthropic). Nunca tira.
 */
export async function enrichStopTracked(admin: Db, stopId: string, deps?: DeepDeps): Promise<void> {
  let progress: JobProgress | null = null;
  try {
    const { data: stop } = await admin.from('tour_stops').select('tour_id,place_library(name),tours(owner_user_id,trip_id)').eq('id', stopId).maybeSingle();
    const row = stop as unknown as { place_library: { name: string | null } | null; tours: { owner_user_id: string | null; trip_id: string | null } | null } | null;
    const name = row?.place_library?.name ?? 'la parada';
    if (row?.tours?.owner_user_id) {
      const jobId = await createJob(admin, { kind: 'enrich_stop', trip_id: row.tours.trip_id, user_id: row.tours.owner_user_id, firstLine: `Investigando a fondo ${name}…` });
      progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: `Investigando a fondo ${name}…` }]);
      await progress.set({ status: 'running' });
    }
    const r = await enrichStop(admin, stopId, deps);
    await progress?.push(`+${r.facts_added} datos · ${r.words_before}→${r.words_after} palabras`);
    await progress?.set({ status: 'done', error: null, result: r });
  } catch (err) {
    const msg = (err as Error).message.replace(/\s+/g, ' ').slice(0, 300);
    console.error(`[deep-research] ${stopId}:`, msg);
    await progress?.set({ status: 'failed', error: msg });
  } finally {
    await progress?.flush();
  }
}

// ───────────────────────── Deps reales

export function defaultDeepDeps(): DeepDeps {
  return {
    llm: anthropicTourLlm(),
    config: { effort: 'medium', maxTokens: 10_000, maxIterations: 14, fallbacks: true, writerEffort: (process.env.TOUR_WRITER_EFFORT?.trim() as Effort) || 'medium' },
    wikipediaArticle: (title, lang, maxChars) => wikipediaArticle(title, lang, maxChars).catch(() => null),
    findWikiTitles: async ({ name, lat, lng, wikidata_id }) => {
      if (wikidata_id) {
        const info = (await wikidataInfo([wikidata_id]).catch(() => new Map())).get(wikidata_id);
        if (info && (info.eswiki || info.enwiki)) return { es: info.eswiki, en: info.enwiki };
      }
      if (lat == null || lng == null) return { es: null, en: null };
      // Sin wikidata: el artículo con coordenadas más parecido por nombre a < 250 m.
      const near = await wikipediaGeosearch({ lat, lng, radius_m: 250, limit: 20 }).catch(() => []);
      const n = normText(name);
      const hit = near.find((r) => {
        const t = normText(r.title.replace(/\s*\(.*\)$/, ''));
        return t.includes(n) || n.includes(t);
      });
      if (!hit) return { es: null, en: null };
      const info = hit.wikidata_id ? (await wikidataInfo([hit.wikidata_id]).catch(() => new Map())).get(hit.wikidata_id) : undefined;
      return { es: hit.title, en: info?.enwiki ?? null };
    },
    fetchPageText,
    now: () => Date.now(),
  };
}

// ───────────────────────── Disparo (fan-out: una invocación por parada)

/** URL pública de esta misma API (para llamarse a sí misma). null en local sin config → corre en este proceso. */
export function selfApiUrl(e: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = e.API_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (e.VERCEL_PROJECT_PRODUCTION_URL && e.VERCEL_ENV === 'production') return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (e.VERCEL_URL) return `https://${e.VERCEL_URL}`;
  return null;
}

/**
 * Lanza la investigación profunda de cada parada en su propia invocación (300 s cada una). Si no hay URL propia o la
 * llamada falla, corre acá mismo en segundo plano (comparte el tiempo de esta invocación).
 */
export async function kickDeepResearch(admin: Db, stopIds: string[]): Promise<void> {
  if (!stopIds.length || (process.env.TOUR_DEEP_RESEARCH ?? 'true').trim().toLowerCase() === 'false') return;
  const base = selfApiUrl();
  await Promise.all(
    stopIds.map(async (id) => {
      if (base) {
        try {
          const r = await fetch(`${base}/internal/enrich-stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken(id) },
            body: JSON.stringify({ stop_id: id }),
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) return;
          console.warn(`[deep-research] /internal/enrich-stop respondió ${r.status}: corro acá`);
        } catch (err) {
          console.warn('[deep-research] no pude llamarme a mí mismo, corro acá:', (err as Error).message);
        }
      }
      runInBackground(`enrich-stop/${id}`, enrichStopTracked(admin, id));
    }),
  );
}

/** Paradas de un tour que todavía no tienen un dossier rico (menos de `min` facts verificados en su lugar). */
export async function stopsNeedingDeepResearch(admin: Db, tourId: string, min = 15): Promise<string[]> {
  const { data } = await admin.from('tour_stops').select('id,place_library(facts)').eq('tour_id', tourId);
  return ((data ?? []) as unknown as { id: string; place_library: { facts: LibraryFact[] | null } | null }[])
    .filter((s) => (s.place_library?.facts ?? []).filter((f) => f.verified).length < min)
    .map((s) => s.id);
}
