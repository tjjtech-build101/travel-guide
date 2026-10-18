// Entrevista (trip_brief) y formas del viaje (trip_shapes) del planificador colaborativo (PRD 31 v2).
// - tripBrief: entrevista adaptativa en rondas (1-3). Una llamada con salida estructurada (effort low en la ronda 1,
//   medium en 2-3) → lo entendido + coverage + 0-4 preguntas generadas para ESTE viaje + done. El servidor deduplica
//   contra lo ya preguntado (ver parseAskedQuestions: formato `[q:id/dimension] texto` en los mensajes assistant).
//   El contexto ("Lo que tengo en cuenta") es determinístico. Precalienta el catálogo y, si hay anclas y done, la
//   investigación del calendario (anchors.ts), en segundo plano.
// - tripShapes: (lo entendido, cacheado o re-extraído) → anclas investigadas con web search → 2-3 formas armadas
//   ALREDEDOR de las anclas; cada una pasa por normalizeSkeleton. Si la investigación falla, sigue sin anclas
//   verificadas (assumptions lo dice).
import {
  combineInterestWeights,
  INTEREST_TAGS,
  TRIP_DIMENSIONS,
  TRIP_KINDS,
  type InterestTag,
  type ToolInput,
  type TripAnchor,
  type TripBriefResult,
  type TripDimension,
  type TripQuestion,
  type TripShape,
  type TripShapesResult,
  type TripUnderstanding,
} from '@build101/shared';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { dbError, ToolFailure } from '../../errors';
import { searchPlaces } from '../../google/places';
import { runInBackground } from '../../jobs';
import type { Db } from '../../supabase';
import type { ToolCtx } from '../../tools/types';
import { isIsoDate, todayIso } from '../dates';
import { anthropicClient, fallbackParams, JobError, PLANNER_MODEL, textOf, type AnyBlock, type Effort } from '../llm';
import { normalizeSkeleton } from '../planTrip';
import { addUsage, emptyUsage, type Usage } from '../schemas';
import { type AnchorResearch, hasAnchors, researchAnchors } from './anchors';
import {
  type AskedQuestion,
  BRIEF_SYSTEM,
  BriefOutput,
  type BriefOutputT,
  type BriefProfileLine,
  parseQuestionTag,
  renderBriefUser,
  SHAPES_SYSTEM,
  ShapesOutput,
  type ShapesOutputT,
  type ShapeVariantT,
} from './briefPrompts';
import { loadPlannerModules } from './runtime';

// ───────────────────────── LLM

export type BriefLlmConfig = { effort: Effort; maxTokens: number; fallbacks: boolean };

export type BriefCall = { system: string; user: string; config: BriefLlmConfig; signal?: AbortSignal };

export interface BriefLLM {
  brief(args: BriefCall): Promise<{ value: BriefOutputT; usage: Usage }>;
  shapes(args: BriefCall): Promise<{ value: ShapesOutputT; usage: Usage }>;
}

async function structured<S extends Parameters<typeof betaZodOutputFormat>[0]>(
  schema: S,
  { system, user, config, signal }: BriefCall,
  what: string,
): Promise<{ value: import('zod').infer<S>; usage: Usage }> {
  const client = anthropicClient();
  const format = betaZodOutputFormat(schema);
  const params = {
    model: PLANNER_MODEL,
    max_tokens: config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort, format: { type: 'json_schema', schema: format.schema } },
    ...fallbackParams(config),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  const msg = (await client.beta.messages.create(
    params as unknown as Parameters<typeof client.beta.messages.create>[0],
    (signal ? { signal } : {}) as never,
  )) as unknown as { stop_reason: string | null; content: AnyBlock[]; usage: Parameters<typeof addUsage>[1] };
  const usage = addUsage(emptyUsage(), msg.usage);
  if (msg.stop_reason === 'refusal') throw new JobError('brief_failed', `Claude no quiso armar ${what} (refusal).`);
  if (msg.stop_reason === 'max_tokens') throw new JobError('brief_failed', `${what}: la respuesta quedó cortada.`);
  try {
    return { value: format.parse(textOf(msg.content)) as import('zod').infer<S>, usage };
  } catch (err) {
    throw new JobError('brief_failed', `No pude leer ${what}: ${(err as Error).message.slice(0, 200)}`);
  }
}

export function anthropicBriefLlm(): BriefLLM {
  return {
    async brief(call) {
      return structured(BriefOutput, call, 'la entrevista');
    },
    async shapes(call) {
      return structured(ShapesOutput, call, 'las formas del viaje');
    },
  };
}

export const BRIEF_CONFIG: BriefLlmConfig = { effort: 'low', maxTokens: 8000, fallbacks: true };
/** Rondas 2-3: preguntas más finas (medium). */
export const BRIEF_FOLLOWUP_CONFIG: BriefLlmConfig = { effort: 'medium', maxTokens: 10000, fallbacks: true };
export const SHAPES_CONFIG: BriefLlmConfig = { effort: 'medium', maxTokens: 16000, fallbacks: true };

