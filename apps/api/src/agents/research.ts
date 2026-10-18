// research (voz): "no lo sé, lo averiguo y te cuento".
//   0) memoria: si el lugar ya está en place_library con facts verificados que responden la pregunta, contesta al toque
//      (sin job, sin web_search)
//   1) investigar: Claude + web_search/web_fetch → datos atómicos con su URL (captureViaTool, PRD 06)
//   2) verificar EN PARALELO cada dato contra su URL (verifyFact + VERIFY_SYSTEM del generador de tours)
//   3) responder (hasta ~130 palabras, con detalle) SOLO con lo verificado (sin herramientas)
//   4) guardar en place_library (crea el lugar si no existía): quote, verified_at, origin, question
// La voz escucha el job por Realtime y recibe [EVENTO:research_ready].
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ResearchResult, ToolInput } from '@build101/shared';
import { createJob, JobProgress } from '../jobs';
import { appendFacts, ensurePlace, findPlaceByName, type LibraryFact } from '../places/library';
import type { ToolCtx } from '../tools/types';
import { anthropicClient, PLANNER_MODEL, textOf, type AnyBlock } from './llm';
import { addUsage, emptyUsage, type Usage } from './schemas';
import { anthropicTourLlm, captureViaTool, type TourLlmConfig } from './tourLlm';
import { fetchPageText } from '../google/pageText';
import { quoteInText } from './tourCheck';
import { renderVerifyUser, VERIFY_SYSTEM } from './tourPrompts';
import { ResearchOutput, type ResearchOutputT } from './tourSchemas';

/** Tope total (Vercel corta a los 300 s; la voz espera "un ratito", no minutos). */
const BUDGET_MS = 90_000;
const MAX_FACTS = 8;

export const RESEARCH_Q_SYSTEM = `Sos el investigador de una app de viajes rioplatense. Te hacen UNA pregunta concreta (un año, un origen, quién, por qué, una curiosidad) sobre un lugar o tema. Buscala con web_search y web_fetch en fuentes confiables (Wikipedia, sitios oficiales, prensa seria; abrí las mejores páginas y sacá todo lo útil) y reportá con report_facts entre 1 y ${MAX_FACTS} datos atómicos que respondan la pregunta de la forma más completa posible, cada uno con la URL exacta donde aparece, el título de la fuente y una frase copiada TEXTUAL de esa página que lo respalde (se chequea automáticamente). Un dato por fact, escrito tal cual lo respalda la fuente. No inventes ni completes: si no encontrás nada confiable, reportá facts vacío.`;

export function renderResearchQUser(i: Pick<ToolInput<'research'>, 'question' | 'place_name' | 'lat' | 'lng'>): string {
  const where = i.lat != null && i.lng != null ? ` (cerca de ${i.lat.toFixed(4)}, ${i.lng.toFixed(4)})` : '';
  return `Pregunta: ${i.question}${i.place_name ? `\nLugar: ${i.place_name}${where}` : where ? `\nUbicación de la persona${where}` : ''}`;
}

const AnswerOut = z.object({ answer: z.string() });
const CacheOut = z.object({
  answerable: z.boolean().describe('true solo si los datos responden la pregunta (lo central, no algo parecido)'),
  answer: z.string().describe('Respuesta hablada (hasta 130 palabras) con esos datos; vacío si answerable=false'),
});

export const ANSWER_SYSTEM = `Sos un guía de viaje que habla en voz alta. Respondé la pregunta en tono hablado, completo y con detalle (hasta 130 palabras: todo lo que los datos permitan contar, sin relleno), usando SOLO los datos verificados que te paso (podés reordenarlos y conectarlos, no agregar años, nombres ni cifras que no estén). Si los datos no alcanzan para responder del todo, decí qué sí se sabe. No menciones fuentes ni "los datos".`;
export const CACHE_SYSTEM = `Te paso una pregunta y los datos verificados que ya tenemos de un lugar. Decidí si esos datos responden la pregunta (lo que se pregunta concretamente, no algo parecido). Si sí, respondé en tono hablado, completo y con detalle (hasta 130 palabras) usando SOLO esos datos. Si no alcanzan, answerable=false.`;

export type VerifiedFact = { text: string; source_url: string; quote: string };

export interface ResearchLLM {
  research(args: { question: ToolInput<'research'>; config: TourLlmConfig; signal: AbortSignal }): Promise<{ facts: ResearchOutputT['facts']; usage: Usage }>;
  verify(args: { fact: { text: string; source_url: string; quote?: string }; config: TourLlmConfig }): Promise<{ supported: boolean; quote: string; usage: Usage }>;
  answer(args: { question: string; facts: { text: string }[]; language: string }): Promise<{ answer: string; usage: Usage }>;
  fromMemory(args: { question: string; facts: { text: string }[]; language: string }): Promise<{ answerable: boolean; answer: string }>;
}

