// generate_indoor_tour: tour POR DENTRO de un lugar (museo, mercado, iglesia). Adentro el GPS no sirve, así que el tour
// sale con route.positioning = 'manual' y la llegada a cada punto la marca la persona (voz, botón o foto).
//   1) ubicar el lugar (place_library / search_places) → coordenadas del edificio
//   2) investigar: Claude + web_search/web_fetch → 4-7 puntos de adentro (obra, sala, objeto) con dónde están, qué
//      mirar y datos atómicos con URL y cita textual
//   3) verificar cada dato: la cita tiene que estar en el texto de su URL (en código); si no podemos bajar la página,
//      Claude con web_fetch. Después el juez (¿la cita respalda el dato?), igual que el generador de tours
//   4) escribir narraciones SOLO con lo verificado (citas [fN] → checkNarration borra lo que no tiene respaldo)
//   5) guardar: place_library por punto (con las coordenadas del lugar), tour_stops, tours (status ready)
// El job es kind 'generate_tour' con el mismo result: la app y la voz lo esperan igual que un tour a pie.
import { randomUUID } from 'node:crypto';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { GenerateTourResult, ToolInput, TourRoute } from '@build101/shared';
import { dbError } from '../errors';
import { insertFeed } from '../feed';
import { fetchPageText } from '../google/pageText';
import { createJob, JobProgress } from '../jobs';
import { appendFacts, ensurePlace, type LibraryFact } from '../places/library';
import type { Db } from '../supabase';
import type { ToolCtx } from '../tools/types';
import { anthropicClient, JobError, PLANNER_MODEL, textOf, type AnyBlock } from './llm';
import { addUsage, emptyUsage, estimateCostUsd, type Usage } from './schemas';
import { checkNarration, quoteInText, sourcesFor, stripCitations, type CitedFact } from './tourCheck';
import { anthropicTourLlm, captureViaTool, type TourLlmConfig } from './tourLlm';
import { JUDGE_SYSTEM, renderJudgeUser, renderVerifyUser, VERIFY_SYSTEM } from './tourPrompts';
import { ResearchFact } from './tourSchemas';

/** Vercel corta a los 300 s: investigación + verificación + escritura tienen que entrar holgado. */
const BUDGET_MS = 200_000;
const MIN_POINTS = 3;
const MAX_POINTS = 7;
const MAX_FACTS_PER_POINT = 4;

// ---------------------------------------------------------------- esquemas (salida estructurada: sin min/max)

export const IndoorPoint = z.object({
  name: z.string().describe('Nombre corto del punto: la obra, la sala o el objeto ("Autorretrato de 1902", "Sala de los juguetes")'),
  where: z.string().describe('Dónde está adentro del lugar, como lo diría un guía ("planta baja, a la izquierda de la entrada")'),
  look_at: z.string().describe('Qué mirar y cómo reconocerlo a simple vista (colores, tamaño, material)'),
  facts: z.array(ResearchFact).describe(`1 a ${MAX_FACTS_PER_POINT} datos atómicos de este punto, cada uno con URL y cita textual`),
});
export const IndoorResearchOut = z.object({
  venue_found: z.boolean().describe('false si no encontraste información confiable del lugar por dentro'),
  points: z.array(IndoorPoint).describe(`Entre 4 y ${MAX_POINTS} puntos, en el orden en que conviene recorrerlos`),
});
export type IndoorResearchOutT = z.infer<typeof IndoorResearchOut>;

const WrittenStop = z.object({
  id: z.string().describe('El id del punto (p1, p2…)'),
  narration_short: z.string().describe('45-80 palabras habladas, con [fN] después de cada dato'),
  narration_more: z.string().describe('30-60 palabras con lo que sobró, con [fN]; vacío si no hay más datos'),
  transition_to_next: z.string().describe('1 frase que conecta con el próximo punto; vacío en el último'),
  nav_to_next: z.string().describe('Cómo llegar al próximo punto adentro del lugar, con lo que dice where; vacío en el último'),
});
const WriterOut = z.object({ title: z.string().describe('Título corto del tour ("Torres García por dentro")'), stops: z.array(WrittenStop) });
type WriterOutT = z.infer<typeof WriterOut>;