export const briefConfig = (round: number): BriefLlmConfig => (round <= 1 ? BRIEF_CONFIG : BRIEF_FOLLOWUP_CONFIG);

export type ResearchFn = (u: TripUnderstanding, opts: { today: string; timeoutMs: number; signal?: AbortSignal }) => Promise<AnchorResearch>;

export type BriefDeps = {
  llm: BriefLLM;
  today: () => string;
  /** Precalentar el catálogo de los destinos (segundo plano). null = no precalentar (tests). */
  warm: ((admin: Db, destinations: { city: string; country: string | null }[]) => void) | null;
  /** Tope de la llamada principal (ronda 1 de trip_brief; en 2-3 se usa el doble, hasta 30 s). */
  timeoutMs: number;
  /** Investigación de anclas (anchors.ts). Sin esto: no se investiga (las anclas quedan como las dijo el usuario). */
  research?: ResearchFn | null;
  /** Precalentar la investigación de anclas cuando la entrevista termina (segundo plano). Default: sí si hay research. */
  warmAnchors?: boolean;
};

export type ShapesDeps = Pick<BriefDeps, 'llm' | 'today' | 'timeoutMs' | 'research'> & {
  /** Tope de la re-extracción de lo entendido cuando no está cacheado (default 12 s). */
  understandTimeoutMs?: number;
  /** Tope de la investigación de anclas (default 25 s). */
  anchorsTimeoutMs?: number;
};

export function defaultBriefDeps(): BriefDeps {
  let llm: BriefLLM | null = null;
  return {
    get llm() {
      return (llm ??= anthropicBriefLlm());
    },
    today: () => todayIso(),
    warm: (admin, destinations) => runInBackground('trip_brief/warm', warmCatalogs(admin, destinations)),
    timeoutMs: 30_000, // ronda 1 real con Opus 5.5 effort low: ~15 s
    research: (u, opts) => researchAnchors(u, opts),
    warmAnchors: true,
  };
}

export function defaultShapesDeps(): ShapesDeps {
  // Peor caso ~80 s (re-extraer 12 + investigar 25 + formas 45); lo normal es ~45: lo entendido sale de la cache de
  // trip_brief y la investigación ya arrancó en segundo plano cuando terminó la entrevista.
  return { ...defaultBriefDeps(), timeoutMs: 90_000, understandTimeoutMs: 25_000, anchorsTimeoutMs: 30_000 };
}

// ───────────────────────── Precalentado del catálogo

/** Resuelve cada ciudad en Places (como resolveCity de planTrip) y pide el catálogo: queda cacheado para plan_trip. */
export async function warmCatalogs(admin: Db, destinations: { city: string; country: string | null }[]): Promise<void> {
  const m = await loadPlannerModules();
  const catalogDeps = m.defaultCatalogDeps();
  await Promise.all(
    destinations.slice(0, 4).map(async (d) => {
      try {
        let lat: number | null = null;
        let lng: number | null = null;
        try {
          const [p] = await searchPlaces({ query: [d.city, d.country].filter(Boolean).join(', '), radius_m: 3000, max_results: 1 });
          if (p && p.lat != null && p.lng != null) [lat, lng] = [p.lat, p.lng];
        } catch {
          // sin Places: el catálogo igual puede investigar por nombre
        }
        const r = await m.getCatalog(admin, { city: d.city, country: d.country, lat, lng }, catalogDeps);
        console.log(`[trip_brief] catálogo ${d.city}: ${r.items.length} ítems${r.cached ? ' (cache)' : ''}`);
      } catch (err) {
        console.warn(`[trip_brief] no pude precalentar ${d.city}:`, (err as Error).message);
      }
    }),
  );
}

// ───────────────────────── Contexto del viaje (perfiles)

type BriefMember = { user_id: string; name: string; organizer: boolean; interests: Record<string, number> | null; pace: string | null; dietary: string[]; avoid: string[]; budget: string | null };

const PACE_ES: Record<string, string> = { relaxed: 'tranqui', balanced: 'equilibrado', intense: 'intenso' };
const INTEREST_ES: Record<string, string> = {
  historia: 'historia',
  arquitectura: 'arquitectura',
  arte: 'arte',
  museos: 'museos',
  comida: 'comida',
  mercados: 'mercados',
  vida_nocturna: 'vida nocturna',
  musica: 'música',
  naturaleza: 'naturaleza',
  playa: 'playa',
  compras: 'compras',
  deporte: 'deporte',
  fotografia: 'fotografía',
  religion: 'religión',
  tecnologia: 'tecnología',
};

