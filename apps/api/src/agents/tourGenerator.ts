// Generador de tours (PRD 06 + 18): POST /tools/generate_tour → job en agent_jobs.
// 1) Setup síncrono (≤1s): crea `tours` (status='generating') + `agent_jobs`, responde {job_id, tour_id}.
// 2) Candidatos (place_library + Google/OSM + Wikipedia + Overpass) → dedupe → score → filtro → ruta.
// 3) Investigación (pasada 1) + Verificación (pasada 2, con 1 reintento de fuente alternativa).
// 4) Generación de paradas (pasada 3) + chequeo automático de años/cifras/nombres contra facts verificados.
// 5) Escritura: upsert place_library (nunca pisa curated), insert tour_stops, tours.status='ready'.
import { randomUUID } from 'node:crypto';
import {
  affinityScore,
  combineInterestWeights,
  distanceMeters,
  interestsForGoogleTypes,
  type GenerateTourResult,
  type InterestTag,
  type ToolInput,
} from '@build101/shared';
import { dbError, notFound } from '../errors';
import { insertFeed } from '../feed';
import { overpassCandidates } from '../google/overpass';
import { searchPlaces } from '../google/places';
import { computeRoute } from '../google/routes';
import { wikidataSitelinkCount, wikipediaGeosearch } from '../google/wikipedia';
import { createJob, JobProgress } from '../jobs';
import type { Db } from '../supabase';
import type { ToolCtx } from '../tools/types';
import { JobError } from './llm';
import { addUsage, emptyUsage, estimateCostUsd, type Usage } from './schemas';
import { anthropicTourLlm, type TourLLM, type TourLlmConfig } from './tourLlm';
import { ALT_SOURCE_SYSTEM, GENERATE_SYSTEM, RESEARCH_SYSTEM, VERIFY_SYSTEM, renderAltSourceUser, renderGenerateUser, renderResearchUser, renderVerifyUser } from './tourPrompts';

// ───────────────────────── Candidatos (puro, testeable sin red)

export type Fact = { text: string; source_url: string; verified: boolean };

