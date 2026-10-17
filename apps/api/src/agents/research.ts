// research (voz): "no lo sé, lo averiguo y te cuento". Job en segundo plano con presupuesto de tiempo:
//   1) investigar: Claude + web_search/web_fetch → datos atómicos con su URL (captureViaTool, PRD 06)
//   2) verificar EN PARALELO cada dato contra su URL (verifyFact + VERIFY_SYSTEM del generador de tours)
//   3) responder en ≤60 palabras SOLO con lo verificado (sin herramientas)
//   4) si es sobre un lugar de place_library, sumar los facts verificados (los usan la cámara y los tours)
// La voz escucha el job por Realtime y recibe [EVENTO:research_ready].
import { z } from 'zod';
import type { ResearchResult, ToolInput } from '@build101/shared';
import { createJob, JobProgress } from '../jobs';
import type { ToolCtx } from '../tools/types';
import { anthropicClient, PLANNER_MODEL, textOf, type AnyBlock } from './llm';
import { addUsage, emptyUsage, type Usage } from './schemas';
import { anthropicTourLlm, captureViaTool, type TourLlmConfig } from './tourLlm';
import { renderVerifyUser, VERIFY_SYSTEM } from './tourPrompts';
import { ResearchOutput, type ResearchOutputT } from './tourSchemas';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

/** Tope total (Vercel corta a los 300 s; la voz espera "un ratito", no minutos). */
const BUDGET_MS = 75_000;
const MAX_FACTS = 5;

export const RESEARCH_Q_SYSTEM = `Sos el investigador de una app de viajes rioplatense. Te hacen UNA pregunta concreta (un año, un origen, quién, por qué, una curiosidad) sobre un lugar o tema. Buscala con web_search y web_fetch en fuentes confiables (Wikipedia, sitios oficiales, prensa seria) y reportá con report_facts entre 1 y ${MAX_FACTS} datos atómicos que respondan la pregunta, cada uno con la URL exacta donde aparece. Un dato por fact, escrito tal cual lo respalda la fuente. No inventes ni completes: si no encontrás nada confiable, reportá facts vacío.`;

export function renderResearchQUser(i: Pick<ToolInput<'research'>, 'question' | 'place_name' | 'lat' | 'lng'>): string {
  const where = i.lat != null && i.lng != null ? ` (cerca de ${i.lat.toFixed(4)}, ${i.lng.toFixed(4)})` : '';
  return `Pregunta: ${i.question}${i.place_name ? `\nLugar: ${i.place_name}${where}` : where ? `\nUbicación de la persona${where}` : ''}`;
}

const AnswerOut = z.object({ answer: z.string() });

export const ANSWER_SYSTEM = `Sos un guía de viaje que habla en voz alta. Respondé la pregunta en máximo 60 palabras, en tono hablado, usando SOLO los datos verificados que te paso (podés reordenarlos y conectarlos, no agregar años, nombres ni cifras que no estén). Si los datos no alcanzan para responder del todo, decí qué sí se sabe. No menciones fuentes ni "los datos".`;

export interface ResearchLLM {
  research(args: { question: ToolInput<'research'>; config: TourLlmConfig; signal: AbortSignal }): Promise<{ facts: ResearchOutputT['facts']; usage: Usage }>;
  verify(args: { fact: { text: string; source_url: string }; config: TourLlmConfig }): Promise<{ supported: boolean; usage: Usage }>;
  answer(args: { question: string; facts: { text: string }[]; language: string }): Promise<{ answer: string; usage: Usage }>;
}

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
      });
      return { facts: (r.value?.facts ?? []).slice(0, MAX_FACTS), usage: r.usage };
    },
    async verify({ fact, config }) {
      const v = await tour.verifyFact({ system: VERIFY_SYSTEM, user: renderVerifyUser(fact), config });
      return { supported: !!(v.result?.supported && v.result.quote.trim()), usage: v.usage };
    },
    async answer({ question, facts, language }) {
      const client = anthropicClient();
      const format = betaZodOutputFormat(AnswerOut);
      const params = {
        model: PLANNER_MODEL,
        max_tokens: 800,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: format.schema } },
        system: [{ type: 'text', text: ANSWER_SYSTEM }],
        messages: [
          {
            role: 'user',
            content: `Idioma: ${language}\nPregunta: ${question}\nDatos verificados:\n${facts.map((f) => `- ${f.text}`).join('\n')}`,
          },
        ],
      };
      const msg = (await client.beta.messages.create(params as never)) as unknown as { content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
      return { answer: format.parse(textOf(msg.content)).answer, usage: addUsage(emptyUsage(), msg.usage) };
    },
  };
}