export async function loadBriefMembers(admin: Db, tripId: string | undefined, userId: string): Promise<{ members: BriefMember[]; legs: { city: string; start_date: string; end_date: string }[] }> {
  let ids = [userId];
  const roles = new Map<string, string>([[userId, 'organizer']]);
  let legs: { city: string; start_date: string; end_date: string }[] = [];
  if (tripId) {
    const [{ data: tm, error: e1 }, { data: lg, error: e2 }] = await Promise.all([
      admin.from('trip_members').select('user_id,role').eq('trip_id', tripId),
      admin.from('legs').select('city,start_date,end_date').eq('trip_id', tripId).order('sort_order'),
    ]);
    if (e1) throw dbError(e1, 'trip_members');
    if (e2) throw dbError(e2, 'legs');
    const travelers = ((tm ?? []) as { user_id: string; role: string }[]).filter((m) => m.role !== 'follower');
    ids = [...new Set([...travelers.map((m) => m.user_id), userId])];
    roles.clear();
    for (const m of travelers) roles.set(m.user_id, m.role);
    legs = (lg ?? []) as typeof legs;
  }
  const { data, error } = await admin.from('profiles').select('id,display_name,interests,pace,dietary,avoid,budget_level').in('id', ids);
  if (error) throw dbError(error, 'profiles');
  const members = ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    user_id: p.id as string,
    name: String(p.display_name ?? '').trim().split(/\s+/)[0] || 'Alguien',
    organizer: roles.get(p.id as string) === 'organizer',
    interests: (p.interests as Record<string, number> | null) ?? null,
    pace: (p.pace as string | null) ?? null,
    dietary: (p.dietary as string[] | null) ?? [],
    avoid: (p.avoid as string[] | null) ?? [],
    budget: (p.budget_level as string | null) ?? null,
  }));
  return { members, legs };
}

function profileLines(members: BriefMember[]): BriefProfileLine[] {
  return members.map((m) => {
    const bits: string[] = [];
    if (m.pace) bits.push(`ritmo ${PACE_ES[m.pace] ?? m.pace}`);
    const top = topInterests(m.interests ?? {}, 4);
    if (top.length) bits.push(`le interesa ${top.join(', ')}`);
    if (m.dietary.length) bits.push(`dieta: ${m.dietary.join(', ')}`);
    if (m.avoid.length) bits.push(`evita: ${m.avoid.join(', ')}`);
    if (m.budget) bits.push(`presupuesto ${m.budget}`);
    return { name: m.name, organizer: m.organizer, bits };
  });
}

function topInterests(weights: Record<string, number>, n: number): string[] {
  return Object.entries(weights)
    .filter(([k, w]) => (INTEREST_TAGS as readonly string[]).includes(k) && Number(w) >= 3)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, n)
    .map(([k]) => INTEREST_ES[k] ?? k);
}

// ───────────────────────── Puro: normalización de la entrevista

const nonEmpty = (xs: string[] | null | undefined) => (xs ?? []).map((s) => s.trim()).filter(Boolean);
const clip = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);
const slugId = (s: string) =>
  plain(s)
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 40);

/** Anclas que dijo el usuario: nunca investigadas acá (sin fuentes, sin hora ni sede; fecha solo si es ISO). */

/** El esquema de salida no lleva enums (límite de gramática de la API): los valores se validan acá. */
function oneOf<T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null {
  const x = (v ?? '').trim().toLowerCase();
  return (allowed as readonly string[]).includes(x) ? (x as T) : null;
}
const ANCHOR_KIND_VALUES = ['sports', 'concert', 'festival', 'wedding', 'conference', 'other'] as const;
const TICKETS_VALUES = ['have', 'want', 'watch_out', 'unknown'] as const;
const PARTY_VALUES = ['solo', 'couple', 'friends', 'family'] as const;
const BUDGET_VALUES = ['low', 'mid', 'high', 'no_limit'] as const;
const PACE_VALUES = ['relaxed', 'balanced', 'intense'] as const;
const QUESTION_KIND_VALUES = ['single', 'multi', 'text', 'date'] as const;
/** "yes" | "no" | "unknown" (o booleano, por compatibilidad) → boolean | null. */
function firstTime(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const x = String(v ?? '').trim().toLowerCase();
  return x === 'yes' || x === 'si' || x === 'sí' || x === 'true' ? true : x === 'no' || x === 'false' ? false : null;
}

export function normalizeBriefAnchors(anchors: BriefOutputT['understood']['anchors'] | null | undefined): TripAnchor[] {
  const out: TripAnchor[] = [];
  const seen = new Set<string>();
  for (const a of anchors ?? []) {
    const name = clip(a.name, 200);
    if (!name || out.length >= 6) continue;
    let id = slugId(a.id || name) || `ancla_${out.length + 1}`;
    while (seen.has(id)) id = `${id}_${out.length}`;
    seen.add(id);
    out.push({
      id,
      name,
      kind: oneOf(a.kind, ANCHOR_KIND_VALUES) ?? 'other',
      city: clip(a.city, 120),
      country: clip(a.country, 80),
      date: isIsoDate(a.date) ? a.date : null,
      time: null,
      venue: null,
      tickets: oneOf(a.tickets, TICKETS_VALUES) ?? 'unknown',
      researched: false,
      sources: [],
      note: clip(a.note, 400),
    });
  }
  return out;
}

