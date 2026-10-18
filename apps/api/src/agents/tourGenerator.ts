// Generador de tours (PRD 06 + 18 · "tour director"): POST /tools/generate_tour → job en agent_jobs.
// 1) Setup síncrono (≤1s): crea `tours` (status='generating') + `agent_jobs`, responde {job_id, tour_id}.
// 2) Brief: TODO el contexto del grupo y del momento (tourContext.ts).
// 3) Candidatos (place_library + Google + Wikipedia + Overpass) → dedupe → puntaje para el grupo → ruta con
//    ventanas horarias, diversidad y presupuesto de tiempo (tourRoute.ts).
// 4) Director: tesis, título, swaps y papel de cada parada en el arco. En paralelo arranca la investigación.
// 5) Investigación por parada: Wikipedia primero (texto completo → datos con cita textual chequeada en código),
//    web si falta; un juez por lugar confirma que cada cita respalda su dato.
// 6) Escritores: una llamada por parada, en paralelo, con citas [fN] → chequeo determinístico (tourCheck.ts):
//    una oración con un dato duro sin respaldo se borra. 7) Crítico con rúbrica → reescribe las flojas.
// 8) Escritura: upsert place_library (nunca pisa curated), insert tour_stops, tours.status='ready'.
// composeTour (pasos 3-7) no toca la base: lo usa también scripts/try-tour.ts.
import { randomUUID } from 'node:crypto';
import {
  distanceMeters,
  interestsForGoogleTypes,
  interestsForName,
  type GenerateTourResult,
  type InterestTag,
  type ToolInput,
} from '@build101/shared';
import { dbError, notFound } from '../errors';
import { insertFeed } from '../feed';
import { tourWeather } from '../google/openMeteo';
import { reverseGeocode } from '../google/osm';
import { overpassCandidates } from '../google/overpass';
import { fetchPageText } from '../google/pageText';
import { searchPlaces, searchPlacesRich, type OpeningPeriod } from '../google/places';
import { computeRoute, mergePolylines } from '../google/routes';
import { wikidataInfo, wikipediaArticle, wikipediaGeosearch, wikipediaIntros, type WikiArticle, type WikidataInfo } from '../google/wikipedia';
import { createJob, JobProgress } from '../jobs';
import { appendFacts, type LibraryFact } from '../places/library';
import type { Db } from '../supabase';
import type { ToolCtx } from '../tools/types';
import { runEventsSearch } from './eventsSearch';
import { kickDeepResearch } from './tourDeepResearch';
import { type Effort, JobError } from './llm';
import { addUsage, emptyUsage, estimateCostUsd, type Usage } from './schemas';
import { checkNarration, quoteInText, sourcesFor, stripCitations, wordCount, type CitedFact } from './tourCheck';
import { briefContextBullets, contextProperNouns, groupProfile, loadTourBrief, renderBriefCard, type BriefDeps, type GroupProfile, type TourAnswers, type TourBrief } from './tourContext';
import { anthropicTourLlm, type TourLLM, type TourLlmConfig } from './tourLlm';
import {
  CRITIC_SYSTEM,
  DIRECTOR_SYSTEM,
  EXTRACT_SYSTEM,
  JUDGE_SYSTEM,
  RESEARCH_SYSTEM,
  VERIFY_SYSTEM,
  WRITER_SYSTEM,
  renderCriticUser,
  renderDirectorUser,
  renderExtractUser,
  renderJudgeUser,
  renderResearchUser,
  renderVerifyUser,
  renderWriterUser,
} from './tourPrompts';
import {
  cardinal,
  dwellFor,
  exteriorOk,
  geofenceFor,
  normalizeNotability,
  openAtFn,
  placeKind,
  planRoute,
  scoreForGroup,
  targetStops,
  walkKmh,
  type PlaceKind,
  type RouteCandidate,
  type RoutePlan,
} from './tourRoute';
import type { DirectorOutputT, WrittenStopT } from './tourSchemas';

// ───────────────────────── Candidatos (puro, testeable sin red)

/** place_library.facts[] (LibraryFact, memoria de lugares) + campos del tour director (kind, source_title). */
export type Fact = {
  text: string;
  source_url: string;
  verified: boolean;
  quote?: string;
  verified_at?: string;
  origin?: LibraryFact['origin'];
  kind?: string | null;
  source_title?: string | null;
};

export type RawCandidate = {
  source: 'place_library' | 'google' | 'osm' | 'wikipedia' | 'event';
  place_library_id?: string;
  google_place_id?: string | null;
  osm_id?: string | null;
  wikidata_id?: string | null;
  wiki_title?: string | null;
  wiki_lang?: string | null;
  name: string;
  lat: number;
  lng: number;
  interests: InterestTag[];
  google_types?: string[];
  rating_count?: number | null;
  sitelinks?: number | null;
  tier?: 'curated' | 'researched';
  wheelchair?: 'yes' | 'no' | 'limited' | null;
  category_hint?: string; // tags OSM "k=v" / tipos de Google, para el tipo de parada y el filtro de avoid
  periods?: OpeningPeriod[] | null;
  summary?: string | null;
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

const SOURCE_RANK: Record<RawCandidate['source'], number> = { place_library: 3, event: 2, google: 2, osm: 1, wikipedia: 0 };

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
      wiki_title: keep.wiki_title ?? other.wiki_title,
      wiki_lang: keep.wiki_lang ?? other.wiki_lang,
      google_place_id: keep.google_place_id ?? other.google_place_id,
      osm_id: keep.osm_id ?? other.osm_id,
      interests: [...new Set([...keep.interests, ...other.interests])],
      google_types: keep.google_types?.length ? keep.google_types : other.google_types,
      rating_count: Math.max(keep.rating_count ?? 0, other.rating_count ?? 0) || null,
      sitelinks: Math.max(keep.sitelinks ?? 0, other.sitelinks ?? 0) || null,
      wheelchair: keep.wheelchair ?? other.wheelchair,
      category_hint: [keep.category_hint, other.category_hint].filter(Boolean).join(' ') || undefined,
      periods: keep.periods ?? other.periods,
      summary: keep.summary ?? other.summary,
      facts: keep.facts.length ? keep.facts : other.facts,
    };
  }
  return out;
}

/** Lugares que no son paradas de tour (aparecen por búsquedas de texto o tags genéricos). */
const JUNK_NAME = /\b(parking|estacionamiento|garage|garaje|hotel|hostel|apart|banco|bank|cajero|atm|farmacia|pharmacy|supermercado|minimercado|autoservice|kiosco|ferreter[ií]a|lavadero|gimnasio|gym|oficina|office|consultorio|cl[ií]nica|sanatorio|escuela|colegio|liceo|parada|bus stop|terminal|shopping|local \d+)\b/i;
const JUNK_TAG = /amenity=(parking|bank|atm|pharmacy|fuel|bus_station|school|clinic|hospital)|tourism=(hotel|hostel|guest_house|apartment)|\b(parking|lodging|bank|atm|pharmacy|supermarket|gas_station|bus_station|school|hospital)\b/;

export function isJunkCandidate(c: Pick<RawCandidate, 'name' | 'category_hint'>): boolean {
  return JUNK_NAME.test(c.name) || JUNK_TAG.test(c.category_hint ?? '');
}

export type FilterOpts = { avoid: string[]; stepFree: boolean };

const AVOID_MUSEUM = /\bmuseo|museum/;

/**
 * Descarta por `avoid` (match en nombre/categoría) y accesibilidad (wheelchair=no si step_free).
 * Excepción del PRD: si evitan museos, un museo puede quedar como parada exterior (fachada): `exteriorOnly`.
 */