export type RawCandidate = {
  source: 'place_library' | 'google' | 'osm' | 'wikipedia';
  place_library_id?: string;
  google_place_id?: string | null;
  osm_id?: string | null;
  wikidata_id?: string | null;
  name: string;
  lat: number;
  lng: number;
  interests: InterestTag[];
  /** Señal cruda de notoriedad (userRatingCount, sitelinks, 0 si no hay dato). */
  notability: number;
  tier?: 'curated' | 'researched';
  wheelchair?: 'yes' | 'no' | 'limited' | null;
  category_hint?: string; // para el filtro de avoid (ej. "museum")
  facts: Fact[];
};

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function trigrams(s: string): Set<string> {
  const n = `  ${normalizeName(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < n.length - 2; i++) out.add(n.slice(i, i + 3));
  return out;
}

/** Similitud de nombre (coeficiente de Dice sobre trigramas), 0-1. */
export function nameSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const SOURCE_RANK: Record<RawCandidate['source'], number> = { place_library: 3, google: 2, osm: 1, wikipedia: 0 };

/** Dedupe: mismo wikidata_id/google_place_id, o ≤40m + nombres similares (trigram ≥0.5). Fusiona lo más rico. */
export function dedupeCandidates(cands: RawCandidate[]): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const c of cands) {
    const dupIdx = out.findIndex(
      (o) =>
        (c.wikidata_id && o.wikidata_id && c.wikidata_id === o.wikidata_id) ||
        (c.google_place_id && o.google_place_id && c.google_place_id === o.google_place_id) ||
        (distanceMeters(c, o) <= 40 && nameSimilarity(c.name, o.name) >= 0.5),
    );
    if (dupIdx === -1) {
      out.push({ ...c, interests: [...c.interests] });
      continue;
    }
    const o = out[dupIdx];
    const keep = SOURCE_RANK[c.source] > SOURCE_RANK[o.source] ? c : o;
    const other = keep === c ? o : c;
    out[dupIdx] = {
      ...keep,
      wikidata_id: keep.wikidata_id ?? other.wikidata_id,
      google_place_id: keep.google_place_id ?? other.google_place_id,
      osm_id: keep.osm_id ?? other.osm_id,
      interests: [...new Set([...keep.interests, ...other.interests])],
      notability: Math.max(keep.notability, other.notability),
      wheelchair: keep.wheelchair ?? other.wheelchair,
      facts: keep.facts.length ? keep.facts : other.facts,
    };
  }
  return out;
}

/** Afinidad × notoriedad (log, 0-1) × bonus 1.5 si curated. */
export function scoreCandidate(c: RawCandidate, weights: Record<string, number>): number {
  const affinity = affinityScore(c.interests, weights);
  const notability = Math.min(1, Math.log10(1 + Math.max(0, c.notability)) / 3) || 0.15;
  const curatedBonus = c.tier === 'curated' ? 1.5 : 1;
  return affinity * notability * curatedBonus;
}

export type FilterOpts = { avoid: string[]; stepFree: boolean };

/** Descarta por `avoid` (match simple en nombre/categoría) y accesibilidad (wheelchair=no si step_free). */
export function filterCandidates(cands: RawCandidate[], opts: FilterOpts): RawCandidate[] {
  const avoid = opts.avoid.map(normalizeName).filter(Boolean);
  return cands.filter((c) => {
    if (opts.stepFree && c.wheelchair === 'no') return false;
    if (!avoid.length) return true;
    const haystack = normalizeName(`${c.name} ${c.category_hint ?? ''}`);
    return !avoid.some((a) => haystack.includes(a));
  });
}

export function clampStopCount(durationMin: number): number {
  return Math.min(12, Math.max(3, Math.round(durationMin / 8)));
}

export function pickTopCandidates(cands: RawCandidate[], weights: Record<string, number>, n: number): RawCandidate[] {
  return cands
    .map((c) => ({ c, score: scoreCandidate(c, weights) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.c);
}

// ───────────────────────── Ruta (puro, vecino más cercano + 2-opt sobre distancia en línea recta)

/** Orden de índices: arranca en 0; si `endIndex` viene, termina ahí. Optimiza distancia total (aprox). */
export function orderStops(points: { lat: number; lng: number }[], endIndex?: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const dist = (i: number, j: number) => distanceMeters(points[i], points[j]);
  const visited = new Array<boolean>(n).fill(false);
  const order = [0];
  visited[0] = true;
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      if (endIndex === j && order.length < n - 1) continue; // reservar el final para el último paso
      const d = dist(last, j);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best === -1) best = [...visited.keys()].find((j) => !visited[j])!;
    order.push(best);
    visited[best] = true;
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 2; i++) {
      for (let k = i + 1; k < n - 1; k++) {
        const [a, b, c, d] = [order[i - 1], order[i], order[k], order[k + 1]];
        if (dist(a, c) + dist(b, d) + 1e-6 < dist(a, b) + dist(c, d)) {
          const seg = order.slice(i, k + 1).reverse();
          order.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return order;
}

// ───────────────────────── Chequeo automático (paso 8: años/cifras/nombres propios respaldados)

const YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/g;
const NUMBER_RE = /\b\d[\d.,]*\b/g;

/** Candidatos a "dato duro" de una narración: años, números, palabras capitalizadas (nombres propios aprox). */
export function extractClaims(text: string): string[] {
  const years: string[] = text.match(YEAR_RE) ?? [];
  const numbers = (text.match(NUMBER_RE) ?? []).filter((n) => !years.includes(n));
  const words = text.split(/\s+/);
  const properNouns: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/^[("'¿¡]+|[.,;:!?()"'…]+$/g, '');
    if (w.length > 2 && /^[A-ZÁÉÍÓÚÑ]/.test(w) && w !== w.toUpperCase()) properNouns.push(w);
  }
  return [...new Set([...years, ...numbers, ...properNouns])];
}

/** true si TODO claim aparece textual en algún fact verificado. */
export function claimsSupported(claims: string[], facts: Fact[]): boolean {
  const verifiedText = facts
    .filter((f) => f.verified)
    .map((f) => f.text)
    .join(' \n ');
  return claims.every((claim) => verifiedText.includes(claim));
}

// ───────────────────────── Deps (inyectables para tests)

export type TourDeps = {
  llm: TourLLM;
  config: TourLlmConfig;
  now: () => Date;
  nearbyPlaceLibrary: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  searchGoogleOrOsm: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  searchWikipedia: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  searchOverpass: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  computeWalk: (stops: { lat: number; lng: number }[]) => Promise<{ total_min: number; total_m: number; polyline: string | null }>;
  heartbeatMs?: number;
};

function placeLibraryRowToCandidate(row: {
  id: string;
  google_place_id: string | null;
  osm_id: string | null;
  wikidata_id: string | null;
  name: string;
  lat: number;
  lng: number;
  tier: string | null;
  facts: unknown;
}): RawCandidate {
  const facts = Array.isArray(row.facts) ? (row.facts as Fact[]) : [];
  return {
    source: 'place_library',
    place_library_id: row.id,
    google_place_id: row.google_place_id,
    osm_id: row.osm_id,
    wikidata_id: row.wikidata_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    interests: [],
    notability: facts.filter((f) => f.verified).length * 2,
    tier: (row.tier as 'curated' | 'researched' | null) ?? undefined,
    facts,
  };
}

export function defaultDeps(admin: Db): TourDeps {
  return {
    llm: anthropicTourLlm(),
    config: { effort: 'medium', maxTokens: 8000, maxIterations: 10, fallbacks: true },
    now: () => new Date(),
    nearbyPlaceLibrary: async ({ lat, lng, radius_m }) => {
      const { data, error } = await admin.rpc('nearby_place_library', { center_lat: lat, center_lng: lng, radius_m });
      if (error) {
        console.warn('[tourGenerator] nearby_place_library (¿falta aplicar la migración?):', error.message);
        return [];
      }
      return ((data ?? []) as unknown as Parameters<typeof placeLibraryRowToCandidate>[0][]).map(placeLibraryRowToCandidate);
    },
    searchGoogleOrOsm: async ({ lat, lng, radius_m }) => {
      const types = ['tourist_attraction', 'historical_landmark', 'museum', 'church', 'park'];
      const results = await Promise.all(
        types.map((query) => searchPlaces({ query, near: { lat, lng }, radius_m, max_results: 10 }).catch(() => [])),
      );
      return results.flat().map((p) => ({
        source: p.google_place_id.startsWith('osm:') ? 'osm' : 'google',
        google_place_id: p.google_place_id.startsWith('osm:') ? null : p.google_place_id,
        osm_id: p.google_place_id.startsWith('osm:') ? p.google_place_id.slice(4) : null,
        wikidata_id: null,
        name: p.name,
        lat: p.lat ?? lat,
        lng: p.lng ?? lng,
        interests: interestsForGoogleTypes(p.types),
        notability: p.rating ? p.rating * 20 : 0,
        wheelchair: null,
        category_hint: p.types.join(' '),
        facts: [],
      }));
    },
    searchWikipedia: async ({ lat, lng, radius_m }) => {
      const res = await wikipediaGeosearch({ lat, lng, radius_m, limit: 30 }).catch(() => []);
      const withNotability = await Promise.all(
        res.map(async (r) => ({ r, notability: r.wikidata_id ? await wikidataSitelinkCount(r.wikidata_id).catch(() => 0) : 0 })),
      );
      return withNotability.map(({ r, notability }) => ({
        source: 'wikipedia' as const,
        google_place_id: null,
        osm_id: null,
        wikidata_id: r.wikidata_id,
        name: r.title,
        lat: r.lat,
        lng: r.lng,
        interests: [],
        notability,
        wheelchair: null,
        facts: [],
      }));
    },
    searchOverpass: async ({ lat, lng, radius_m }) => {
      const res = await overpassCandidates({ lat, lng, radius_m }).catch(() => []);
      return res.map((o) => ({
        source: 'osm' as const,
        google_place_id: null,
        osm_id: o.osm_id,
        wikidata_id: null,
        name: o.name,
        lat: o.lat,
        lng: o.lng,
        interests: o.interests,
        notability: 0,
        wheelchair: o.wheelchair,
        category_hint: Object.entries(o.tags).map(([k, v]) => `${k}=${v}`).join(' '),
        facts: [],
      }));
    },
    computeWalk: async (stops) => {
      if (stops.length < 2) return { total_min: 0, total_m: 0, polyline: null };
      const r = await computeRoute(stops, 'walk');
      return {
        total_min: r.total_min,
        total_m: r.segments.reduce((s, seg) => s + seg.distance_m, 0),
        polyline: r.segments[0]?.polyline ?? null,
      };
    },
  };
}

// ───────────────────────── Setup (síncrono)

export type TourStart = { job_id: string; tour_id: string; run: () => Promise<void> };

type BlockCtx = { trip_id: string; leg_id: string; participant_ids: string[]; start_at: string | null } | null;

async function loadBlockContext(admin: ToolCtx['admin'], blockId: string): Promise<BlockCtx> {
  const { data: block, error } = await admin.from('blocks').select('trip_id,leg_id,start_time').eq('id', blockId).maybeSingle();
  if (error) throw dbError(error, 'blocks');
  if (!block) throw notFound('No encontré ese bloque.');
  const { data: participants } = await admin.from('block_participants').select('user_id').eq('block_id', blockId);
  return {
    trip_id: block.trip_id as string,
    leg_id: block.leg_id as string,
    participant_ids: (participants ?? []).map((p) => p.user_id as string),
    start_at: (block.start_time as string | null) ?? null,
  };
}

export async function startGenerateTour(input: ToolInput<'generate_tour'>, ctx: ToolCtx, deps?: Partial<TourDeps>): Promise<TourStart> {
  const { admin, userId } = ctx;
  const block = input.block_id ? await loadBlockContext(admin, input.block_id) : null;
  const tripId = input.trip_id ?? block?.trip_id ?? null;
  const participantIds = input.participant_ids ?? block?.participant_ids ?? [userId];

  const { data: tour, error } = await admin
    .from('tours')
    .insert({
      trip_id: tripId,
      block_id: input.block_id ?? null,
      owner_user_id: userId,
      mode: input.mode,
      title: null,
      persona_id: null, // Pivot de hoy (DECISIONES-SABADO.md): un solo personaje (Scout), sin personas por ciudad.
      storyline: null,
      duration_min: input.duration_min,
      start_lat: input.start_lat,
      start_lng: input.start_lng,
      end_point: input.end_point ?? null,
      status: 'generating',
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'tours');
  const tourId = tour.id as string;

  const firstLine = 'Buscando lugares cerca…';
  const jobId = await createJob(admin, { kind: 'generate_tour', trip_id: tripId, user_id: userId, firstLine });

  return {
    job_id: jobId,
    tour_id: tourId,
    run: () =>
      runGenerateTour(
        { jobId, tourId, tripId, input, participantIds, startAt: input.start_at ?? block?.start_at ?? null, ctx, firstLine },
        { ...defaultDepsLazy(admin), ...deps },
      ),
  };
}

function defaultDepsLazy(admin: ToolCtx['admin']): TourDeps {
  let d: TourDeps | null = null;
  const get = () => (d ??= defaultDeps(admin));
  return {
    get llm() {
      return get().llm;
    },
    get config() {
      return get().config;
    },
    now: () => get().now(),
    nearbyPlaceLibrary: (a) => get().nearbyPlaceLibrary(a),
    searchGoogleOrOsm: (a) => get().searchGoogleOrOsm(a),
    searchWikipedia: (a) => get().searchWikipedia(a),
    searchOverpass: (a) => get().searchOverpass(a),
    computeWalk: (s) => get().computeWalk(s),
  };
}

// ───────────────────────── Job (en segundo plano)

type RunArgs = {
  jobId: string;
  tourId: string;
  tripId: string | null;
  input: ToolInput<'generate_tour'>;
  participantIds: string[];
  startAt: string | null;
  ctx: ToolCtx;
  firstLine: string;
};

function readable(err: unknown): string {
  if (err instanceof JobError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 300);
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runGenerateTour(args: RunArgs, deps: TourDeps): Promise<void> {
  const { jobId, tourId, tripId, input, ctx } = args;
  const { admin } = ctx;
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: args.firstLine }]);
  const usage: Usage = emptyUsage();
  const stats = { web_search_calls: 0, places_reused: 0, places_new: 0, facts_verified: 0, facts_rejected: 0 };
  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => 'Sigo buscando y verificando…', deps.heartbeatMs ?? 10_000);

  let fatal: string | null = null;
  let stopCount = 0;
  let totalWalkM = 0;
  let estDurationMin = 0;

  try {
    // ── Contexto: perfiles combinados (intereses, avoid, step_free)
    const { data: profiles } = args.participantIds.length
      ? await admin.from('profiles').select('interests,avoid,mobility').in('id', args.participantIds)
      : { data: [] };
    const weights = combineInterestWeights((profiles ?? []).map((p) => p.interests as Record<string, number> | null));
    const avoid = [...new Set((profiles ?? []).flatMap((p) => (p.avoid as string[] | null) ?? []))];
    const stepFree = (profiles ?? []).some((p) => (p.mobility as { step_free?: boolean } | null)?.step_free);

    // ── Candidatos en paralelo
    const radius = input.radius_m ?? Math.min(1200, input.duration_min * 20);
    void progress.push('Buscando lugares con historia cerca…');
    const [lib, goog, wiki, osm] = await Promise.all([
      deps.nearbyPlaceLibrary({ lat: input.start_lat, lng: input.start_lng, radius_m: radius }),
      deps.searchGoogleOrOsm({ lat: input.start_lat, lng: input.start_lng, radius_m: radius }),
      deps.searchWikipedia({ lat: input.start_lat, lng: input.start_lng, radius_m: radius }),
      deps.searchOverpass({ lat: input.start_lat, lng: input.start_lng, radius_m: radius }),
    ]);
    stats.places_reused = lib.length;
    const deduped = dedupeCandidates([...lib, ...goog, ...wiki, ...osm]);
    const filtered = filterCandidates(deduped, { avoid, stepFree });
    if (filtered.length < 3) {
      throw new JobError('not_enough_candidates', 'No encontramos suficientes lugares con historia acá (mínimo 3). Probá con más tiempo o moviéndote un poco.');
    }
    const n = input.mode === 'explorer' ? Math.min(20, filtered.length) : clampStopCount(input.duration_min);
    const picked = pickTopCandidates(filtered, weights, n);
    void progress.push(`Encontré ${picked.length} lugares candidatos`);

    // ── Orden (planned/spontaneous: ruta; explorer: por score, ya viene ordenado)
    let ordered = picked;
    if (input.mode !== 'explorer') {
      const points = picked.map((c) => ({ lat: c.lat, lng: c.lng }));
      const endIdx = input.end_point ? points.length : undefined; // si hay end_point, se agrega como punto final abajo
      const pts = input.end_point ? [...points, { lat: input.end_point.lat, lng: input.end_point.lng }] : points;
      const order = orderStops(pts, endIdx);
      ordered = order.filter((i) => i < picked.length).map((i) => picked[i]);
      const walk = await deps.computeWalk(ordered.map((c) => ({ lat: c.lat, lng: c.lng })));
      totalWalkM = walk.total_m;
      const dwellTotal = ordered.length * 4;
      estDurationMin = walk.total_min + dwellTotal;
      // Si nos pasamos de tiempo, sacamos la de menor score hasta entrar (PRD paso 4).
      while (estDurationMin > input.duration_min * 1.1 && ordered.length > 3) {
        const worst = ordered.reduce((w, c, i) => (scoreCandidate(c, weights) < scoreCandidate(ordered[w], weights) ? i : w), 0);
        ordered.splice(worst, 1);
        const w2 = await deps.computeWalk(ordered.map((c) => ({ lat: c.lat, lng: c.lng })));
        totalWalkM = w2.total_m;
        estDurationMin = w2.total_min + ordered.length * 4;
      }
    }
    stopCount = ordered.length;

    // ── Investigación + verificación (hasta 4 lugares en paralelo, solo los que no tienen ≥4 facts verificados)
    void progress.push('Investigando y verificando datos…');
    const enriched = await pool(ordered, 4, async (c) => {
      let facts = c.facts.filter((f) => f.verified);
      if (facts.length >= 4) return { ...c, facts: c.facts };
      const research = await deps.llm.research({
        system: RESEARCH_SYSTEM,
        user: renderResearchUser({ name: c.name, city: '', country: '', lat: c.lat, lng: c.lng, hints: c.interests }),
        config: deps.config,
      });
      addUsage(usage, research.usage as never);
      stats.web_search_calls += research.web_search_calls;
      const verified: Fact[] = [];
      for (const f of research.facts) {
        const v1 = await deps.llm.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(f), config: deps.config });
        addUsage(usage, v1.usage as never);
        if (v1.result?.supported && v1.result.quote.trim()) {
          verified.push({ text: f.text, source_url: f.source_url, verified: true });
          continue;
        }
        const alt = await deps.llm.findAlternateSource({ system: ALT_SOURCE_SYSTEM, user: renderAltSourceUser(f), config: deps.config });
        addUsage(usage, alt.usage as never);
        stats.web_search_calls += alt.web_search_calls;
        if (alt.source_url) {
          const v2 = await deps.llm.verifyFact({
            system: VERIFY_SYSTEM,
            user: renderVerifyUser({ text: f.text, source_url: alt.source_url }),
            config: deps.config,
          });
          addUsage(usage, v2.usage as never);
          if (v2.result?.supported && v2.result.quote.trim()) {
            verified.push({ text: f.text, source_url: alt.source_url, verified: true });
            continue;
          }
        }
        stats.facts_rejected++;
      }
      stats.facts_verified += verified.length;
      if (!c.place_library_id) stats.places_new++;
      return { ...c, facts: [...c.facts, ...verified] };
    });
    const withFacts = enriched.map((r, i) => (r.status === 'fulfilled' ? r.value : { ...ordered[i], facts: ordered[i].facts }));
    void progress.push(`Verifiqué ${stats.facts_verified} datos`);

    // ── Generación (una sola llamada, effort high)
    void progress.push('Armando la ruta y escribiendo las paradas…');
    const places = withFacts.map((c, i) => ({ key: `stop_${i + 1}`, name: c.name, facts: c.facts.filter((f) => f.verified) }));
    const gen = await deps.llm.generateStops({
      system: GENERATE_SYSTEM,
      user: renderGenerateUser({ places, storyline: input.storyline, language: input.language }),
      config: { ...deps.config, effort: 'high' },
    });
    addUsage(usage, gen.usage as never);
    const byKey = new Map(gen.stops.stops.map((s) => [s.place_key, s]));

    // ── Chequeo automático + escritura (transacción manual: upsert place_library → insert tour_stops)
    const stopRows: Record<string, unknown>[] = [];
    for (let i = 0; i < withFacts.length; i++) {
      const c = withFacts[i];
      const key = `stop_${i + 1}`;
      let gs = byKey.get(key);
      if (!gs) continue; // Claude no devolvió esta parada: se omite (mejor menos paradas que una vacía)
      const verifiedFacts = c.facts.filter((f) => f.verified);
      const narrations = [gs.narration_short, gs.narration_more, gs.narration_secret, gs.myth_vs_fact ?? ''];
      const claims = narrations.flatMap(extractClaims);
      if (!claimsSupported(claims, verifiedFacts)) {
        // 1 reintento puntual: pedimos de nuevo solo esta parada, más estricta.
        const retry = await deps.llm.generateStops({
          system: GENERATE_SYSTEM,
          user: renderGenerateUser({ places: [{ key, name: c.name, facts: verifiedFacts }], storyline: false, language: input.language }),
          config: { ...deps.config, effort: 'high' },
        });
        addUsage(usage, retry.usage as never);
        const retried = retry.stops.stops[0];
        const claims2 = retried ? [retried.narration_short, retried.narration_more, retried.narration_secret].flatMap(extractClaims) : [];
        gs = retried && claimsSupported(claims2, verifiedFacts) ? retried : { ...gs, myth_vs_fact: null }; // último recurso: se borra lo no respaldable más chico (mito/realidad)
      }

      // place_library: upsert (nunca pisa curated)
      let placeId = c.place_library_id ?? null;
      if (!placeId) {
        const { data: existing } = c.google_place_id
          ? await admin.from('place_library').select('id,tier').eq('google_place_id', c.google_place_id).maybeSingle()
          : c.wikidata_id
            ? await admin.from('place_library').select('id,tier').eq('wikidata_id', c.wikidata_id).maybeSingle()
            : c.osm_id
              ? await admin.from('place_library').select('id,tier').eq('osm_id', c.osm_id).maybeSingle()
              : { data: null };
        if (existing) {
          placeId = existing.id as string;
          if (existing.tier !== 'curated') {
            await admin.from('place_library').update({ facts: verifiedFacts, updated_at: new Date().toISOString() }).eq('id', placeId);
          }
        } else {
          const { data: inserted, error: eIns } = await admin
            .from('place_library')
            .insert({
              google_place_id: c.google_place_id ?? null,
              osm_id: c.osm_id ?? null,
              wikidata_id: c.wikidata_id ?? null,
              name: c.name,
              lat: c.lat,
              lng: c.lng,
              city: null,
              country: null,
              tier: 'researched',
              facts: verifiedFacts,
              base_lang: input.language,
            })
            .select('id')
            .single();
          if (eIns) throw dbError(eIns, 'place_library');
          placeId = inserted.id as string;
        }
      }

      stopRows.push({
        id: randomUUID(),
        tour_id: tourId,
        place_id: placeId,
        sort_order: i,
        geofence_radius_m: 35,
        look_at: gs.look_at,
        narration_short: gs.narration_short,
        narration_more: gs.narration_more,
        narration_secret: gs.narration_secret,
        myth_vs_fact: gs.myth_vs_fact,
        photo_spot: gs.photo_spot,
        kid_mission: gs.kid_mission,
        transition_to_next: i < withFacts.length - 1 ? gs.transition_to_next : null,
        nav_to_next: i < withFacts.length - 1 ? gs.nav_to_next : null,
        sources: [...new Map(verifiedFacts.map((f) => [f.source_url, { title: c.name, url: f.source_url }])).values()],
      });
    }

    if (stopRows.length < 3) {
      throw new JobError('generate_failed', 'No llegamos a armar suficientes paradas con datos verificados.');
    }
    const { error: eStops } = await admin.from('tour_stops').insert(stopRows);
    if (eStops) throw dbError(eStops, 'tour_stops');

    await admin
      .from('tours')
      .update({
        title: `Tour ${ordered.length} paradas`,
        storyline: input.storyline ? gen.stops.storyline : null,
        status: 'ready',
        route: { polyline: null, total_walk_m: Math.round(totalWalkM), est_duration_min: Math.round(estDurationMin) },
      })
      .eq('id', tourId);

    if (tripId) {
      await insertFeed(ctx, {
        trip_id: tripId,
        kind: 'tour_generated',
        payload: { summary: `El Scout armó un tour con ${stopRows.length} paradas`, tour_id: tourId },
        undoable: false,
      });
    }
    stopCount = stopRows.length;
  } catch (err) {
    console.error(`[generate_tour/${jobId}]`, err);
    fatal = readable(err);
  } finally {
    progress.stopHeartbeat();
  }

  const result: GenerateTourResult = {
    tour_id: tourId,
    stop_count: stopCount,
    total_walk_m: Math.round(totalWalkM),
    est_duration_min: Math.round(estDurationMin),
    stats,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
  };
  console.log(`[generate_tour/${jobId}] fin · ${stopCount} paradas · usage ${JSON.stringify(usage)} · ~USD ${estimateCostUsd(usage)}`);
  if (fatal) {
    await admin.from('tours').update({ status: 'failed' }).eq('id', tourId);
    await progress.push(`Se trancó: ${fatal}`);
    await progress.set({ status: 'failed', error: fatal, result });
  } else {
    await progress.push(`¡Listo! ${stopCount} paradas`);
    await progress.set({ status: 'done', error: null, result });
  }
  await progress.flush();
}