export function normalizeUnderstanding(u: BriefOutputT['understood'], input: Pick<ToolInput<'trip_brief'>, 'start_date' | 'end_date'>): TripUnderstanding {
  const interests: Partial<Record<InterestTag, number>> = {};
  for (const { tag: rawTag, weight } of u.interests ?? []) {
    const tag = oneOf(rawTag, INTEREST_TAGS);
    if (!tag) continue;
    const w = Math.min(5, Math.max(1, Math.round(Number(weight) || 3)));
    interests[tag] = Math.max(interests[tag] ?? 0, w);
  }
  const date = (d: string | null | undefined) => (isIsoDate(d) ? d : null);
  const pos = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  const seen = new Set<string>();
  const anchors = normalizeBriefAnchors(u.anchors);
  return {
    destinations: (u.destinations ?? [])
      .map((d) => ({ city: d.city.trim(), country: d.country?.trim() || null }))
      .filter((d) => d.city && !seen.has(d.city.toLowerCase()) && seen.add(d.city.toLowerCase())),
    start_date: input.start_date ?? date(u.start_date),
    end_date: input.end_date ?? date(u.end_date),
    days: pos(u.days),
    travelers: pos(u.travelers),
    party: oneOf(u.party, PARTY_VALUES),
    names: nonEmpty(u.names),
    interests,
    must: nonEmpty(u.must),
    avoid: nonEmpty(u.avoid),
    budget: oneOf(u.budget, BUDGET_VALUES),
    pace: oneOf(u.pace, PACE_VALUES),
    first_time: firstTime(u.first_time),
    kids_ages: nonEmpty(u.kids_ages),
    arrival: u.arrival?.trim() || null,
    departure: u.departure?.trim() || null,
    lodging_booked: u.lodging_booked?.trim() || null,
    notes: nonEmpty(u.notes),
    trip_kind: oneOf(u.trip_kind, TRIP_KINDS) ?? (anchors.length ? 'event' : null),
    anchors,
    origin: clip(u.origin, 120),
  };
}

/** ¿La respuesta a esta dimensión ya está en lo que entendí? (red de seguridad: nunca preguntar lo que ya dijo). */
export function alreadyKnown(dimension: string, u: TripUnderstanding): boolean {
  switch (dimension) {
    case 'dates':
      return !!u.start_date;
    case 'duration':
      return u.days != null || (!!u.start_date && !!u.end_date);
    case 'travelers':
      return u.travelers != null || u.party === 'solo';
    case 'origin':
      return !!u.origin;
    case 'arrival':
      return !!u.arrival;
    case 'departure':
      return !!u.departure;
    case 'lodging':
      return !!u.lodging_booked;
    case 'budget':
      return !!u.budget;
    case 'pace':
      return !!u.pace;
    case 'first_time':
      return u.first_time !== null;
    case 'kids':
      return u.kids_ages.length > 0 || u.party === 'solo' || u.party === 'couple';
    case 'interests':
      return Object.keys(u.interests).length >= 2;
    case 'must':
      return u.must.length > 0;
    case 'avoid':
      return u.avoid.length > 0;
    default:
      return false;
  }
}

/**
 * Dimensiones de "una sola respuesta": con una pregunta alcanza, así que si ya se preguntó (o es known) no se vuelve
 * a preguntar aunque el id sea otro. Las demás (anchor, interests, extras, food, must, avoid, other) admiten varias
 * preguntas distintas en rondas distintas (ej. anchor: equipo, fase, entradas).
 */
const SINGLE_SLOT = new Set<string>(['dates', 'duration', 'travelers', 'origin', 'arrival', 'departure', 'lodging', 'budget', 'pace', 'first_time', 'kids', 'transport', 'mobility']);

export type Coverage = Partial<Record<TripDimension, 'known' | 'assumed' | 'unknown'>>;