// ---------------------------------------------------------------- prompts

export const INDOOR_RESEARCH_SYSTEM = `Sos el investigador de una app de tours rioplatense. Te piden un recorrido POR DENTRO de un lugar (museo, mercado, iglesia, palacio). Buscá con web_search y web_fetch (sitio oficial del lugar, Wikipedia, prensa seria) qué hay adentro que valga la pena: obras, salas, objetos o espacios concretos que una persona pueda encontrar y mirar HOY (colección permanente o lo que el sitio oficial dice que está expuesto).
Preferí cosas CONCRETAS con nombre propio (una obra con su título, un objeto, una sala con nombre, un detalle de la arquitectura) antes que puntos genéricos ("las salas", "la colección"); la entrada o el edificio, como mucho una vez y solo si hay datos. Buscá también en Wikipedia (artículo del lugar y de sus obras más conocidas) y en la prensa: el sitio oficial a veces no lista la colección.
Reportá con report_points entre 4 y ${MAX_POINTS} puntos en un orden lógico de recorrido. Para cada uno: dónde está adentro (si la fuente no lo dice, una indicación general honesta: "en la sala principal"), qué mirar para reconocerlo, y 1 a ${MAX_FACTS_PER_POINT} datos atómicos con la URL exacta y una frase copiada TEXTUAL de esa página que lo respalda.
Si no hay obras con nombre en las fuentes, usá puntos más generales que sí tengan datos (una sala, la colección, un taller, el edificio): es mejor un recorrido sencillo que ninguno. No inventes ni completes. venue_found=false solo si del lugar no encontrás NADA confiable.`;

