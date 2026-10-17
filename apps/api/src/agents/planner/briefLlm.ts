// Entrevista (trip_brief) y formas del viaje (trip_shapes) del planificador colaborativo (PRD 31).
// - tripBrief: 1 llamada rápida (effort low) con salida estructurada → lo que entendí + 0-4 preguntas. El contexto
//   ("Lo que tengo en cuenta") es determinístico. Al terminar precalienta el catálogo de cada destino en segundo plano.
// - tripShapes: 1 llamada (effort medium) → 2-3 formas distintas; cada una pasa por normalizeSkeleton.
import {
  combineInterestWeights,
  INTEREST_TAGS,
  type InterestTag,
  type ToolInput,
  type TripBriefResult,
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
import {
  BRIEF_SYSTEM,
  BriefOutput,
  type BriefOutputT,
  type BriefProfileLine,
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

export const BRIEF_CONFIG: BriefLlmConfig = { effort: 'low', maxTokens: 6000, fallbacks: true };
export const SHAPES_CONFIG: BriefLlmConfig = { effort: 'medium', maxTokens: 16000, fallbacks: true };

export type BriefDeps = {
  llm: BriefLLM;
  today: () => string;
  /** Precalentar el catálogo de los destinos (segundo plano). null = no precalentar (tests). */
  warm: ((admin: Db, destinations: { city: string; country: string | null }[]) => void) | null;
  timeoutMs: number;
};

export function defaultBriefDeps(): BriefDeps {
  let llm: BriefLLM | null = null;
  return {
    get llm() {
      return (llm ??= anthropicBriefLlm());
    },
    today: () => todayIso(),
    warm: (admin, destinations) => runInBackground('trip_brief/warm', warmCatalogs(admin, destinations)),
    timeoutMs: 15_000,
  };
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

export function normalizeUnderstanding(u: BriefOutputT['understood'], input: Pick<ToolInput<'trip_brief'>, 'start_date' | 'end_date'>): TripUnderstanding {
  const interests: Partial<Record<InterestTag, number>> = {};
  for (const { tag, weight } of u.interests ?? []) {
    if (!(INTEREST_TAGS as readonly string[]).includes(tag)) continue;
    const w = Math.min(5, Math.max(1, Math.round(Number(weight) || 3)));
    interests[tag] = Math.max(interests[tag] ?? 0, w);
  }
  const date = (d: string | null | undefined) => (isIsoDate(d) ? d : null);
  const pos = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  const seen = new Set<string>();
  return {
    destinations: (u.destinations ?? [])
      .map((d) => ({ city: d.city.trim(), country: d.country?.trim() || null }))
      .filter((d) => d.city && !seen.has(d.city.toLowerCase()) && seen.add(d.city.toLowerCase())),
    start_date: input.start_date ?? date(u.start_date),
    end_date: input.end_date ?? date(u.end_date),
    days: pos(u.days),
    travelers: pos(u.travelers),
    party: u.party ?? null,
    names: nonEmpty(u.names),
    interests,
    must: nonEmpty(u.must),
    avoid: nonEmpty(u.avoid),
    budget: u.budget ?? null,
    pace: u.pace ?? null,
    first_time: u.first_time ?? null,
    kids_ages: nonEmpty(u.kids_ages),
    arrival: u.arrival?.trim() || null,
    departure: u.departure?.trim() || null,
    lodging_booked: u.lodging_booked?.trim() || null,
    notes: nonEmpty(u.notes),
  };
}

/** ¿La respuesta a esta pregunta ya está en lo que entendí? (red de seguridad: nunca preguntar lo que ya dijo). */
export function alreadyKnown(id: TripQuestion['id'], u: TripUnderstanding): boolean {
  switch (id) {
    case 'dates':
      return !!u.start_date;
    case 'duration':
      return u.days != null || (!!u.start_date && !!u.end_date);
    case 'travelers':
      return u.travelers != null || u.party === 'solo' || u.names.length > 0;
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

export function normalizeQuestions(qs: BriefOutputT['questions'], u: TripUnderstanding): TripQuestion[] {
  const out: TripQuestion[] = [];
  for (const q of qs ?? []) {
    if (out.length >= 4) break;
    if (!q.text?.trim() || out.some((x) => x.id === q.id && q.id !== 'other')) continue;
    if (alreadyKnown(q.id, u)) continue;
    const options = (q.options ?? []).filter((o) => o.value?.trim() && o.label?.trim()).slice(0, 6);
    let kind = q.kind;
    if ((kind === 'single' || kind === 'multi') && options.length < 2) kind = 'text';
    const values = new Set(options.map((o) => o.value));
    const defaults = (q.default_values ?? []).filter((v) => !options.length || values.has(v));
    out.push({
      id: q.id,
      text: q.text.trim(),
      why: q.why?.trim() ?? '',
      kind,
      options,
      default: kind === 'multi' ? (defaults.length ? defaults : null) : (defaults[0] ?? null),
      optional: !!q.optional,
    });
  }
  return out;
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

/** Variantes del modelo → TripShape válidas (normalizeSkeleton), sin duplicados, máx. 3, una recomendada. */
export function shapesFromOutput(variants: ShapeVariantT[]): { shapes: TripShape[]; dropped: string[] } {
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
    shapes.push({
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
      assumptions: plan.assumptions,
    });
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

export async function tripBrief(input: ToolInput<'trip_brief'>, ctx: ToolCtx, deps: BriefDeps = defaultBriefDeps()): Promise<TripBriefResult> {
  const { members, legs } = await loadBriefMembers(ctx.admin, input.trip_id, ctx.userId);
  const user = renderBriefUser({
    today: deps.today(),
    start_date: input.start_date,
    end_date: input.end_date,
    profiles: profileLines(members),
    existingLegs: legs,
    conversation: input.conversation,
    ask: 'brief',
  });
  const { value } = await withTimeout(deps.timeoutMs, 'La entrevista', (signal) =>
    deps.llm.brief({ system: BRIEF_SYSTEM, user, config: BRIEF_CONFIG, signal }),
  );
  const understood = normalizeUnderstanding(value.understood, input);
  const questions = normalizeQuestions(value.questions, understood);
  const warming = !!deps.warm && understood.destinations.length > 0;
  if (warming) {
    try {
      deps.warm!(ctx.admin, understood.destinations);
    } catch (err) {
      console.warn('[trip_brief] precalentado:', (err as Error).message);
    }
  }
  return {
    summary: value.summary.trim(),
    understood,
    context: briefContext(members, understood, warming),
    questions,
    ready: understood.destinations.length > 0,
  };
}

export async function tripShapes(
  input: ToolInput<'trip_shapes'>,
  ctx: ToolCtx,
  deps: Pick<BriefDeps, 'llm' | 'today' | 'timeoutMs'> = { ...defaultBriefDeps(), timeoutMs: 45_000 },
): Promise<TripShapesResult> {
  const { members, legs } = await loadBriefMembers(ctx.admin, input.trip_id, ctx.userId);
  const user = renderBriefUser({
    today: deps.today(),
    start_date: input.start_date,
    end_date: input.end_date,
    profiles: profileLines(members),
    existingLegs: legs,
    conversation: input.conversation,
    ask: 'shapes',
  });
  const { value } = await withTimeout(deps.timeoutMs, 'Pensar las formas del viaje', (signal) =>
    deps.llm.shapes({ system: SHAPES_SYSTEM, user, config: SHAPES_CONFIG, signal }),
  );
  const { shapes, dropped } = shapesFromOutput(value.variants ?? []);
  if (dropped.length) console.warn('[trip_shapes] variantes descartadas:', dropped);
  if (!shapes.length) {
    throw new ToolFailure(502, 'shapes_failed', 'No me salió ninguna forma del viaje que cierre. Contame un poco más (destinos y días) y pruebo de nuevo.');
  }
  return { variants: shapes };
}