/** coverage del modelo: texto "dates=known, budget=unknown" (v2: un string, no un array, por el límite de gramática). */
export function parseCoverage(cov: string | { dimension: string; status: string }[] | null | undefined): { dimension: string; status: string }[] {
  if (Array.isArray(cov)) return cov;
  return (cov ?? '')
    .split(/[,;\n]/)
    .map((p) => p.split(/[=:]/).map((x) => x.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([dimension, status]) => ({ dimension, status }));
}

export function normalizeCoverage(
  cov: string | { dimension: string; status: string }[] | null | undefined,
  u: TripUnderstanding,
  asked: AskedQuestion[],
): Coverage {
  const out: Coverage = {};
  for (const c of parseCoverage(cov)) {
    const dim = oneOf(c.dimension, TRIP_DIMENSIONS);
    const status = oneOf(c.status, ['known', 'assumed', 'unknown'] as const);
    if (dim && status) out[dim] = status;
  }
  for (const d of TRIP_DIMENSIONS) if (alreadyKnown(d, u)) out[d] = 'known';
  // Lo que ya se preguntó y se contestó cuenta como sabido (aunque el modelo diga otra cosa).
  for (const q of asked) {
    const d = q.dimension as TripDimension | null;
    if (d && q.answer && SINGLE_SLOT.has(d) && out[d] !== 'known') out[d] = 'assumed';
  }
  return out;
}

/** Texto comparable de una pregunta (sin marca, sin signos ni tildes). */
export const questionKey = (text: string) =>
  plain(parseQuestionTag(text)?.text ?? text)
    .replace(/[¿?¡!.,;:()"'«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Validación server-side de las preguntas de la ronda: dedupe por id/dimensión/texto contra lo ya preguntado y entre
 * sí, nunca lo que ya está known, máx. 4, opciones 2-6 (si no, pasa a text), default válido.
 */
export function normalizeQuestions(
  qs: BriefOutputT['questions'],
  u: TripUnderstanding,
  opts: { coverage?: Coverage; asked?: AskedQuestion[] } = {},
): TripQuestion[] {
  const asked = opts.asked ?? [];
  const coverage = opts.coverage ?? {};
  const askedIds = new Set(asked.map((a) => a.id).filter(Boolean) as string[]);
  const askedDims = new Set(asked.map((a) => a.dimension).filter((d): d is string => !!d && SINGLE_SLOT.has(d)));
  const askedTexts = new Set(asked.map((a) => questionKey(a.text)));
  const out: TripQuestion[] = [];
  for (const q of qs ?? []) {
    if (out.length >= 4) break;
    const text = q.text?.trim();
    if (!text) continue;
    const dimension: TripDimension = oneOf(q.dimension, TRIP_DIMENSIONS) ?? 'other';
    const id = slugId(q.id || dimension) || dimension;
    if (askedIds.has(id) || askedTexts.has(questionKey(text))) continue;
    if (out.some((x) => x.id === id || questionKey(x.text) === questionKey(text))) continue;
    if (alreadyKnown(dimension, u)) continue;
    if (SINGLE_SLOT.has(dimension) && (askedDims.has(dimension) || coverage[dimension] === 'known' || out.some((x) => x.dimension === dimension))) continue;
    const values = new Set<string>();
    const options = (q.options ?? [])
      .map((o) => ({ value: o.value?.trim() ?? '', label: o.label?.trim() ?? '' }))
      .filter((o) => o.value && o.label && !values.has(o.value) && values.add(o.value))
      .slice(0, 6);
    let kind = oneOf(q.kind, QUESTION_KIND_VALUES) ?? (q.options?.length ? 'single' : 'text');
    if ((kind === 'single' || kind === 'multi') && options.length < 2) kind = 'text';
    const valid = new Set(options.map((o) => o.value));
    const defaults = (q.default_values ?? []).map((v) => v.trim()).filter((v) => v && (!options.length || valid.has(v)));
    out.push({
      id,
      dimension,
      text,
      why: q.why?.trim() ?? '',
      kind,
      options: kind === 'text' ? [] : options,
      default: kind === 'multi' ? (defaults.length ? defaults : null) : (defaults[0] ?? null),
      optional: !!q.optional,
    });
  }
  return out;
}

// ───────────────────────── Preguntas ya hechas (formato de la conversación)

// Registro en memoria de las preguntas que emitimos (texto → id/dimensión): reconoce el formato v1 de mobile (solo
// el texto de la pregunta, sin marca) dentro del mismo proceso.
const ISSUED_MAX = 5000;
const issued = new Map<string, { id: string; dimension: TripDimension }>();

export function rememberQuestions(qs: TripQuestion[]): void {
  for (const q of qs) {
    const k = questionKey(q.text);
    if (!k) continue;
    issued.delete(k);
    issued.set(k, { id: q.id, dimension: q.dimension });
    if (issued.size > ISSUED_MAX) issued.delete(issued.keys().next().value!);
  }
}

export function clearIssuedQuestions(): void {
  issued.clear();
}

/**
 * Preguntas de rondas anteriores en la conversación. Cada pregunta es un mensaje `assistant` y su respuesta, el
 * mensaje `user` que sigue. Formato preferido: `[q:<id>/<dimension>] <texto>` (ver briefPrompts.questionMessage).
 * Sin marca: se reconoce por el registro de preguntas emitidas o, si no, cualquier assistant con "?" seguido de una
 * respuesta (id/dimensión desconocidos: se deduplica por texto). El saludo inicial (sin "?") no cuenta.
 */
export function parseAskedQuestions(conversation: { role: 'user' | 'assistant'; text: string }[]): AskedQuestion[] {
  const out: AskedQuestion[] = [];
  conversation.forEach((m, i) => {
    if (m.role !== 'assistant') return;
    const next = conversation[i + 1];
    const answer = next?.role === 'user' ? next.text.trim() || null : null;
    const tag = parseQuestionTag(m.text);
    if (tag) {
      out.push({ id: slugId(tag.id) || null, dimension: tag.dimension ?? issued.get(questionKey(tag.text))?.dimension ?? null, text: tag.text, answer });
      return;
    }
    const known = issued.get(questionKey(m.text));
    if (known) {
      out.push({ id: known.id, dimension: known.dimension, text: m.text.trim(), answer });
      return;
    }
    if (/[?？]/.test(m.text) && answer) out.push({ id: null, dimension: null, text: m.text.trim(), answer });
  });
  return out;
}

// ───────────────────────── Cache de lo entendido (trip_brief → trip_shapes)

const UNDERSTOOD_TTL_MS = 60 * 60 * 1000;
const UNDERSTOOD_MAX = 500;
const understoodCache = new Map<string, { at: number; value: TripUnderstanding }>();

export function understandingKey(userId: string, input: Pick<ToolInput<'trip_brief'>, 'trip_id' | 'conversation' | 'start_date' | 'end_date'>): string {
  return JSON.stringify([userId, input.trip_id ?? null, input.start_date ?? null, input.end_date ?? null, input.conversation.map((m) => [m.role, m.text.trim()])]);
}

function rememberUnderstanding(key: string, u: TripUnderstanding): void {
  understoodCache.delete(key);
  understoodCache.set(key, { at: Date.now(), value: u });
  if (understoodCache.size > UNDERSTOOD_MAX) understoodCache.delete(understoodCache.keys().next().value!);
}

function cachedUnderstanding(key: string): TripUnderstanding | null {
  const hit = understoodCache.get(key);
  return hit && Date.now() - hit.at < UNDERSTOOD_TTL_MS ? hit.value : null;
}

export function clearUnderstandingCache(): void {
  understoodCache.clear();
}

// Hemisferio sur y trópico (sin estaciones marcadas): solo afirmamos temporada si sabemos el país.
const SOUTH = ['argentina', 'uruguay', 'chile', 'paraguay', 'australia', 'nueva zelanda', 'new zealand', 'sudafrica', 'south africa'];
const TROPICS = ['brasil', 'brazil', 'mexico', 'colombia', 'venezuela', 'ecuador', 'peru', 'bolivia', 'cuba', 'costa rica', 'panama', 'republica dominicana', 'puerto rico', 'tailandia', 'thailand', 'indonesia', 'india', 'singapur', 'singapore', 'vietnam', 'filipinas'];
const NORTH_SEASONS = ['invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano', 'verano', 'verano', 'otoño', 'otoño', 'otoño', 'invierno'];
const SOUTH_SEASONS = ['verano', 'verano', 'otoño', 'otoño', 'otoño', 'invierno', 'invierno', 'invierno', 'primavera', 'primavera', 'primavera', 'verano'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function seasonLine(dest: { city: string; country: string | null }, date: string): string | null {
  if (!dest.country || !isIsoDate(date)) return null;
  const c = plain(dest.country);
  if (TROPICS.includes(c)) return null;
  const m = Number(date.slice(5, 7)) - 1;
  const season = (SOUTH.includes(c) ? SOUTH_SEASONS : NORTH_SEASONS)[m];
  return `En ${MONTHS[m]} en ${dest.city} es ${season}.`;
}

/** Fechas fijas que cambian horarios en casi todos lados (no inventamos feriados locales). */
export function holidayLines(start: string | null, end: string | null): string[] {
  if (!start || !end) return [];
  const out: string[] = [];
  const within = (mmdd: string) => {
    for (const y of new Set([start.slice(0, 4), end.slice(0, 4)])) {
      const d = `${y}-${mmdd}`;
      if (d >= start && d <= end) return true;
    }
    return false;
  };
  if (within('12-25')) out.push('Cae Navidad: el 24 a la noche y el 25 mucho cierra.');
  if (within('01-01')) out.push('Cae Año Nuevo: el 31 a la noche y el 1 mucho cierra.');
  return out;
}

export function briefContext(members: BriefMember[], u: TripUnderstanding, warming: boolean): string[] {
  const out: string[] = [];
  if (members.length > 1) out.push(`Viajan ${members.length} en la app: ${members.map((m) => m.name).join(', ')}.`);
  const top = topInterests(combineInterestWeights(members.map((m) => m.interests)), 3);
  if (top.length) out.push(`${members.length > 1 ? 'Al grupo le' : 'Te'} interesa sobre todo ${top.join(', ')} (de los perfiles).`);
  const diets = [...new Set(members.flatMap((m) => m.dietary))];
  if (diets.length) out.push(`Dieta a respetar: ${diets.join(', ')}.`);
  if (u.start_date) for (const d of u.destinations.slice(0, 3)) {
    const s = seasonLine(d, u.start_date);
    if (s) out.push(s);
  }
  out.push(...holidayLines(u.start_date, u.end_date));
  if (warming) for (const d of u.destinations.slice(0, 4)) out.push(`Ya estoy investigando ${d.city}.`);
  return out;
}

// ───────────────────────── Puro: formas del viaje

const shapeSignature = (s: { legs: { city: string; start_date: string; end_date: string }[] }) =>
  s.legs.map((l) => `${plain(l.city)}:${l.start_date}:${l.end_date}`).sort().join('|');

/**
 * Anclas que usa una forma: las que nombró el modelo (anchor_ids) y, si no nombró ninguna, las que caen dentro de
 * sus fechas en una ciudad de sus tramos. Un ancla con fecha fuera del rango de la forma nunca se le asigna.
 */
export function anchorsForShape(
  v: Pick<ShapeVariantT, 'anchor_ids'>,
  plan: { start_date: string; end_date: string; legs: { city: string; start_date: string; end_date: string }[] },
  anchors: TripAnchor[],
): TripAnchor[] {
  const inRange = (a: TripAnchor) => !a.date || (a.date >= plan.start_date && a.date <= plan.end_date);
  const ids = new Set((v.anchor_ids ?? []).map((x) => x.trim()));
  const named = anchors.filter((a) => ids.has(a.id) && inRange(a));
  if (named.length || ids.size) return named;
  const cities = plan.legs.map((l) => plain(l.city));
  return anchors.filter((a) => a.date && inRange(a) && a.city && cities.some((c) => c.includes(plain(a.city!)) || plain(a.city!).includes(c)));
}

/**
 * Variantes del modelo → TripShape válidas (normalizeSkeleton), sin duplicados, máx. 3, una recomendada.
 * Con anclas: cada forma lleva las que usa; `extraAssumptions` va primero (ej. "no pude verificar el calendario").
 */
export function shapesFromOutput(
  variants: ShapeVariantT[],
  anchors: TripAnchor[] = [],
  extraAssumptions: string[] = [],
): { shapes: TripShape[]; dropped: string[] } {
  const shapes: TripShape[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    if (shapes.length >= 3) break;
    let plan: ReturnType<typeof normalizeSkeleton>;
    try {
      plan = normalizeSkeleton(v);
    } catch (err) {
      dropped.push(`${v.label}: ${(err as Error).message}`);
      continue;
    }
    const sig = shapeSignature(plan);
    if (seen.has(sig)) {
      dropped.push(`${v.label}: igual a otra variante`);
      continue;
    }
    seen.add(sig);
    // normalizeSkeleton puede renombrar keys duplicadas: mapeamos por posición original del tramo.
    const rawByKey = new Map(v.legs.map((l) => [l.key?.trim(), l]));
    const keys = new Set(plan.legs.map((l) => l.key));
    const assumptions = [...new Set([...extraAssumptions, ...plan.assumptions].map((a) => a.trim().slice(0, 400)).filter(Boolean))].slice(0, 12);
    const shape: TripShape = {
      id: `s${shapes.length + 1}`,
      label: v.label.trim() || `Opción ${shapes.length + 1}`,
      pitch: v.pitch.trim(),
      tradeoffs: nonEmpty(v.tradeoffs).slice(0, 5),
      recommended: !!v.recommended,
      title: plan.title,
      start_date: plan.start_date,
      end_date: plan.end_date,
      legs: plan.legs.map((l) => {
        const raw = rawByKey.get(l.key);
        return {
          key: l.key,
          city: l.city,
          country: l.country,
          start_date: l.start_date,
          end_date: l.end_date,
          includes_organizer: l.includes_organizer,
          participant_names: l.participant_names,
          parallel_with: (raw?.parallel_with ?? []).filter((k) => keys.has(k) && k !== l.key),
          why: raw?.why?.trim() ?? '',
        };
      }),
      transfers: plan.transfers.map((t) => ({
        ...t,
        participant_names: v.transfers.find((x) => x.from_key === t.from_key && x.to_key === t.to_key)?.participant_names ?? [],
      })),
      assumptions,
    };
    if (anchors.length) shape.anchors = anchorsForShape(v, plan, anchors);
    shapes.push(shape);
  }
  if (shapes.length) {
    const rec = shapes.findIndex((s) => s.recommended);
    shapes.forEach((s, i) => (s.recommended = i === (rec >= 0 ? rec : 0)));
  }
  return { shapes, dropped };
}

// ───────────────────────── Orquestación

async function withTimeout<T>(ms: number, what: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw new ToolFailure(504, 'timeout', `${what} tardó demasiado. Probá de nuevo.`);
    if (err instanceof JobError) throw new ToolFailure(502, err.code, err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const clampRound = (r: number | undefined) => Math.min(3, Math.max(1, Math.round(r ?? 1)));

export async function tripBrief(input: ToolInput<'trip_brief'>, ctx: ToolCtx, deps: BriefDeps = defaultBriefDeps()): Promise<TripBriefResult> {
  const round = clampRound(input.round);
  const { members, legs } = await loadBriefMembers(ctx.admin, input.trip_id, ctx.userId);
  const asked = parseAskedQuestions(input.conversation);
  const user = renderBriefUser({
    today: deps.today(),
    start_date: input.start_date,
    end_date: input.end_date,
    profiles: profileLines(members),
    existingLegs: legs,
    conversation: input.conversation,
    ask: 'brief',
    round,
    asked,
  });
  const timeoutMs = round <= 1 ? deps.timeoutMs : Math.max(deps.timeoutMs, 45_000);
  const { value } = await withTimeout(timeoutMs, 'La entrevista', (signal) =>
    deps.llm.brief({ system: BRIEF_SYSTEM, user, config: briefConfig(round), signal }),
  );
  const understood = normalizeUnderstanding(value.understood, input);
  const coverage = normalizeCoverage(value.coverage, understood, asked);
  const questions = normalizeQuestions(value.questions, understood, { coverage, asked });
  rememberQuestions(questions);
  const ready = understood.destinations.length > 0;
  // done: ronda 3, o nada más para preguntar, o el modelo dice que alcanza. Sin destino nunca está terminado.
  const done = ready && (round >= 3 || questions.length === 0 || !!value.done);
  rememberUnderstanding(understandingKey(ctx.userId, input), understood);

  const warming = !!deps.warm && ready;
  if (warming) {
    try {
      deps.warm!(ctx.admin, understood.destinations);
    } catch (err) {
      console.warn('[trip_brief] precalentado:', (err as Error).message);
    }
  }
  // Entrevista terminada con anclas: arrancamos a investigar el calendario (queda en la cache de anchors.ts).
  if (done && deps.research && deps.warmAnchors !== false && hasAnchors(understood)) {
    const today = deps.today();
    runInBackground('trip_brief/anchors', deps.research(understood, { today, timeoutMs: 60_000 }).then(() => undefined));
  }
  const context = briefContext(members, understood, warming);
  for (const a of (understood.anchors ?? []).slice(0, 2)) context.push(`El viaje gira alrededor de: ${a.name}. Voy a buscar el calendario oficial.`);
  return {
    summary: value.summary.trim(),
    understood,
    context,
    questions,
    ready,
    round,
    done,
    coverage,
  };
}

/** Lo entendido para trip_shapes: de la cache de trip_brief (misma conversación) o re-extraído (effort low). */
async function understandingForShapes(input: ToolInput<'trip_shapes'>, ctx: ToolCtx, deps: ShapesDeps, base: Parameters<typeof renderBriefUser>[0]): Promise<TripUnderstanding | null> {
  // v2: mobile manda lo entendido de la última ronda; es la fuente más confiable (la cache en memoria no sobrevive
  // entre instancias de Vercel).
  if (input.understanding) return normalizeUnderstanding(input.understanding as unknown as Parameters<typeof normalizeUnderstanding>[0], input);
  const hit = cachedUnderstanding(understandingKey(ctx.userId, input));
  if (hit) return hit;
  try {
    const { value } = await withTimeout(deps.understandTimeoutMs ?? 25_000, 'Entender el viaje', (signal) =>
      deps.llm.brief({ system: BRIEF_SYSTEM, user: renderBriefUser({ ...base, ask: 'understand', round: 3 }), config: BRIEF_CONFIG, signal }),
    );
    const u = normalizeUnderstanding(value.understood, input);
    rememberUnderstanding(understandingKey(ctx.userId, input), u);
    return u;
  } catch (err) {
    console.warn('[trip_shapes] no pude re-extraer lo entendido:', (err as Error).message);
    return null;
  }
}

export async function tripShapes(input: ToolInput<'trip_shapes'>, ctx: ToolCtx, deps: ShapesDeps = defaultShapesDeps()): Promise<TripShapesResult> {
  const { members, legs } = await loadBriefMembers(ctx.admin, input.trip_id, ctx.userId);
  const today = deps.today();
  const base = {
    today,
    start_date: input.start_date,
    end_date: input.end_date,
    profiles: profileLines(members),
    existingLegs: legs,
    conversation: input.conversation,
    ask: 'shapes' as const,
  };
  const understanding = await understandingForShapes(input, ctx, deps, base);

  let research: AnchorResearch | null = null;
  const extraAssumptions: string[] = [];
  if (understanding && hasAnchors(understanding)) {
    if (deps.research) {
      try {
        research = await deps.research(understanding, { today, timeoutMs: deps.anchorsTimeoutMs ?? 30_000 });
      } catch (err) {
        console.warn('[trip_shapes] investigación de anclas:', (err as Error).message);
      }
    }
    if (!research?.researched) extraAssumptions.push('No pude verificar el calendario oficial del evento: las fechas y sedes de los partidos quedan a confirmar.');
  }
  const anchors = research?.anchors ?? understanding?.anchors ?? [];

  const user = renderBriefUser({ ...base, understanding, anchors, anchorNotes: research?.notes ?? [] });
  const { value } = await withTimeout(deps.timeoutMs, 'Pensar las formas del viaje', (signal) =>
    deps.llm.shapes({ system: SHAPES_SYSTEM, user, config: SHAPES_CONFIG, signal }),
  );
  const { shapes, dropped } = shapesFromOutput(value.variants ?? [], anchors, extraAssumptions);
  if (dropped.length) console.warn('[trip_shapes] variantes descartadas:', dropped);
  if (!shapes.length) {
    throw new ToolFailure(502, 'shapes_failed', 'No me salió ninguna forma del viaje que cierre. Contame un poco más (destinos y días) y pruebo de nuevo.');
  }
  return { variants: shapes };
}