/** Modelo para las respuestas cortas (memoria / respuesta final): el rápido de visión si está configurado. */
function fastModel(): string {
  return process.env.RESEARCH_FAST_MODEL?.trim() || process.env.VISION_MODEL?.trim() || PLANNER_MODEL;
}

async function structured<T extends z.ZodType>(schema: T, system: string, user: string, model: string): Promise<z.infer<T>> {
  const client = anthropicClient();
  const format = betaZodOutputFormat(schema);
  const params = {
    model,
    max_tokens: 1500,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: format.schema } },
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  };
  const msg = (await client.beta.messages.create(params as never)) as unknown as { content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
  return format.parse(textOf(msg.content)) as z.infer<T>;
}

const factsBlock = (facts: { text: string }[]) => facts.map((f) => `- ${f.text}`).join('\n');

export function anthropicResearchLlm(): ResearchLLM {
  const tour = anthropicTourLlm();
  return {
    async research({ question, config, signal }) {
      const r = await captureViaTool<ResearchOutputT>({
        system: RESEARCH_Q_SYSTEM,
        user: renderResearchQUser(question),
        captureName: 'report_facts',
        captureDescription: 'Reportá los datos atómicos que responden la pregunta, cada uno con su URL exacta.',
        captureSchema: ResearchOutput,
        serverTools: ['web_search', 'web_fetch'],
        config,
        signal,
        maxUses: 5,
      });
      return { facts: (r.value?.facts ?? []).slice(0, MAX_FACTS), usage: r.usage };
    },
    async verify({ fact, config }) {
      // Rápido: si la página se puede bajar, la cita se chequea en código (sin otra vuelta de Claude).
      if (fact.quote?.trim()) {
        const page = await fetchPageText(fact.source_url);
        if (page) return { supported: quoteInText(fact.quote, page), quote: fact.quote, usage: emptyUsage() };
      }
      const v = await tour.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(fact), config });
      const quote = v.result?.quote?.trim() ?? '';
      return { supported: !!(v.result?.supported && quote), quote, usage: v.usage };
    },
    async answer({ question, facts, language }) {
      const out = await structured(AnswerOut, ANSWER_SYSTEM, `Idioma: ${language}\nPregunta: ${question}\nDatos verificados:\n${factsBlock(facts)}`, PLANNER_MODEL);
      return { answer: out.answer, usage: emptyUsage() };
    },
    async fromMemory({ question, facts, language }) {
      return structured(CacheOut, CACHE_SYSTEM, `Idioma: ${language}\nPregunta: ${question}\nDatos verificados del lugar:\n${factsBlock(facts)}`, fastModel());
    },
  };
}

const RESEARCH_CONFIG: TourLlmConfig = { effort: 'medium', maxTokens: 8000, maxIterations: 8, fallbacks: true };
const VERIFY_CONFIG: TourLlmConfig = { effort: 'low', maxTokens: 4000, maxIterations: 4, fallbacks: true };

const near = (i: ToolInput<'research'>) => (i.lat != null && i.lng != null ? { lat: i.lat, lng: i.lng } : null);

/** El lugar ya conocido de la pregunta (por id o por nombre). No crea nada. */
async function knownPlaceId(ctx: ToolCtx, input: ToolInput<'research'>): Promise<string | null> {
  if (input.place_id) return input.place_id;
  if (!input.place_name) return null;
  return findPlaceByName(ctx.admin, input.place_name, near(input));
}

async function language(ctx: ToolCtx, input: ToolInput<'research'>): Promise<string> {
  if (input.language) return input.language;
  const { data } = await ctx.admin.from('profiles').select('locale').eq('id', ctx.userId).maybeSingle();
  return (data?.locale as string | undefined) ?? 'es';
}

export type MemoryHit = { cached: true; answer: string; facts: { text: string; source_url: string; quote?: string }[]; place_id: string };