const RESEARCH_CONFIG: TourLlmConfig = { effort: 'medium', maxTokens: 8000, maxIterations: 8, fallbacks: true };
const VERIFY_CONFIG: TourLlmConfig = { effort: 'low', maxTokens: 4000, maxIterations: 4, fallbacks: true };

type Fact = { text: string; source_url: string; verified?: boolean };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Suma facts verificados a place_library sin duplicar por texto. Devuelve cuántos agregó. */
export function mergeFacts(existing: Fact[] | null, add: { text: string; source_url: string }[]): { facts: Fact[]; added: number } {
  const list = [...(existing ?? [])];
  const seen = new Set(list.map((f) => norm(f.text)));
  let added = 0;
  for (const f of add) {
    if (seen.has(norm(f.text))) continue;
    seen.add(norm(f.text));
    list.push({ text: f.text, source_url: f.source_url, verified: true });
    added++;
  }
  return { facts: list, added };
}

/** place_library por nombre (sin tildes ni mayúsculas), el más cercano si hay ubicación. */
async function findPlaceId(ctx: ToolCtx, input: ToolInput<'research'>): Promise<string | null> {
  if (!input.place_name) return null;
  const words = norm(input.place_name).split(' ').filter((w) => w.length > 3);
  if (!words.length) return null;
  const { data } = await ctx.admin.from('place_library').select('id,name,lat,lng').ilike('name', `%${words.sort((a, b) => b.length - a.length)[0]}%`).limit(10);
  const rows = ((data ?? []) as { id: string; name: string | null; lat: number | null; lng: number | null }[]).filter((p) =>
    words.every((w) => norm(p.name ?? '').includes(w)),
  );
  if (!rows.length) return null;
  if (input.lat == null || input.lng == null) return rows[0].id;
  const d = (p: { lat: number | null; lng: number | null }) => (p.lat == null || p.lng == null ? Infinity : (p.lat - input.lat!) ** 2 + (p.lng - input.lng!) ** 2);
  return rows.sort((a, b) => d(a) - d(b))[0].id;
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

export async function runResearch(args: { jobId: string; input: ToolInput<'research'>; ctx: ToolCtx; llm: ResearchLLM }): Promise<ResearchResult> {
  const { jobId, input, ctx, llm } = args;
  const progress = new JobProgress(ctx.admin, jobId, [{ at: new Date().toISOString(), text: 'Investigando…' }]);
  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => 'Sigo investigando…');
  const ctrl = new AbortController();
  const budget = setTimeout(() => ctrl.abort(), BUDGET_MS);
  const t0 = Date.now();
  try {
    const { data: profile } = await ctx.admin.from('profiles').select('locale').eq('id', ctx.userId).maybeSingle();
    const language = input.language ?? (profile?.locale as string | undefined) ?? 'es';

    // La voz suele mandar el nombre del lugar sin id: lo buscamos en place_library cerca (si no, no se guarda nada).
    const placeId = input.place_id ?? (await findPlaceId(ctx, input));
    const found = await llm.research({ question: input, config: RESEARCH_CONFIG, signal: ctrl.signal });
    void progress.push(`Encontré ${found.facts.length} datos, verificando…`);

    // Verificación en paralelo, con lo que quede del presupuesto (lo que no termina a tiempo, no cuenta).
    const remaining = Math.max(5_000, BUDGET_MS - (Date.now() - t0));
    const checks = await Promise.all(
      found.facts.map((fact) =>
        Promise.race([
          llm.verify({ fact, config: VERIFY_CONFIG }).then((v) => v.supported).catch(() => false),
          new Promise<boolean>((r) => setTimeout(() => r(false), remaining)),
        ]),
      ),
    );
    const verified = found.facts.filter((_, i) => checks[i]);
    const rejected = found.facts.length - verified.length;

    const answer = verified.length ? (await llm.answer({ question: input.question, facts: verified, language })).answer : '';

    let saved = 0;
    if (placeId && verified.length) {
      const { data: place } = await ctx.admin.from('place_library').select('facts').eq('id', placeId).maybeSingle();
      if (place) {
        const merged = mergeFacts(place.facts as Fact[] | null, verified);
        if (merged.added) {
          const { error } = await ctx.admin.from('place_library').update({ facts: merged.facts, updated_at: new Date().toISOString() }).eq('id', placeId);
          if (error) console.warn('[research] place_library:', error.message);
          else saved = merged.added;
        }
      }
    }

    const result: ResearchResult = {
      question: input.question,
      answer,
      facts: verified.map((f) => ({ text: f.text, source_url: f.source_url })),
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