export function filterCandidates(cands: RawCandidate[], opts: FilterOpts): (RawCandidate & { exteriorOnly?: boolean })[] {
  const avoid = opts.avoid.map(normalizeName).filter(Boolean);
  const out: (RawCandidate & { exteriorOnly?: boolean })[] = [];
  for (const c of cands) {
    if (isJunkCandidate(c)) continue;
    if (opts.stepFree && c.wheelchair === 'no') continue;
    if (!avoid.length) {
      out.push(c);
      continue;
    }
    const haystack = normalizeName(`${c.name} ${c.category_hint ?? ''}`);
    const hits = avoid.filter((a) => haystack.includes(a) || (a.length > 4 && haystack.includes(a.slice(0, -1))));
    if (!hits.length) out.push(c);
    else if (hits.every((a) => AVOID_MUSEUM.test(a)) && placeKind(c) === 'museum') out.push({ ...c, exteriorOnly: true });
  }
  return out;
}

/** Busca en los candidatos los lugares que la persona pidió por nombre. Devuelve los nombres sin match. */
export function matchMustInclude(cands: RawCandidate[], names: string[]): { keys: Set<number>; missing: string[] } {
  const keys = new Set<number>();
  const missing: string[] = [];
  for (const name of names) {
    const n = normalizeName(name);
    let best = -1;
    let bestSim = 0;
    cands.forEach((c, i) => {
      const cn = normalizeName(c.name);
      const sim = cn.includes(n) || n.includes(cn) ? 1 : nameSimilarity(c.name, name);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    if (best >= 0 && bestSim >= 0.45) keys.add(best);
    else missing.push(name);
  }
  return { keys, missing };
}

// ───────────────────────── Deps (inyectables para tests)

export type TourDeps = BriefDeps & {
  llm: TourLLM;
  config: TourLlmConfig & { writerEffort: Effort; directorEffort: Effort; critic: boolean };
  now: () => Date;
  nearbyPlaceLibrary: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  searchGoogle: (args: { lat: number; lng: number; radius_m: number; food: boolean; dietary: string[] }) => Promise<RawCandidate[]>;
  searchByName: (args: { name: string; lat: number; lng: number; radius_m: number }) => Promise<RawCandidate | null>;
  searchWikipedia: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  searchOverpass: (args: { lat: number; lng: number; radius_m: number }) => Promise<RawCandidate[]>;
  /** Eventos reales de esa fecha (PRD 16, events_search) como candidatos: facts ya verificados, sin investigación. */
  searchEvents: (args: { lat: number; lng: number; date: string; language: string; city: string | null; country: string | null }) => Promise<RawCandidate[]>;
  wikidataInfo: (ids: string[]) => Promise<Map<string, WikidataInfo>>;
  wikipediaIntros: (titles: string[], lang: string) => Promise<Map<string, string>>;
  wikipediaArticle: (title: string, lang: string) => Promise<WikiArticle | null>;
  fetchPageText: (url: string) => Promise<string | null>;
  computeWalk: (stops: { lat: number; lng: number }[]) => Promise<{ total_min: number; total_m: number; polyline: string | null; legs: { min: number; m: number }[] }>;
  heartbeatMs?: number;
  /** Tiempo total del job antes de cortar extras (crítico, reintentos). Vercel corta a los 300 s. */
  budgetMs?: number;
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
    interests: interestsForName(row.name),
    tier: (row.tier as 'curated' | 'researched' | null) ?? undefined,
    facts,
  };
}

/** Grupos chicos de tipos de Places (un tipo inválido solo tumba su grupo). */
const GOOGLE_TYPE_GROUPS = [
  ['tourist_attraction', 'historical_landmark'],
  ['museum', 'art_gallery', 'performing_arts_theater'],
  ['church', 'place_of_worship'],
  ['park', 'plaza'],
  ['monument', 'cultural_landmark', 'sculpture', 'historical_place'],
  ['observation_deck', 'market'],
];
const FOOD_TYPES = ['cafe', 'restaurant', 'bakery'];
const VEG_TYPES = ['vegan_restaurant', 'vegetarian_restaurant'];

function envEffort(v: string | undefined, d: Effort): Effort {
  const x = (v ?? '').trim() as Effort;
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(x) ? x : d;
}

export function defaultDeps(admin: Db, userId: string): TourDeps {
  return {
    llm: anthropicTourLlm(),
    config: {
      effort: envEffort(process.env.TOUR_RESEARCH_EFFORT, 'medium'),
      maxTokens: 8000,
      maxIterations: 8,
      fallbacks: true,
      directorEffort: envEffort(process.env.TOUR_DIRECTOR_EFFORT, 'high'),
      writerEffort: envEffort(process.env.TOUR_WRITER_EFFORT, 'medium'),
      critic: (process.env.TOUR_CRITIC ?? 'true').trim().toLowerCase() !== 'false',
    },
    now: () => new Date(),
    weather: tourWeather,
    reverseGeocode,
    searchEvents: async ({ lat, lng, date, language, city, country }) => {
      if (!city) return [];
      const events = await runEventsSearch({ city, country: country ?? '', date_from: date, date_to: date, lang: language }, admin, userId).catch(() => []);
      return events.map((e) => {
        const at = new Date().toISOString();
        const fact = (text: string): Fact => ({ text, source_url: e.source_url, verified: true, verified_at: at, origin: 'tour', source_title: e.title });
        return {
          source: 'event' as const,
          name: e.title,
          lat: e.lat ?? lat,
          lng: e.lng ?? lng,
          interests: ['vida_nocturna', 'musica'] as InterestTag[],
          rating_count: 20_000, // puntual y de hoy: prioridad alta cuando el interés matchea
          category_hint: 'evento nocturno',
          facts: [
            fact(`Evento: ${e.title}`),
            fact(`Fecha: ${e.date}${e.start_time ? ` ${e.start_time}` : ''}`),
            fact(`Lugar: ${e.venue}`),
            ...(e.price_text ? [fact(`Precio: ${e.price_text}`)] : []),
          ],
        };
      });
    },
    nearbyPlaceLibrary: async ({ lat, lng, radius_m }) => {
      const { data, error } = await admin.rpc('nearby_place_library', { center_lat: lat, center_lng: lng, radius_m });
      if (error) {
        console.warn('[tourGenerator] nearby_place_library (¿falta aplicar la migración?):', error.message);
        return [];
      }
      return ((data ?? []) as unknown as Parameters<typeof placeLibraryRowToCandidate>[0][]).map(placeLibraryRowToCandidate);
    },
    searchGoogle: async ({ lat, lng, radius_m, food, dietary }) => {
      const groups = [...GOOGLE_TYPE_GROUPS];
      if (food) groups.push(dietary.some((d) => /vegan|vegetar/i.test(d)) ? VEG_TYPES : FOOD_TYPES);
      const rich = (await Promise.all(groups.map((types) => searchPlacesRich({ near: { lat, lng }, radius_m, types }).catch(() => [])))).flat();
      if (rich.length) {
        return rich
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => ({
            source: 'google' as const,
            google_place_id: p.google_place_id,
            name: p.name,
            lat: p.lat!,
            lng: p.lng!,
            interests: [...new Set([...interestsForGoogleTypes(p.types), ...interestsForName(p.name)])],
            google_types: p.types,
            rating_count: p.user_rating_count,
            wheelchair: p.wheelchair_entrance === false ? ('no' as const) : p.wheelchair_entrance ? ('yes' as const) : null,
            category_hint: p.types.join(' '),
            periods: p.periods,
            summary: p.editorial_summary,
            facts: [],
          }));
      }
      // Sin key de Google (o si falló todo): búsqueda por texto (OSM de fallback), como antes.
      const queries = ['tourist_attraction', 'historical_landmark', 'museum', 'church', 'park'];
      const results = await Promise.all(queries.map((query) => searchPlaces({ query, near: { lat, lng }, radius_m, max_results: 10 }).catch(() => [])));
      return results.flat().map((p) => {
        const osm = p.google_place_id.startsWith('osm:');
        return {
          source: osm ? ('osm' as const) : ('google' as const),
          google_place_id: osm ? null : p.google_place_id,
          osm_id: osm ? p.google_place_id.slice(4) : null,
          name: p.name,
          lat: p.lat ?? lat,
          lng: p.lng ?? lng,
          interests: [...new Set([...interestsForGoogleTypes(p.types), ...interestsForName(p.name)])],
          google_types: p.types,
          category_hint: p.types.join(' '),
          facts: [],
        };
      });
    },
    searchByName: async ({ name, lat, lng, radius_m }) => {
      const [p] = await searchPlaces({ query: name, near: { lat, lng }, radius_m, max_results: 1 }).catch(() => []);
      if (!p || p.lat == null || p.lng == null) return null;
      const osm = p.google_place_id.startsWith('osm:');
      return {
        source: osm ? 'osm' : 'google',
        google_place_id: osm ? null : p.google_place_id,
        osm_id: osm ? p.google_place_id.slice(4) : null,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        interests: [...new Set([...interestsForGoogleTypes(p.types), ...interestsForName(p.name)])],
        google_types: p.types,
        category_hint: p.types.join(' '),
        facts: [],
      };
    },
    searchWikipedia: async ({ lat, lng, radius_m }) => {
      const res = await wikipediaGeosearch({ lat, lng, radius_m, limit: 40 }).catch(() => []);
      return res.map((r) => ({
        source: 'wikipedia' as const,
        wikidata_id: r.wikidata_id,
        wiki_title: r.title,
        wiki_lang: 'es',
        name: r.title.replace(/\s*\(.*\)$/, ''),
        lat: r.lat,
        lng: r.lng,
        interests: interestsForName(r.title),
        facts: [],
      }));
    },
    searchOverpass: async ({ lat, lng, radius_m }) => {
      const res = await overpassCandidates({ lat, lng, radius_m }).catch(() => []);
      return res.map((o) => ({
        source: 'osm' as const,
        osm_id: o.osm_id,
        wikidata_id: o.tags.wikidata ?? null,
        wiki_title: o.tags.wikipedia?.startsWith('es:') ? o.tags.wikipedia.slice(3) : null,
        wiki_lang: o.tags.wikipedia?.startsWith('es:') ? 'es' : null,
        name: o.name,
        lat: o.lat,
        lng: o.lng,
        interests: [...new Set([...o.interests, ...interestsForName(o.name)])],
        wheelchair: o.wheelchair,
        category_hint: Object.entries(o.tags).map(([k, v]) => `${k}=${v}`).join(' '),
        facts: [],
      }));
    },
    wikidataInfo: (ids) => wikidataInfo(ids).catch(() => new Map()),
    wikipediaIntros: (titles, lang) => wikipediaIntros(titles, lang).catch(() => new Map()),
    wikipediaArticle: (title, lang) => wikipediaArticle(title, lang).catch(() => null),
    fetchPageText,
    computeWalk: async (stops) => {
      if (stops.length < 2) return { total_min: 0, total_m: 0, polyline: null, legs: [] };
      const r = await computeRoute(stops, 'walk');
      return {
        total_min: r.total_min,
        total_m: r.segments.reduce((s, seg) => s + seg.distance_m, 0),
        polyline: mergePolylines(r.segments.map((s) => s.polyline)),
        legs: r.segments.map((s) => ({ min: s.duration_min, m: s.distance_m })),
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

/** Participantes por defecto: input → bloque → yo. Siempre incluye al que pide. */
export async function resolveParticipants(admin: ToolCtx['admin'], input: { participant_ids?: string[]; block_id?: string }, userId: string) {
  const block = input.block_id ? await loadBlockContext(admin, input.block_id) : null;
  const ids = input.participant_ids?.length ? input.participant_ids : block?.participant_ids?.length ? block.participant_ids : [userId];
  return { block, participantIds: [userId, ...ids.filter((id) => id !== userId)] };
}

/** start_at del input o del bloque ("HH:MM" del bloque = hoy a esa hora, aprox. en la zona -03). */
export function resolveStart(now: Date, startAt: string | null | undefined): Date {
  if (!startAt) return now;
  if (/^\d{2}:\d{2}/.test(startAt)) {
    const [h, m] = startAt.split(':').map(Number);
    const local = new Date(now.getTime() - 3 * 3600_000);
    local.setUTCHours(h, m, 0, 0);
    return new Date(local.getTime() + 3 * 3600_000);
  }
  const d = new Date(startAt);
  return Number.isNaN(d.getTime()) ? now : d;
}

export function answersFromInput(input: ToolInput<'generate_tour'>): TourAnswers {
  return {
    themes: input.themes,
    energy: input.energy,
    familiarity: input.familiarity,
    food_stop: input.food_stop,
    include_paid_entries: input.include_paid_entries,
    kids: input.kids,
    indoor: input.indoor,
    finish: input.finish,
    must_include: input.must_include,
    notes: input.notes,
  };
}

export async function startGenerateTour(input: ToolInput<'generate_tour'>, ctx: ToolCtx, deps?: Partial<TourDeps>): Promise<TourStart> {
  const { admin, userId } = ctx;
  const { block, participantIds } = await resolveParticipants(admin, input, userId);
  const tripId = input.trip_id ?? block?.trip_id ?? null;

  const { data: tour, error } = await admin
    .from('tours')
    .insert({
      trip_id: tripId,
      block_id: input.block_id ?? null,
      owner_user_id: userId,
      mode: input.mode,
      title: null,
      persona_id: null, // Pivot (DECISIONES-SABADO.md): un solo personaje (Scout), sin personas por ciudad.
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

  const firstLine = 'Leyendo lo que sé del grupo…';
  const jobId = await createJob(admin, { kind: 'generate_tour', trip_id: tripId, user_id: userId, firstLine });

  return {
    job_id: jobId,
    tour_id: tourId,
    run: () =>
      runGenerateTour(
        { jobId, tourId, tripId, input, participantIds, startAt: input.start_at ?? block?.start_at ?? null, ctx, firstLine },
        { ...defaultDepsLazy(admin, userId), ...deps },
      ),
  };
}

/**
 * Deps por defecto, creadas recién cuando el job las usa (el setup síncrono no necesita la key de Anthropic).
 * Getters reales (no un Proxy): `{ ...defaultDepsLazy(), ...deps }` necesita own keys enumerables para que el
 * spread los copie — un Proxy solo con trap `get` spreadea a `{}` y perdíamos TODAS las deps default (incluido `now`).
 */
function defaultDepsLazy(admin: ToolCtx['admin'], userId: string): TourDeps {
  let d: TourDeps | null = null;
  const get = () => (d ??= defaultDeps(admin, userId));
  return {
    get llm() {
      return get().llm;
    },
    get config() {
      return get().config;
    },
    now: () => get().now(),
    weather: (a) => get().weather(a),
    reverseGeocode: (lat, lng) => get().reverseGeocode(lat, lng),
    nearbyPlaceLibrary: (a) => get().nearbyPlaceLibrary(a),
    searchGoogle: (a) => get().searchGoogle(a),
    searchByName: (a) => get().searchByName(a),
    searchWikipedia: (a) => get().searchWikipedia(a),
    searchOverpass: (a) => get().searchOverpass(a),
    searchEvents: (a) => get().searchEvents(a),
    wikidataInfo: (ids) => get().wikidataInfo(ids),
    wikipediaIntros: (titles, lang) => get().wikipediaIntros(titles, lang),
    wikipediaArticle: (title, lang) => get().wikipediaArticle(title, lang),
    fetchPageText: (url) => get().fetchPageText(url),
    computeWalk: (stops) => get().computeWalk(stops),
    get heartbeatMs() {
      return get().heartbeatMs;
    },
    get budgetMs() {
      return get().budgetMs;
    },
  };
}

// ───────────────────────── Utilidades del job

function readable(err: unknown): string {
  if (err instanceof JobError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 300);
}

/** Limitador de concurrencia: run(fn) espera turno. */
function limiter(size: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= size) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const run = limiter(size);
  return Promise.allSettled(items.map((t, i) => run(() => fn(t, i))));
}

const factKey = (t: string) => normalizeName(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function dedupeFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = factKey(f.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const distinctUrls = (facts: Fact[]) => new Set(facts.filter((f) => f.verified).map((f) => f.source_url)).size;

const HAS_INTERIOR: PlaceKind[] = ['church', 'museum', 'theater', 'market', 'building'];

const KIND_LABEL: Record<PlaceKind, string> = {
  plaza: 'plaza',
  church: 'iglesia',
  museum: 'museo',
  theater: 'teatro',
  monument: 'monumento',
  building: 'edificio histórico',
  market: 'mercado',
  park: 'parque',
  viewpoint: 'mirador',
  street: 'calle',
  artwork: 'obra de arte',
  food: 'para comer',
  other: 'lugar',
};

// ───────────────────────── Composición (sin base de datos)

export type TourStats = GenerateTourResult['stats'];

export type ComposedStop = {
  candidate: RawCandidate;
  kind: PlaceKind;
  /** Facts a guardar en place_library (verificados, ya deduplicados). */
  facts: Fact[];
  written: WrittenStopT;
  sources: { title: string; url: string }[];
  dwell_min: number;
  geofence_radius_m: number;
  role: string;
};

export type ComposedTour = {
  title: string;
  thesis: string;
  storyline: string | null;
  stops: ComposedStop[];
  totalWalkM: number;
  estDurationMin: number;
  polyline: string | null;
  stats: TourStats;
  usage: Usage;
  audience: string;
  context: string[];
};

type Keyed = RawCandidate & { key: string; kind: PlaceKind; exteriorOnly: boolean; interior: boolean; score: number; dwell: number; must: boolean };

export async function composeTour(
  args: { input: ToolInput<'generate_tour'>; brief: TourBrief; progress: (text: string) => void; startedAt: number },
  deps: TourDeps,
): Promise<ComposedTour> {
  const { input, brief, progress } = args;
  const budgetMs = deps.budgetMs ?? 270_000;
  const timeLeft = () => budgetMs - (Date.now() - args.startedAt);
  const usage: Usage = emptyUsage();
  const stats: TourStats = { web_search_calls: 0, places_reused: 0, places_new: 0, facts_verified: 0, facts_rejected: 0, facts_cited: 0, sentences_dropped: 0, critic_rewrites: 0 };
  const group = groupProfile(brief);
  const audience = renderBriefCard(brief, group);
  const context = briefContextBullets(brief, group);
  const cfg = deps.config;
  const city = brief.place?.city ?? '';
  const country = brief.place?.country ?? '';
  const start = { lat: input.start_lat, lng: input.start_lng };
  const wantsFood = input.food_stop === true || input.finish === 'food';

  const who = brief.members.map((m) => m.name).filter(Boolean);
  progress(who.length ? `Armo el tour pensando en ${who.join(', ')}` : 'Armo el tour con tu perfil');

  // ── Candidatos en paralelo
  const radius = input.radius_m ?? Math.min(1200, Math.max(400, input.duration_min * 20));
  // Si al grupo le gusta salir (vida nocturna / música), suman eventos reales de esa fecha (PRD 16).
  const wantsNightlife = Math.max(group.weights.vida_nocturna ?? 0, group.weights.musica ?? 0) >= 3;
  if (wantsNightlife) progress('Che, veo que les gusta salir: buscando qué hay hoy…');
  progress(`Buscando lugares con historia${brief.place?.neighborhood ? ` en ${brief.place.neighborhood}` : ' cerca'}…`);
  const [lib, goog, wiki, osm, events] = await Promise.all([
    deps.nearbyPlaceLibrary({ ...start, radius_m: radius }),
    deps.searchGoogle({ ...start, radius_m: radius, food: wantsFood, dietary: group.dietary }),
    deps.searchWikipedia({ ...start, radius_m: radius }),
    deps.searchOverpass({ ...start, radius_m: radius }),
    wantsNightlife
      ? deps.searchEvents({ ...start, date: brief.local.date, language: input.language, city: brief.place?.city ?? null, country: brief.place?.country ?? null }).catch(() => [])
      : Promise.resolve([] as RawCandidate[]),
  ]);
  if (events.length) progress(`Encontré ${events.length} ${events.length === 1 ? 'evento' : 'eventos'} para hoy`);
  let all = dedupeCandidates([...lib, ...goog, ...wiki, ...osm, ...events]);
  console.log(`[generate_tour] candidatos: biblioteca ${lib.length} · google/osm ${goog.length} · wikipedia ${wiki.length} · overpass ${osm.length} → ${all.length}`);

  // Notoriedad y títulos de Wikipedia en lote (Wikidata).
  const info = await deps.wikidataInfo(all.map((c) => c.wikidata_id).filter((x): x is string => !!x));
  all = all.map((c) => {
    const w = c.wikidata_id ? info.get(c.wikidata_id) : undefined;
    if (!w) return c;
    const title = c.wiki_title ?? w.eswiki ?? w.enwiki;
    return { ...c, sitelinks: w.sitelinks, wiki_title: title, wiki_lang: c.wiki_title ? (c.wiki_lang ?? 'es') : w.eswiki ? 'es' : w.enwiki ? 'en' : null };
  });

  // Lugares pedidos por nombre que no aparecieron: los buscamos.
  const mustNames = input.must_include ?? [];
  let must = matchMustInclude(all, mustNames);
  if (must.missing.length) {
    const found = (await Promise.all(must.missing.map((name) => deps.searchByName({ name, ...start, radius_m: radius * 2 })))).filter((x): x is RawCandidate => !!x);
    all = dedupeCandidates([...all, ...found]);
    must = matchMustInclude(all, mustNames);
  }
  const mustSet = new Set([...must.keys].map((i) => all[i]));
  // Fuera del radio solo queda lo que pidieron por nombre (hasta 3 km).
  all = all.filter((c) => distanceMeters(start, c) <= (mustSet.has(c) ? 3000 : radius * 1.25));

  const filtered = filterCandidates(all, { avoid: group.avoid, stepFree: group.stepFree });
  if (filtered.length < 3) {
    throw new JobError('not_enough_candidates', 'No encontramos suficientes lugares con historia acá (mínimo 3). Probá con más tiempo o moviéndote un poco.');
  }

  // ── Puntaje para el grupo
  const near = (a: { lat: number | null; lng: number | null }, b: { lat: number; lng: number }, m = 80) =>
    a.lat != null && a.lng != null && distanceMeters({ lat: a.lat, lng: a.lng }, b) <= m;
  const keyed: Keyed[] = filtered
    .map((c, i) => {
      const kind = placeKind(c);
      if (kind === 'food' && !wantsFood) return null;
      const exteriorOnly = !!c.exteriorOnly;
      const interior = !exteriorOnly && (kind === 'church' || kind === 'market' || ((kind === 'museum' || kind === 'theater') && group.paidEntries));
      const itin = brief.itinerary.find((it) => near(it, c) || (it.place_name && nameSimilarity(it.place_name, c.name) >= 0.6));
      const toldLayers = c.place_library_id ? (brief.told.get(c.place_library_id)?.size ?? 0) : 0;
      const isMust = mustSet.has(c);
      const score = scoreForGroup(
        {
          interests: c.interests.length ? c.interests : interestsForName(c.name),
          kind,
          notability: normalizeNotability({ rating_count: c.rating_count, sitelinks: c.sitelinks, verified_facts: c.facts.filter((f) => f.verified).length }),
          curated: c.tier === 'curated',
          must: isMust,
          toldLayers,
          inPreviousTour: !!c.place_library_id && brief.previousTourPlaceIds.has(c.place_library_id),
          inItinerary: itin ? (itin.when === 'past' ? 'past' : 'future') : null,
          exteriorOnly,
          saved: brief.saved.some((s) => near(s, c, 60)),
        },
        group,
      );
      return { ...c, key: `p${i + 1}`, kind, exteriorOnly, interior, score, dwell: dwellFor(kind, { interior, pace: group.pace }), must: isMust };
    })
    .filter((c): c is Keyed => !!c && c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 45);
  const byKey = new Map(keyed.map((c) => [c.key, c]));

  // ── Final del recorrido
  let end: { lat: number; lng: number } | null = input.end_point ? { lat: input.end_point.lat, lng: input.end_point.lng } : null;
  if (!end && input.finish === 'start') end = start;
  let lastKey: string | null = null;
  if (!end && (input.finish === 'view' || input.finish === 'food')) {
    const kinds: PlaceKind[] = input.finish === 'view' ? ['viewpoint', 'plaza', 'park'] : ['food', 'market'];
    const anchor = keyed.filter((c) => kinds.includes(c.kind)).sort((a, b) => b.score - a.score)[0];
    lastKey = anchor?.key ?? null;
  }

  const startMinuteOfWeek = brief.local.day * 1440 + brief.local.minutes;
  const routeCand = (c: Keyed, forceMust = false): RouteCandidate => ({
    key: c.key,
    lat: c.lat,
    lng: c.lng,
    kind: c.kind,
    score: c.score,
    dwell: c.dwell,
    openAt: c.interior || !exteriorOk(c.kind) ? openAtFn(c.periods) : undefined,
    must: forceMust || c.must,
  });
  const maxWalkM = group.maxWalkKm ? group.maxWalkKm * 1000 : group.stepFree ? 2500 : null;
  const baseProblem = {
    start,
    end,
    lastKey,
    walkKmh: walkKmh(group.pace, group.stepFree, group.hasKids),
    maxWalkM,
    startMinuteOfWeek,
  };
  const maxStops = input.mode === 'explorer' ? 20 : targetStops(input.duration_min, group.pace);
  const budget = input.mode === 'explorer' ? input.duration_min * 3 : input.duration_min;
  let plan: RoutePlan = planRoute({ ...baseProblem, budgetMin: budget, maxStops, candidates: keyed.map((c) => routeCand(c)) });
  if (plan.keys.length < 3) plan = planRoute({ ...baseProblem, budgetMin: budget * 1.3, maxStops, candidates: keyed.map((c) => routeCand(c)) });
  if (plan.keys.length < 3) {
    throw new JobError('not_enough_candidates', 'No encontramos suficientes lugares con historia en este tiempo (mínimo 3). Probá con más minutos o moviéndote un poco.');
  }
  progress(`Armé un recorrido de ${plan.keys.length} paradas (${(plan.walkM / 1000).toFixed(1).replace('.', ',')} km)`);

  // ── Resúmenes para el director (Wikipedia intro / resumen de Google / facts propios)
  const inRoute = new Set(plan.keys);
  const alternates = keyed
    .filter((c) => !inRoute.has(c.key) && plan.keys.some((k) => distanceMeters(byKey.get(k)!, c) <= 350))
    .slice(0, 8);
  const forSummary = [...plan.keys.map((k) => byKey.get(k)!), ...alternates];
  const introsEs = await deps.wikipediaIntros(forSummary.filter((c) => c.wiki_title && c.wiki_lang !== 'en').map((c) => c.wiki_title!), 'es');
  const introsEn = await deps.wikipediaIntros(forSummary.filter((c) => c.wiki_title && c.wiki_lang === 'en').map((c) => c.wiki_title!), 'en');
  const summaryOf = (c: Keyed) =>
    (c.wiki_title && (introsEs.get(c.wiki_title) ?? introsEn.get(c.wiki_title))) ||
    c.summary ||
    c.facts
      .filter((f) => f.verified)
      .slice(0, 3)
      .map((f) => f.text)
      .join(' ') ||
    '';

  /** Lugares a < 90 m de una parada que no son parada: se cuentan desde ahí ("desde acá también se ve…"). */
  const alsoNear = (k: string, routeKeys: string[]): Keyed[] => {
    const c = byKey.get(k)!;
    return keyed
      .filter((o) => !routeKeys.includes(o.key) && distanceMeters(c, o) < 90)
      .filter((o) => routeKeys.every((rk) => rk === k || distanceMeters(byKey.get(rk)!, o) >= distanceMeters(c, o)))
      .slice(0, 3);
  };

  // ── Investigación (arranca YA, en paralelo con el director; el ángulo llega cuando el director termina)
  let resolveAngles: (m: Map<string, string>) => void = () => {};
  const anglesP = new Promise<Map<string, string>>((r) => (resolveAngles = r));
  const research = new Map<string, Promise<Fact[]>>();
  const runResearch = limiter(6);
  const researchFor = (c: Keyed) => {
    let p = research.get(c.key);
    if (!p) {
      p = runResearch(() => researchPlace(c)).catch((err) => {
        console.warn(`[generate_tour] investigación de ${c.name} falló:`, readable(err));
        return c.facts.filter((f) => f.verified);
      });
      research.set(c.key, p);
    }
    return p;
  };

  const researchPlace = async (c: Keyed): Promise<Fact[]> => {
    const existing = c.facts.filter((f) => f.verified);
    if (c.source === 'event' || (existing.length >= 6 && distinctUrls(existing) >= 2)) return existing;
    const pending: (Fact & { quote: string })[] = [];
    let rejected = 0;
    const now = new Date().toISOString();

    // 1) Wikipedia: el artículo completo es la fuente; la cita se chequea en código contra ese texto.
    const articles: WikiArticle[] = [];
    const titled = [c, ...alsoNear(c.key, [...plan.keys, c.key]).filter((o) => o.wiki_title).slice(0, 1)].filter((x) => x.wiki_title);
    for (const t of titled) {
      const a = await deps.wikipediaArticle(t.wiki_title!, t.wiki_lang ?? 'es');
      if (a && a.text.length > 300) articles.push(a);
    }
    for (const article of articles) {
      const ex = await deps.llm.extractFacts({
        system: EXTRACT_SYSTEM,
        user: renderExtractUser({ place: c.name, city, article, audience, angle: null }),
        config: { ...cfg, effort: 'low', maxTokens: 6000 },
      });
      addUsage(usage, ex.usage);
      for (const f of ex.facts) {
        if (quoteInText(f.quote, article.text)) {
          pending.push({ text: f.text, quote: f.quote, kind: f.kind, source_url: article.url, source_title: `Wikipedia · ${article.title}`, verified: false, verified_at: now, origin: 'tour' });
        } else rejected++;
      }
    }

    // 2) Web: si faltan datos o fuentes distintas, y queda tiempo.
    const have = [...existing, ...pending];
    if ((have.length < 6 || new Set(have.map((f) => f.source_url)).size < 2) && timeLeft() > 130_000) {
      const angles = await Promise.race([anglesP, new Promise<Map<string, string>>((r) => setTimeout(() => r(new Map()), 45_000))]);
      const r = await deps.llm.research({
        system: RESEARCH_SYSTEM,
        user: renderResearchUser({ place: c.name, city, country, lat: c.lat, lng: c.lng, known: have.map((f) => f.text), angle: angles.get(c.key) ?? null, interests: c.interests }),
        config: { ...cfg, maxTokens: 8000 },
      });
      addUsage(usage, r.usage);
      stats.web_search_calls += r.web_search_calls;
      await Promise.all(
        r.facts.map(async (f) => {
          const page = await deps.fetchPageText(f.source_url);
          if (page) {
            if (quoteInText(f.quote, page)) pending.push({ ...f, verified: false, verified_at: now, origin: 'tour' });
            else rejected++;
            return;
          }
          // No pudimos bajar la página (JS, bloqueo): verificación de Claude con web_fetch.
          const v = await deps.llm.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(f), config: { ...cfg, effort: 'low', maxTokens: 3000 } });
          addUsage(usage, v.usage);
          if (v.result?.supported && v.result.quote.trim()) pending.push({ ...f, quote: v.result.quote, verified: false, verified_at: now, origin: 'tour' });
          else rejected++;
        }),
      );
    }

    // 3) Juez: ¿cada cita respalda su dato tal cual? (independiente de quien extrajo)
    const fresh = (dedupeFacts(pending) as typeof pending).filter((f) => !existing.some((e) => factKey(e.text) === factKey(f.text)));
    let verified: Fact[] = [];
    if (fresh.length) {
      try {
        const pairs = fresh.map((f, i) => ({ id: `c${i + 1}`, text: f.text, quote: f.quote }));
        const j = await deps.llm.judgeFacts({ system: JUDGE_SYSTEM, user: renderJudgeUser(c.name, pairs), config: { ...cfg, effort: 'low', maxTokens: 3000 } });
        addUsage(usage, j.usage);
        const ok = new Set(j.verdicts.filter((v) => v.supported).map((v) => v.id));
        verified = fresh.filter((_, i) => ok.has(`c${i + 1}`)).map((f) => ({ ...f, verified: true }));
        rejected += fresh.length - verified.length;
      } catch (err) {
        // Sin juez, nos quedamos con los que pasaron el chequeo textual de la cita (ya es un filtro fuerte).
        console.warn('[generate_tour] juez falló, uso el chequeo de cita:', readable(err));
        verified = fresh.map((f) => ({ ...f, verified: true }));
      }
    }
    stats.facts_verified += verified.length;
    stats.facts_rejected += rejected;
    return dedupeFacts([...existing, ...verified]);
  };

  plan.keys.forEach((k) => void researchFor(byKey.get(k)!));

  // ── Director
  progress('Pensando la historia que hilvana el tour…');
  const legMin = (i: number, keys: string[]) => {
    const prev = i === 0 ? start : byKey.get(keys[i - 1])!;
    return Math.max(1, Math.round((distanceMeters(prev, byKey.get(keys[i])!) * 1.3) / ((baseProblem.walkKmh * 1000) / 60)));
  };
  let director: DirectorOutputT | null = null;
  try {
    const d = await deps.llm.direct({
      system: DIRECTOR_SYSTEM,
      user: renderDirectorUser({
        audience,
        storyline: input.storyline,
        stops: plan.keys.map((k, i) => {
          const c = byKey.get(k)!;
          const also = alsoNear(k, plan.keys);
          const summary = [summaryOf(c), also.length ? `Desde acá también se ve: ${also.map((o) => o.name).join(', ')}.` : ''].filter(Boolean).join(' ');
          return { key: k, name: c.name, kind: KIND_LABEL[c.kind], walk_from_prev_min: legMin(i, plan.keys), arrival_min: plan.arrivals[i] ?? 0, exterior_only: c.exteriorOnly || plan.exteriorKeys.includes(k), summary };
        }),
        alternates: alternates.map((c) => ({ key: c.key, name: c.name, kind: KIND_LABEL[c.kind], summary: summaryOf(c) })),
        totalMin: plan.totalMin,
        walkM: plan.walkM,
      }),
      config: { ...cfg, effort: cfg.directorEffort, maxTokens: 12000 },
    });
    addUsage(usage, d.usage);
    director = d.plan;
  } catch (err) {
    console.warn('[generate_tour] director falló, sigo con un arco simple:', readable(err));
  }

  // Swaps del director (máx. 3, solo keys válidas) → se re-rutea con esas paradas como obligatorias.
  let finalPlan = plan;
  const swaps = (director?.swaps ?? []).filter((s) => inRoute.has(s.remove_key) && byKey.has(s.add_key) && !inRoute.has(s.add_key)).slice(0, 3);
  if (swaps.length) {
    const keys = new Set(plan.keys);
    for (const s of swaps) {
      keys.delete(s.remove_key);
      keys.add(s.add_key);
    }
    const replanned = planRoute({
      ...baseProblem,
      lastKey: lastKey && keys.has(lastKey) ? lastKey : null,
      budgetMin: budget * 1.15,
      maxStops: keys.size,
      candidates: [...keys].map((k) => routeCand(byKey.get(k)!, true)),
    });
    if (replanned.keys.length >= 3) {
      finalPlan = replanned;
      progress(`Cambié ${swaps.length === 1 ? 'una parada' : `${swaps.length} paradas`} para que la historia cierre mejor`);
    }
  }

  // ── Tiempo real a pie (Google Routes) y recorte si nos pasamos
  const pathFor = (keys: string[]) => [start, ...keys.map((k) => ({ lat: byKey.get(k)!.lat, lng: byKey.get(k)!.lng })), ...(end ? [end] : [])];
  const dwellOf = (keys: string[]) => keys.reduce((s, k) => s + (finalPlan.exteriorKeys.includes(k) ? Math.min(byKey.get(k)!.dwell, 4) : byKey.get(k)!.dwell), 0);
  let keys = [...finalPlan.keys];
  let walk = await deps.computeWalk(pathFor(keys));
  while (input.mode !== 'explorer' && walk.total_min + dwellOf(keys) > input.duration_min * 1.1 && keys.length > 3) {
    const removable = keys.filter((k, i) => !byKey.get(k)!.must && !(lastKey && k === lastKey) && !(i === keys.length - 1 && end));
    if (!removable.length) break;
    const worst = removable.reduce((w, k) => (byKey.get(k)!.score < byKey.get(w)!.score ? k : w));
    keys = keys.filter((k) => k !== worst);
    walk = await deps.computeWalk(pathFor(keys));
  }
  const estDurationMin = Math.round(walk.total_min + dwellOf(keys));

  // Arco por parada (del director, o uno simple si falló).
  const dirStops = new Map((director?.stops ?? []).map((s) => [s.key, s]));
  const roleFor = (i: number) => (i === 0 ? 'gancho' : i === keys.length - 1 ? 'cierre' : 'desarrollo');
  const arc = keys.map((k, i) => {
    const c = byKey.get(k)!;
    const d = dirStops.get(k);
    return {
      key: k,
      role: d?.role ?? roleFor(i),
      angle: d?.angle ?? (summaryOf(c).split('. ')[0] || `Qué hace especial a ${c.name}`),
      point_at: d?.point_at ?? `lo más llamativo de ${c.name}`,
      personal_hook: d?.personal_hook ?? null,
      callbacks_to: (d?.callbacks_to ?? []).filter((x) => keys.indexOf(x) > -1 && keys.indexOf(x) < i),
    };
  });
  resolveAngles(new Map(arc.map((a) => [a.key, a.angle])));
  const title = director?.title?.trim() || (brief.place?.neighborhood ? `${brief.place.neighborhood} a pie` : `Tour de ${keys.length} paradas`);
  const thesis = director?.thesis?.trim() || '';
  const storyline = input.storyline ? (director?.storyline ?? null) : null;
  if (director?.title) progress(`«${title}»`);

  // ── Esperar la investigación de las paradas finales
  progress('Investigando y verificando cada dato con su fuente…');
  const factsByKey = new Map<string, Fact[]>();
  await Promise.all(keys.map(async (k) => factsByKey.set(k, await researchFor(byKey.get(k)!))));
  progress(`Verifiqué ${stats.facts_verified} datos nuevos${stats.facts_rejected ? ` (descarté ${stats.facts_rejected})` : ''}`);

  // ── Escritores (una parada por llamada, en paralelo) + chequeo
  progress('Escribiendo las paradas…');
  const allowBase = contextProperNouns(brief);
  const cumulative = (i: number) => {
    let t = 0;
    for (let j = 0; j <= i; j++) {
      t += walk.legs[j]?.min ?? legMin(j, keys);
      if (j < i) t += byKey.get(keys[j])!.dwell;
    }
    return t;
  };
  const clockAt = (min: number) => {
    const m = (brief.local.minutes + Math.round(min)) % 1440;
    return `a las ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  type Draft = { written: WrittenStopT; cited: Set<string>; dropped: string[] };
  const citedFactsFor = (k: string): CitedFact[] =>
    (factsByKey.get(k) ?? []).filter((f) => f.verified).map((f, i) => ({ id: `f${i + 1}`, text: f.text, quote: f.quote, source_url: f.source_url, source_title: f.source_title }));

  const checkWritten = (k: string, i: number, w: WrittenStopT): Draft => {
    const c = byKey.get(k)!;
    const next = i < keys.length - 1 ? byKey.get(keys[i + 1])! : null;
    const facts = citedFactsFor(k);
    const allow = [...allowBase, ...c.name.split(/\s+/), ...(next ? next.name.split(/\s+/) : []), ...alsoNear(k, keys).flatMap((o) => o.name.split(/\s+/))];
    const cited = new Set<string>();
    const dropped: string[] = [];
    const run = (text: string | null, extra: CitedFact[] = []) => {
      const r = checkNarration(text, [...facts, ...extra], allow);
      r.cited.forEach((x) => cited.add(x));
      dropped.push(...r.dropped);
      return r.text || null;
    };
    const leg = walk.legs[i + 1];
    const logistics: CitedFact[] = next ? [{ id: 'f0', text: `${leg?.min ?? ''} minutos ${leg?.m ?? ''} metros`, source_url: '' }] : [];
    const written: WrittenStopT = {
      look_at: run(w.look_at) ?? `Mirá ${c.name}.`,
      narration_short: run(w.narration_short) ?? '',
      narration_more: run(w.narration_more) ?? '',
      narration_secret: run(w.narration_secret) ?? '',
      myth_vs_fact: run(w.myth_vs_fact),
      photo_spot: run(w.photo_spot),
      kid_mission: run(w.kid_mission),
      transition_to_next: next ? run(w.transition_to_next, logistics) : null,
      nav_to_next: next ? stripCitations(w.nav_to_next) : null,
    };
    cited.delete('f0');
    return { written, cited, dropped };
  };

  const writeOne = async (k: string, i: number, feedback: string[]): Promise<Draft> => {
    const c = byKey.get(k)!;
    const a = arc[i];
    const nextKey = keys[i + 1];
    const next = nextKey ? byKey.get(nextKey)! : null;
    const leg = walk.legs[i + 1];
    const told = c.place_library_id ? [...(brief.told.get(c.place_library_id) ?? [])] : [];
    const res = await deps.llm.writeStop({
      system: WRITER_SYSTEM,
      user: renderWriterUser({
        audience,
        tour: { title, thesis, storyline },
        index: i,
        total: keys.length,
        stop: {
          name: c.name,
          kind: KIND_LABEL[c.kind],
          role: a.role,
          angle: a.angle,
          point_at: a.point_at,
          personal_hook: a.personal_hook,
          // Solo tiene sentido aclarar 'no entran' donde hay un adentro (no en una plaza o un parque).
          exterior_only: HAS_INTERIOR.includes(c.kind) && (c.exteriorOnly || finalPlan.exteriorKeys.includes(k) || !c.interior),
          dwell_min: c.dwell,
          arrival_text: clockAt(cumulative(i)),
          also: alsoNear(k, keys).map((o) => o.name),
        },
        callbacks: a.callbacks_to.map((x) => ({ name: byKey.get(x)!.name, angle: arc[keys.indexOf(x)].angle })),
        next: next ? { name: next.name, walk_min: leg?.min ?? legMin(i + 1, keys), walk_m: leg?.m ?? Math.round(distanceMeters(c, next) * 1.3), direction: cardinal(c, next) } : null,
        facts: citedFactsFor(k).map((f) => ({ id: f.id, text: f.text })),
        alreadyTold: told,
        sunset: brief.weather?.sunset ?? null,
        feedback,
      }),
      config: { ...cfg, effort: cfg.writerEffort, maxTokens: 10000 },
    });
    addUsage(usage, res.usage);
    return checkWritten(k, i, res.stop);
  };

  const needsRetry = (d: Draft) => wordCount(d.written.narration_short) < 50 || wordCount(d.written.narration_more) < 90 || d.dropped.length > 2;
  const retryFeedback = (d: Draft) => [
    ...(d.dropped.length ? [`Se borraron estas oraciones porque tenían datos que no están en FACTS (no los repitas; contá otra cosa o citá bien): ${d.dropped.map((s) => `"${s}"`).join(' · ')}`] : []),
    'Cada oración con año, cifra, siglo o nombre propio termina con su cita [fN].',
  ];
  const better = (a: Draft, b: Draft) => (b.dropped.length < a.dropped.length || wordCount(b.written.narration_short) > wordCount(a.written.narration_short) + 10 ? b : a);

  const drafts = new Map<string, Draft>();
  const results = await pool(keys, 6, async (k, i) => {
    let d = await writeOne(k, i, []);
    if (needsRetry(d) && timeLeft() > 60_000) d = better(d, await writeOne(k, i, retryFeedback(d)));
    drafts.set(k, d);
  });
  results.forEach((r, i) => r.status === 'rejected' && console.warn(`[generate_tour] escritor de ${keys[i]} falló:`, readable(r.reason)));

  // ── Crítico (si queda tiempo) → reescribe las flojas
  const okKeys = () => keys.filter((k) => drafts.has(k) && wordCount(drafts.get(k)!.written.narration_short) >= 15);
  if (cfg.critic && okKeys().length >= 3 && timeLeft() > 75_000) {
    progress('Revisando el tour como un editor…');
    try {
      const rev = await deps.llm.critique({
        system: CRITIC_SYSTEM,
        user: renderCriticUser({
          audience,
          title,
          thesis,
          stops: okKeys().map((k) => {
            const w = drafts.get(k)!.written;
            return {
              key: k,
              name: byKey.get(k)!.name,
              role: arc[keys.indexOf(k)].role,
              text: [`MIRAR: ${w.look_at}`, `CORTA: ${w.narration_short}`, `MÁS: ${w.narration_more}`, `SECRETO: ${w.narration_secret}`, w.kid_mission ? `CHICOS: ${w.kid_mission}` : '', w.transition_to_next ? `TRANSICIÓN: ${w.transition_to_next}` : '']
                .filter(Boolean)
                .join('\n'),
            };
          }),
        }),
        config: { ...cfg, effort: 'medium', maxTokens: 8000 },
      });
      addUsage(usage, rev.usage);
      const toFix = rev.review.stops.filter((s) => (s.rewrite || s.score < 7) && drafts.has(s.key) && s.issues.length).slice(0, 4);
      if (toFix.length && timeLeft() > 50_000) {
        progress(`Puliendo ${toFix.length === 1 ? 'una parada' : `${toFix.length} paradas`}…`);
        await pool(toFix, 4, async (s) => {
          const i = keys.indexOf(s.key);
          const d = await writeOne(s.key, i, s.issues);
          if (wordCount(d.written.narration_short) >= 25 && d.dropped.length <= drafts.get(s.key)!.dropped.length + 1) {
            drafts.set(s.key, d);
            stats.critic_rewrites = (stats.critic_rewrites ?? 0) + 1;
          }
        });
      }
    } catch (err) {
      console.warn('[generate_tour] crítico falló, sigo sin revisión:', readable(err));
    }
  }

  // ── Armar las paradas finales (las que quedaron con contenido)
  const stops: ComposedStop[] = [];
  for (const k of keys) {
    const d = drafts.get(k);
    if (!d || wordCount(d.written.narration_short) < 15) continue; // mejor menos paradas que una vacía
    const c = byKey.get(k)!;
    const facts = citedFactsFor(k);
    stats.facts_cited = (stats.facts_cited ?? 0) + d.cited.size;
    stats.sentences_dropped = (stats.sentences_dropped ?? 0) + d.dropped.length;
    stats.places_reused += c.place_library_id ? 1 : 0;
    stats.places_new += c.place_library_id ? 0 : 1;
    stops.push({
      candidate: c,
      kind: c.kind,
      facts: factsByKey.get(k) ?? [],
      written: d.written,
      sources: sourcesFor(facts, d.cited, c.name),
      dwell_min: finalPlan.exteriorKeys.includes(k) ? Math.min(c.dwell, 4) : c.dwell,
      geofence_radius_m: geofenceFor(c.kind),
      role: arc[keys.indexOf(k)].role,
    });
  }
  // Si se cayó una parada del medio, la anterior no puede tener la transición vieja: la última nunca tiene.
  if (stops.length) {
    const last = stops[stops.length - 1];
    last.written = { ...last.written, transition_to_next: null, nav_to_next: null };
  }
  if (stops.length < 3) throw new JobError('generate_failed', 'No llegamos a armar suficientes paradas con datos verificados.');

  return { title, thesis, storyline, stops, totalWalkM: Math.round(walk.total_m), estDurationMin, polyline: walk.polyline, stats, usage, audience, context };
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

export async function runGenerateTour(args: RunArgs, deps: TourDeps): Promise<void> {
  const { jobId, tourId, tripId, input, ctx } = args;
  const { admin } = ctx;
  const startedAt = Date.now();
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: args.firstLine }]);
  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => 'Sigo investigando y escribiendo…', deps.heartbeatMs ?? 10_000);

  let fatal: string | null = null;
  let composed: ComposedTour | null = null;
  let stopCount = 0;

  try {
    const brief = await loadTourBrief(
      admin,
      {
        participantIds: args.participantIds,
        tripId,
        excludeTourId: tourId,
        start: resolveStart(deps.now(), args.startAt),
        durationMin: input.duration_min,
        lat: input.start_lat,
        lng: input.start_lng,
        answers: answersFromInput(input),
      },
      deps,
    );
    composed = await composeTour({ input, brief, progress: (t) => void progress.push(t), startedAt }, deps);
    const city = brief.place?.city ?? null;
    const country = brief.place?.country_code ?? null;

    // ── Escritura: place_library (nunca pisa curated) → tour_stops → tours
    const stopRows: Record<string, unknown>[] = [];
    for (let i = 0; i < composed.stops.length; i++) {
      const s = composed.stops[i];
      const c = s.candidate;
      const verifiedFacts = s.facts.filter((f) => f.verified);
      let placeId = c.place_library_id ?? null;
      // Memoria de lugares: se SUMAN facts (nunca se reemplazan: research y cámara también escriben acá).
      if (placeId) {
        if (c.tier !== 'curated') await appendFacts(admin, placeId, verifiedFacts as LibraryFact[]);
      } else {
        const { data: existing } = c.google_place_id
          ? await admin.from('place_library').select('id,tier').eq('google_place_id', c.google_place_id).maybeSingle()
          : c.wikidata_id
            ? await admin.from('place_library').select('id,tier').eq('wikidata_id', c.wikidata_id).maybeSingle()
            : c.osm_id
              ? await admin.from('place_library').select('id,tier').eq('osm_id', c.osm_id).maybeSingle()
              : { data: null };
        if (existing) {
          placeId = existing.id as string;
          if (existing.tier !== 'curated') await appendFacts(admin, placeId, verifiedFacts as LibraryFact[]);
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
              city,
              country,
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
      const w = s.written;
      stopRows.push({
        id: randomUUID(),
        tour_id: tourId,
        place_id: placeId,
        sort_order: i + 1,
        geofence_radius_m: s.geofence_radius_m,
        dwell_min: s.dwell_min,
        look_at: w.look_at,
        narration_short: w.narration_short,
        narration_more: w.narration_more || null,
        narration_secret: w.narration_secret || null,
        myth_vs_fact: w.myth_vs_fact,
        photo_spot: w.photo_spot,
        kid_mission: w.kid_mission,
        transition_to_next: w.transition_to_next,
        nav_to_next: w.nav_to_next,
        sources: s.sources,
      });
    }
    const { error: eStops } = await admin.from('tour_stops').insert(stopRows);
    if (eStops) throw dbError(eStops, 'tour_stops');

    const base = {
      title: composed.title,
      storyline: composed.storyline,
      status: 'ready',
      route: { polyline: composed.polyline, total_walk_m: composed.totalWalkM, est_duration_min: composed.estDurationMin },
    };
    const extra = {
      thesis: composed.thesis || null,
      brief: {
        audience: composed.audience,
        context: composed.context,
        answers: answersFromInput(input),
        place: brief.place,
        weather: brief.weather ? { temp_c: brief.weather.temp_c, max_precip_prob: brief.weather.max_precip_prob, sunset: brief.weather.sunset } : null,
        roles: composed.stops.map((s) => s.role),
      },
    };
    let { error: eTour } = await admin.from('tours').update({ ...base, ...extra }).eq('id', tourId);
    // Si todavía no se aplicó la migración 20261017000009 (tours.thesis/brief), el tour sale igual sin esos campos.
    if (eTour && /thesis|brief|column/i.test(eTour.message)) {
      console.warn('[generate_tour] tours.thesis/brief no existen (¿falta la migración?):', eTour.message);
      ({ error: eTour } = await admin.from('tours').update(base).eq('id', tourId));
    }
    if (eTour) throw dbError(eTour, 'tours');

    // Bloque "tour" del itinerario → se liga al tour recién armado (si no, "Empezar tour" nunca lo encuentra).
    if (input.block_id) await admin.from('blocks').update({ tour_id: tourId }).eq('id', input.block_id);

    // Fase 2: investigación profunda de cada parada, una invocación por parada (mientras caminan a la primera).
    await kickDeepResearch(admin, stopRows.map((r) => r.id as string)).catch((err) => console.warn('[generate_tour] deep research:', readable(err)));
    await admin.from('tours').update({ brief: { ...extra.brief, deep_research_at: new Date().toISOString() } }).eq('id', tourId);

    if (tripId) {
      await insertFeed(ctx, {
        trip_id: tripId,
        kind: 'tour_generated',
        payload: { summary: `El Scout armó «${composed.title}», un tour de ${stopRows.length} paradas`, tour_id: tourId },
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

  const usage = composed?.usage ?? emptyUsage();
  const result: GenerateTourResult = {
    tour_id: tourId,
    stop_count: stopCount,
    total_walk_m: composed?.totalWalkM ?? 0,
    est_duration_min: composed?.estDurationMin ?? 0,
    stats: { ...(composed?.stats ?? { web_search_calls: 0, places_reused: 0, places_new: 0, facts_verified: 0, facts_rejected: 0 }), duration_ms: Date.now() - startedAt },
    title: composed?.title ?? null,
    thesis: composed?.thesis ?? null,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
  };
  console.log(`[generate_tour/${jobId}] fin · ${stopCount} paradas · ${Math.round((Date.now() - startedAt) / 1000)} s · usage ${JSON.stringify(usage)} · ~USD ${estimateCostUsd(usage)}`);
  if (fatal) {
    await admin.from('tours').update({ status: 'failed' }).eq('id', tourId);
    await progress.push(`Se trancó: ${fatal}`);
    await progress.set({ status: 'failed', error: fatal, result });
  } else {
    await progress.push(`¡Listo! «${composed?.title}» · ${stopCount} paradas`);
    await progress.set({ status: 'done', error: null, result });
  }
  await progress.flush();
}

export type { GroupProfile };