/** Paso 0: ¿la memoria (place_library) ya responde? null si no (o si falla: se investiga igual). */
export async function answerFromMemory(input: ToolInput<'research'>, ctx: ToolCtx, llm: ResearchLLM = anthropicResearchLlm()): Promise<MemoryHit | null> {
  try {
    const placeId = await knownPlaceId(ctx, input);
    if (!placeId) return null;
    const { data } = await ctx.admin.from('place_library').select('facts').eq('id', placeId).maybeSingle();
    const facts = ((data?.facts ?? []) as LibraryFact[]).filter((f) => f.verified && f.text && f.source_url);
    if (!facts.length) return null;
    const r = await llm.fromMemory({ question: input.question, facts, language: await language(ctx, input) });
    if (!r.answerable || !r.answer.trim()) return null;
    return {
      cached: true,
      answer: r.answer,
      facts: facts.map((f) => ({ text: f.text, source_url: f.source_url, ...(f.quote ? { quote: f.quote } : {}) })),
      place_id: placeId,
    };
  } catch (e) {
    console.warn('[research] memoria:', (e as Error).message);
    return null;
  }
}

export async function startResearch(input: ToolInput<'research'>, ctx: ToolCtx, llm: ResearchLLM = anthropicResearchLlm()) {
  const jobId = await createJob(ctx.admin, {
    kind: 'research',
    trip_id: input.trip_id ?? null,
    user_id: ctx.userId,
    firstLine: 'Investigando…',
  });
  return { job_id: jobId, run: () => runResearch({ jobId, input, ctx, llm }) };
}

export async function runResearch(args: {
  jobId: string;
  input: ToolInput<'research'>;
  ctx: ToolCtx;
  llm: ResearchLLM;
  ensure?: typeof ensurePlace;
}): Promise<ResearchResult> {
  const { jobId, input, ctx, llm } = args;
  const ensure = args.ensure ?? ensurePlace;
  const progress = new JobProgress(ctx.admin, jobId, [{ at: new Date().toISOString(), text: 'Investigando…' }]);
  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => 'Sigo investigando…');
  const ctrl = new AbortController();
  const budget = setTimeout(() => ctrl.abort(), BUDGET_MS);
  const t0 = Date.now();
  try {
    const lang = await language(ctx, input);
    const found = await llm.research({ question: input, config: RESEARCH_CONFIG, signal: ctrl.signal });
    void progress.push(`Encontré ${found.facts.length} datos, verificando…`);

    // Verificación en paralelo, con lo que quede del presupuesto (lo que no termina a tiempo, no cuenta).
    const remaining = Math.max(5_000, BUDGET_MS - (Date.now() - t0));
    const checks = await Promise.all(
      found.facts.map((fact) =>
        Promise.race([
          llm.verify({ fact, config: VERIFY_CONFIG }).catch(() => ({ supported: false, quote: '' })),
          new Promise<{ supported: false; quote: '' }>((r) => setTimeout(() => r({ supported: false, quote: '' }), remaining)),
        ]),
      ),
    );
    const verified: VerifiedFact[] = found.facts.flatMap((f, i) => (checks[i].supported ? [{ ...f, quote: checks[i].quote }] : []));
    const rejected = found.facts.length - verified.length;

    const answer = verified.length ? (await llm.answer({ question: input.question, facts: verified, language: lang })).answer : '';

    // Memoria: al lugar (si no existía y es un lugar, se crea con sus coordenadas reales).
    let placeId = await knownPlaceId(ctx, input);
    let saved = 0;
    if (verified.length) {
      if (!placeId && input.place_name) placeId = (await ensure(ctx.admin, { name: input.place_name, near: near(input), language: lang }))?.id ?? null;
      if (placeId) {
        const now = new Date().toISOString();
        saved = await appendFacts(
          ctx.admin,
          placeId,
          verified.map((f) => ({ text: f.text, source_url: f.source_url, verified: true, quote: f.quote, verified_at: now, origin: 'research', question: input.question })),
        );
      }
    }

    const result: ResearchResult = {
      question: input.question,
      answer,
      facts: verified.map((f) => ({ text: f.text, source_url: f.source_url, quote: f.quote })),
      rejected,
      place_id: placeId,
      saved_facts: saved,
    };
    console.log(`[research/${jobId}] ${Date.now() - t0} ms · ${verified.length}/${found.facts.length} verificados · guardados ${saved}`);
    await progress.push(verified.length ? `Listo: ${verified.length} datos verificados` : 'No encontré fuentes confiables');
    await progress.set({ status: 'done', error: null, result });
    return result;
  } catch (err) {
    const msg = ctrl.signal.aborted ? 'La búsqueda tardó demasiado' : (err as Error).message.slice(0, 300);
    await progress.push('No pude investigarlo');
    await progress.set({ status: 'failed', error: msg });
    throw err;
  } finally {
    clearTimeout(budget);
    progress.stopHeartbeat();
    await progress.flush();
  }
}