export function renderIndoorResearchUser(i: { venue: string; city: string | null; notes?: string; durationMin: number }): string {
  return [
    `Lugar: ${i.venue}${i.city ? ` (${i.city})` : ''}`,
    `Duración del recorrido: ~${i.durationMin} min`,
    i.notes ? `Pedido de la persona: ${i.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export const INDOOR_WRITER_SYSTEM = `Sos el Scout, un guía de viaje rioplatense (voseo, cálido, concreto) que va a contar en voz alta un recorrido por dentro de un lugar. Te paso los puntos en orden con DATOS VERIFICADOS (ids fN). Escribí para cada punto:
- narration_short: 45-80 palabras para decir frente al punto. Arrancá por lo que se ve. Cada año, nombre o cifra tiene que salir de un dato y llevar su marca [fN] al final de la oración. Nada que no esté en los datos.
- narration_more: lo que sobró (30-60 palabras, con [fN]); vacío si no queda nada.
- transition_to_next: 1 frase que conecta con el próximo (sin datos nuevos); vacío en el último.
- nav_to_next: cómo ir al próximo adentro del lugar usando su "dónde" ("subí por la escalera de la derecha y…"); vacío en el último.
title: título corto del tour. Sin mencionar fuentes ni "los datos".`;

type VerifiedPoint = { key: string; name: string; where: string; look_at: string; facts: (CitedFact & { quote: string })[] };

function renderWriterUser(venue: string, points: VerifiedPoint[], language: string): string {
  return [
    `Idioma: ${language}`,
    `Lugar: ${venue}`,
    ...points.map((p) =>
      [`[${p.key}] ${p.name}`, `Dónde: ${p.where}`, `Qué mirar: ${p.look_at}`, 'Datos:', ...p.facts.map((f) => `  [${f.id}] ${f.text}`)].join('\n'),
    ),
  ].join('\n\n');
}

// ---------------------------------------------------------------- deps (inyectables en tests)

export type IndoorDeps = {
  research(args: { user: string; signal: AbortSignal }): Promise<{ value: IndoorResearchOutT | null; usage: Usage; web_search_calls: number }>;
  fetchPageText(url: string): Promise<string | null>;
  verifyFact(fact: { text: string; source_url: string }): Promise<{ supported: boolean; quote: string; usage: Usage }>;
  judge(venue: string, pairs: { id: string; text: string; quote: string }[]): Promise<{ supported: Set<string>; usage: Usage }>;
  write(user: string): Promise<{ value: WriterOutT; usage: Usage }>;
  ensureVenue(admin: Db, args: { name: string; near: { lat: number; lng: number } | null; language: string }): Promise<{ id: string; created: boolean } | null>;
};

const RESEARCH_CONFIG: TourLlmConfig = { effort: 'medium', maxTokens: 12_000, maxIterations: 10, fallbacks: true };
const VERIFY_CONFIG: TourLlmConfig = { effort: 'low', maxTokens: 3000, maxIterations: 4, fallbacks: true };

export function defaultIndoorDeps(): IndoorDeps {
  const tour = anthropicTourLlm();
  return {
    research: ({ user, signal }) =>
      captureViaTool<IndoorResearchOutT>({
        system: INDOOR_RESEARCH_SYSTEM,
        user,
        captureName: 'report_points',
        captureDescription: 'Reportá los puntos del recorrido por dentro, con sus datos, URL y cita textual.',
        captureSchema: IndoorResearchOut,
        serverTools: ['web_search', 'web_fetch'],
        config: RESEARCH_CONFIG,
        signal,
      }),
    fetchPageText,
    async verifyFact(fact) {
      const v = await tour.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(fact), config: VERIFY_CONFIG });
      const quote = v.result?.quote?.trim() ?? '';
      return { supported: !!(v.result?.supported && quote), quote, usage: v.usage };
    },
    async judge(venue, pairs) {
      const j = await tour.judgeFacts({ system: JUDGE_SYSTEM, user: renderJudgeUser(venue, pairs), config: { ...VERIFY_CONFIG, maxTokens: 4000 } });
      return { supported: new Set(j.verdicts.filter((v) => v.supported).map((v) => v.id)), usage: j.usage };
    },
    async write(user) {
      const format = betaZodOutputFormat(WriterOut);
      const params = {
        model: PLANNER_MODEL,
        max_tokens: 8000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: format.schema } },
        system: [{ type: 'text', text: INDOOR_WRITER_SYSTEM }],
        messages: [{ role: 'user', content: user }],
      };
      const msg = (await anthropicClient().beta.messages.create(params as never)) as unknown as { content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
      const usage = emptyUsage();
      addUsage(usage, msg.usage);
      return { value: format.parse(textOf(msg.content)) as WriterOutT, usage };
    },
    ensureVenue: (admin, args) => ensurePlace(admin, args),
  };
}

// ---------------------------------------------------------------- pasos puros

/** Verifica los datos de cada punto (cita en la página o web_fetch de Claude) y pasa el juez. Puntos sin datos: afuera. */
export async function verifyPoints(
  venue: string,
  points: IndoorResearchOutT['points'],
  deps: Pick<IndoorDeps, 'fetchPageText' | 'verifyFact' | 'judge'>,
  usage: Usage,
): Promise<{ points: VerifiedPoint[]; verified: number; rejected: number }> {
  const flat = points.slice(0, MAX_POINTS).flatMap((p, pi) => p.facts.slice(0, MAX_FACTS_PER_POINT).map((f) => ({ pi, f })));
  const pages = new Map<string, Promise<string | null>>();
  const page = (url: string) => {
    if (!pages.has(url)) pages.set(url, deps.fetchPageText(url).catch(() => null));
    return pages.get(url)!;
  };
  const checked = await Promise.all(
    flat.map(async ({ pi, f }) => {
      const text = await page(f.source_url);
      if (text) return quoteInText(f.quote, text) ? { pi, f } : null;
      const v = await deps.verifyFact(f).catch(() => ({ supported: false, quote: '', usage: emptyUsage() }));
      addUsage(usage, v.usage);
      return v.supported ? { pi, f: { ...f, quote: v.quote } } : null;
    }),
  );
  const passed = checked.filter((x): x is NonNullable<typeof x> => !!x);
  let ok = new Set(passed.map((_, i) => `c${i + 1}`));
  if (passed.length) {
    try {
      const j = await deps.judge(venue, passed.map((x, i) => ({ id: `c${i + 1}`, text: x.f.text, quote: x.f.quote })));
      addUsage(usage, j.usage);
      ok = j.supported;
    } catch (e) {
      // Sin juez: alcanza con el chequeo de la cita (mismo criterio que el generador de tours).
      console.warn('[indoor_tour] juez falló:', (e as Error).message);
    }
  }
  const byPoint = new Map<number, VerifiedPoint['facts']>();
  passed.forEach((x, i) => {
    if (!ok.has(`c${i + 1}`)) return;
    const list = byPoint.get(x.pi) ?? [];
    list.push({ id: `f${list.length + 1}`, text: x.f.text, quote: x.f.quote, source_url: x.f.source_url, source_title: x.f.source_title });
    byPoint.set(x.pi, list);
  });
  const out: VerifiedPoint[] = [];
  points.slice(0, MAX_POINTS).forEach((p, pi) => {
    const facts = byPoint.get(pi);
    if (facts?.length) out.push({ key: `p${out.length + 1}`, name: p.name.trim(), where: p.where.trim(), look_at: p.look_at.trim(), facts });
  });
  const verified = out.reduce((n, p) => n + p.facts.length, 0);
  return { points: out, verified, rejected: flat.length - verified };
}

export type IndoorStopDraft = {
  point: VerifiedPoint;
  look_at: string;
  narration_short: string;
  narration_more: string | null;
  transition_to_next: string | null;
  nav_to_next: string | null;
  sources: { title: string; url: string }[];
  dropped: number;
};

/** Narraciones del escritor → limpias (solo oraciones respaldadas) y sin marcas; fuentes = lo citado. */
export function finishStops(venue: string, points: VerifiedPoint[], written: WriterOutT): IndoorStopDraft[] {
  const byId = new Map(written.stops.map((w) => [w.id.trim().toLowerCase(), w]));
  return points.flatMap((p, i) => {
    const w = byId.get(p.key);
    const next = points[i + 1];
    const allow = [p.name, venue, next?.name ?? '', 'Scout'];
    const short = checkNarration(w?.narration_short, p.facts, allow);
    const more = checkNarration(w?.narration_more, p.facts, allow);
    if (!short.text.trim()) return [];
    const cited = new Set([...short.cited, ...more.cited]);
    return [
      {
        point: p,
        look_at: p.where ? `${p.where}. ${p.look_at}` : p.look_at,
        narration_short: stripCitations(short.text)!,
        narration_more: stripCitations(more.text) || null,
        transition_to_next: next ? stripCitations(w?.transition_to_next) || null : null,
        nav_to_next: next ? w?.nav_to_next?.trim() || `Seguimos a ${next.name}: ${next.where}.` : null,
        sources: sourcesFor(p.facts, cited.size ? cited : new Set(p.facts.map((f) => f.id)), venue),
        dropped: short.dropped.length + more.dropped.length,
      },
    ];
  });
}

// ---------------------------------------------------------------- job

export type IndoorStart = { job_id: string; tour_id: string; run: () => Promise<GenerateTourResult> };

export async function startIndoorTour(input: ToolInput<'generate_indoor_tour'>, ctx: ToolCtx, deps?: Partial<IndoorDeps>): Promise<IndoorStart> {
  const { admin, userId } = ctx;
  const route: TourRoute = { polyline: null, total_walk_m: 0, est_duration_min: input.duration_min, positioning: 'manual', indoor: true, venue: null };
  const { data: tour, error } = await admin
    .from('tours')
    .insert({
      trip_id: input.trip_id ?? null,
      owner_user_id: userId,
      mode: 'spontaneous',
      title: null,
      duration_min: input.duration_min,
      start_lat: input.lat ?? null,
      start_lng: input.lng ?? null,
      route,
      status: 'generating',
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'tours');
  const tourId = tour.id as string;
  const firstLine = `Buscando qué hay adentro de ${input.venue_name}…`;
  const jobId = await createJob(admin, { kind: 'generate_tour', trip_id: input.trip_id ?? null, user_id: userId, firstLine });
  return {
    job_id: jobId,
    tour_id: tourId,
    run: () => runIndoorTour({ jobId, tourId, input, ctx, firstLine }, { ...defaultIndoorDeps(), ...deps }),
  };
}

export async function runIndoorTour(
  args: { jobId: string; tourId: string; input: ToolInput<'generate_indoor_tour'>; ctx: ToolCtx; firstLine: string },
  deps: IndoorDeps,
): Promise<GenerateTourResult> {
  const { jobId, tourId, input, ctx } = args;
  const { admin } = ctx;
  const t0 = Date.now();
  const usage = emptyUsage();
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: args.firstLine }]);
  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => 'Sigo investigando el lugar…');
  const ctrl = new AbortController();
  const budget = setTimeout(() => ctrl.abort(), BUDGET_MS);
  const stats: GenerateTourResult['stats'] = { web_search_calls: 0, places_reused: 0, places_new: 0, facts_verified: 0, facts_rejected: 0, facts_cited: 0, sentences_dropped: 0 };
  let title: string | null = null;
  let stopCount = 0;
  let fatal: string | null = null;
  try {
    // 1) El lugar.
    const near = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const venueRef = await deps.ensureVenue(admin, { name: input.venue_name, near, language: input.language });
    const { data: venueRow } = venueRef
      ? await admin.from('place_library').select('id,name,lat,lng,city').eq('id', venueRef.id).maybeSingle()
      : { data: null };
    const venueLat = (venueRow?.lat as number | null | undefined) ?? input.lat ?? null;
    const venueLng = (venueRow?.lng as number | null | undefined) ?? input.lng ?? null;
    if (venueLat == null || venueLng == null) throw new JobError('venue_not_found', `No encontré «${input.venue_name}».`);
    const venue = { name: (venueRow?.name as string | undefined) ?? input.venue_name, lat: venueLat, lng: venueLng, place_id: (venueRow?.id as string | undefined) ?? null };
    const city = (venueRow?.city as string | null | undefined) ?? null;

    // 2) Qué hay adentro.
    void progress.push(`Investigando ${venue.name} por dentro…`);
    const researchUser = renderIndoorResearchUser({ venue: venue.name, city, notes: input.notes, durationMin: input.duration_min });
    let found = await deps.research({ user: researchUser, signal: ctrl.signal });
    addUsage(usage, found.usage);
    stats.web_search_calls = found.web_search_calls;
    // A veces termina sin llamar report_points (o sin puntos): un reintento, pidiéndolo explícito.
    if (!found.value?.points.length && Date.now() - t0 < BUDGET_MS / 2) {
      console.warn(`[indoor_tour/${jobId}] la investigación no reportó puntos; reintento`);
      void progress.push('Sigo buscando qué hay adentro…');
      found = await deps.research({
        user: `${researchUser}\n\nAl terminar de buscar, llamá report_points con lo que haya (aunque sean puntos generales: salas, colección, edificio).`,
        signal: ctrl.signal,
      });
      addUsage(usage, found.usage);
      stats.web_search_calls += found.web_search_calls;
    }
    if (!found.value?.venue_found || !found.value.points.length) throw new JobError('nothing_found', `No encontré información confiable de ${venue.name} por dentro.`);

    // 3) Verificación.
    void progress.push(`Encontré ${found.value.points.length} puntos, verificando cada dato con su fuente…`);
    const v = await verifyPoints(venue.name, found.value.points, deps, usage);
    stats.facts_verified = v.verified;
    stats.facts_rejected = v.rejected;
    if (v.points.length < MIN_POINTS) throw new JobError('generate_failed', `Solo pude verificar ${v.points.length} puntos de ${venue.name}.`);
    void progress.push(`Verifiqué ${v.verified} datos${v.rejected ? ` (descarté ${v.rejected})` : ''}. Escribiendo…`);

    // 4) Narraciones.
    const w = await deps.write(renderWriterUser(venue.name, v.points, input.language));
    addUsage(usage, w.usage);
    const drafts = finishStops(venue.name, v.points, w.value);
    if (drafts.length < MIN_POINTS) throw new JobError('generate_failed', 'No quedaron suficientes paradas con datos respaldados.');
    stats.sentences_dropped = drafts.reduce((n, d) => n + d.dropped, 0);
    stats.facts_cited = drafts.reduce((n, d) => n + d.sources.length, 0);
    title = w.value.title?.trim() || `${venue.name} por dentro`;

    // 5) Escritura: place_library por punto (memoria compartida; nunca se pisan facts) → tour_stops → tours.
    const now = new Date().toISOString();
    const dwell = Math.max(3, Math.round(input.duration_min / drafts.length) - 1);
    const stopRows: Record<string, unknown>[] = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const facts: LibraryFact[] = d.point.facts.map((f) => ({ text: f.text, source_url: f.source_url, verified: true, quote: f.quote, verified_at: now, origin: 'tour' }));
      const { data: same } = await admin
        .from('place_library')
        .select('id,tier')
        .eq('name', d.point.name)
        .eq('lat', venue.lat)
        .eq('lng', venue.lng)
        .maybeSingle();
      let placeId = (same?.id as string | undefined) ?? null;
      if (placeId) {
        stats.places_reused++;
        if (same?.tier !== 'curated') await appendFacts(admin, placeId, facts);
      } else {
        const { data: ins, error: eIns } = await admin
          .from('place_library')
          .insert({ name: d.point.name, lat: venue.lat, lng: venue.lng, city, tier: 'researched', facts, base_lang: input.language })
          .select('id')
          .single();
        if (eIns) throw dbError(eIns, 'place_library');
        placeId = ins.id as string;
        stats.places_new++;
      }
      stopRows.push({
        id: randomUUID(),
        tour_id: tourId,
        place_id: placeId,
        sort_order: i + 1,
        geofence_radius_m: 30,
        dwell_min: dwell,
        look_at: d.look_at,
        narration_short: d.narration_short,
        narration_more: d.narration_more,
        transition_to_next: d.transition_to_next,
        nav_to_next: d.nav_to_next,
        sources: d.sources,
      });
    }
    const { error: eStops } = await admin.from('tour_stops').insert(stopRows);
    if (eStops) throw dbError(eStops, 'tour_stops');
    const route: TourRoute = { polyline: null, total_walk_m: 0, est_duration_min: input.duration_min, positioning: 'manual', indoor: true, venue };
    const { error: eTour } = await admin
      .from('tours')
      .update({ title, status: 'ready', route, start_lat: venue.lat, start_lng: venue.lng })
      .eq('id', tourId);
    if (eTour) throw dbError(eTour, 'tours');
    if (input.trip_id) {
      await insertFeed(ctx, {
        trip_id: input.trip_id,
        kind: 'tour_generated',
        payload: { summary: `El Scout armó «${title}», un recorrido por dentro de ${venue.name} con ${stopRows.length} paradas`, tour_id: tourId },
        undoable: false,
      });
    }
    stopCount = stopRows.length;
  } catch (err) {
    console.error(`[indoor_tour/${jobId}]`, err);
    fatal = ctrl.signal.aborted ? 'La investigación tardó demasiado.' : err instanceof Error ? err.message.slice(0, 300) : String(err);
  } finally {
    clearTimeout(budget);
    progress.stopHeartbeat();
  }

  const result: GenerateTourResult = {
    tour_id: tourId,
    stop_count: stopCount,
    total_walk_m: 0,
    est_duration_min: input.duration_min,
    stats: { ...stats, duration_ms: Date.now() - t0 },
    title,
    thesis: null,
    usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens },
  };
  console.log(`[indoor_tour/${jobId}] ${fatal ? `falló: ${fatal}` : `${stopCount} paradas`} · ${Math.round((Date.now() - t0) / 1000)} s · ~USD ${estimateCostUsd(usage)}`);
  if (fatal) {
    await admin.from('tours').update({ status: 'failed' }).eq('id', tourId);
    await progress.push(`Se trancó: ${fatal}`);
    await progress.set({ status: 'failed', error: fatal, result });
  } else {
    await progress.push(`¡Listo! «${title}» · ${stopCount} paradas`);
    await progress.set({ status: 'done', error: null, result });
  }
  await progress.flush();
  return result;
}
