// Agente planificador (PRD 01): POST /tools/plan_trip → job en agent_jobs que arma tramos, días y bloques.
// 1) Setup síncrono (≤ 1 s): valida, crea el viaje si falta, inserta el job y responde {job_id, trip_id}.
// 2) Esqueleto (salida estructurada) → legs + leg_members + days + traslados.
// 3) Relleno por tramo (Tool Runner, hasta 3 en paralelo) con las MISMAS herramientas del backend
//    (toClaudeTools, ctx.actor='agent' + excepción de plan sobre tramos vacíos).
// 4) Cierre: result + 1 fila trip_planned con el undo_token que borra todo lo creado.
import { addTransfers } from './dayTransfers';
// PRD 31 (planificador colaborativo):
// - input.skeleton (forma elegida en trip_shapes) salta el LLM del esqueleto.
// - Por tramo: catálogo del destino → menú (leg_options). mode 'menu' termina ahí; 'auto' (default) arma los días
//   con lo preseleccionado (composeLeg → checkPlan/repairPlan → add_block) y reporta cobertura.
// - Fallback: si el catálogo de un tramo falla o queda chico, ese tramo usa el relleno por LLM de siempre.
import { randomUUID } from 'node:crypto';
import {
  SCOUT,
  type TripAnchor,
  type TripUnderstanding,
  type CatalogItem,
  type LegOptionRow,
  type PlanCoverage,
  type PlanTripResult,
  type ToolInput,
  type ToolName,
  type ToolResponse,
  type TransferMode,
} from '@build101/shared';
import type { Op } from '../blocks';
import { conflict, dbError, forbidden, jobErrorFields, notFound, orFallback, rethrowIfFatal } from '../errors';
import { fmtDay, insertFeed } from '../feed';
import { searchPlaces } from '../google/places';
import { fetchForecast } from '../google/openMeteo';
import { computeRoute } from '../google/routes';
import { createJob, JobProgress } from '../jobs';
import { loadTripRole } from '../policy/writeMode';
import { toClaudeTools } from '../tools/claude';
import { runTool } from '../tools/registry';
import type { ToolCtx } from '../tools/types';
import { diffDays, eachDate, isIsoDate, shortRange, todayIso } from './dates';
import { anthropicPlanner, JobError, plannerConfig, type PlannerConfig, type PlannerLLM, type RunnerTool } from './llm';
import {
  LEG_SYSTEM,
  legContext,
  legUserMessage,
  renderSkeletonRequest,
  SKELETON_SYSTEM,
  type PlannerProfile,
} from './prompts';
import {
  anchorsForLeg,
  autoPicks,
  composeAndCheck,
  dayWindows,
  isLongHaulArrival,
  mergeAnchors,
  legWeather,
  loadLegGroup,
  loadPlannerModules,
  MIN_CATALOG_ITEMS,
  mustOptions,
  writeComposedBlocks,
  type PlannerModules,
} from './planner/runtime';
import type { ComposeDeps, ComposeLeg, PlannerGroup } from './planner/types';
import { addUsage, emptyUsage, estimateCostUsd, type TripSkeleton, type Usage } from './schemas';

export const PLANNER_TOOLS = ['search_places', 'place_details', 'route_eta', 'add_block', 'get_trip_overview'] as const satisfies readonly ToolName[];

const MAX_LEGS = 8;
const MAX_TRIP_DAYS = 30;

export type PlanDeps = {
  llm: PlannerLLM;
  config: PlannerConfig;
  today: () => string;
  /** Ciudad → place de Google (centro). null si no hay key o no se encontró. */
  resolveCity: (city: string, country: string) => Promise<{ google_place_id: string; lat: number; lng: number } | null>;
  /** Minutos en auto entre dos puntos (para traslados en bus/auto). */
  driveMinutes: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Promise<number | null>;
  heartbeatMs?: number;
  /** Traslados dentro del día después de llenar cada tramo (opcional: los tests que no lo pasan, lo saltean). */
  transfers?: (ctx: ToolCtx, args: { trip_id: string; leg_id: string }) => Promise<{ added: number }>;
  /** PRD 31: catálogo/menú/armado (lazy de planner/*; los tests pasan fakes). Si falla → relleno por LLM. */
  planner: () => Promise<PlannerModules>;
  /** PRD 31: deps del armado de días (restaurantes cerca). */
  composeDeps: () => ComposeDeps;
  /** PRD 31: pronóstico para el armado. */
  forecast: typeof fetchForecast;
};

export function defaultComposeDeps(): ComposeDeps {
  return {
    searchPlaces: (a) => searchPlaces({ query: a.query, near: a.near, radius_m: a.radius_m ?? 1500, max_results: a.max_results ?? 5 }),
  };
}

export function defaultDeps(): PlanDeps {
  return {
    llm: anthropicPlanner(),
    config: plannerConfig(),
    transfers: (ctx, args) => addTransfers(ctx, args),
    today: () => todayIso(),
    resolveCity: async (city, country) => {
      try {
        const [p] = await searchPlaces({ query: [city, country].filter(Boolean).join(', '), radius_m: 3000, max_results: 1 });
        return p && p.lat != null && p.lng != null ? { google_place_id: p.google_place_id, lat: p.lat, lng: p.lng } : null;
      } catch {
        return null;
      }
    },
    driveMinutes: async (a, b) => {
      try {
        const r = await computeRoute([a, b], 'car');
        return r.total_min > 0 ? r.total_min : null;
      } catch {
        return null;
      }
    },
    planner: loadPlannerModules,
    composeDeps: defaultComposeDeps,
    forecast: fetchForecast,
  };
}

/** PRD 31: la forma elegida en trip_shapes (ya validada por Zod) → TripSkeleton para normalizeSkeleton. */
export function skeletonFromShape(s: NonNullable<ToolInput<'plan_trip'>['skeleton']>): TripSkeleton {
  return {
    title: s.title ?? '',
    start_date: s.start_date,
    end_date: s.end_date,
    legs: s.legs.map((l) => ({
      key: l.key,
      city: l.city,
      country: l.country ?? '',
      start_date: l.start_date,
      end_date: l.end_date,
      includes_organizer: l.includes_organizer ?? true,
      participant_names: l.participant_names ?? [],
      parallel_with: l.parallel_with ?? [],
      why: l.why ?? '',
    })),
    transfers: (s.transfers ?? []).map((t) => ({
      from_key: t.from_key,
      to_key: t.to_key,
      date: t.date,
      mode: t.mode,
      duration_min: t.duration_min,
      participant_names: t.participant_names ?? [],
    })),
    assumptions: s.assumptions ?? [],
  };
}

// ───────────────────────── Esqueleto normalizado (puro, testeable)

export type PlannedLeg = {
  id: string;
  key: string;
  city: string;
  country: string;
  start_date: string;
  end_date: string;
  sort_order: number;
  includes_organizer: boolean;
  participant_names: string[];
  dates: string[];
};

export type PlannedTransfer = {
  from_key: string;
  to_key: string;
  date: string;
  mode: TransferMode;
  duration_min: number;
};

export type NormalizedSkeleton = {
  title: string;
  start_date: string;
  end_date: string;
  legs: PlannedLeg[];
  transfers: PlannedTransfer[];
  assumptions: string[];
};

export function normalizeSkeleton(sk: TripSkeleton, newId: () => string = randomUUID): NormalizedSkeleton {
  const legsIn = sk.legs.filter((l) => l.city?.trim());
  if (!legsIn.length) throw new JobError('skeleton_failed', 'El esqueleto vino sin tramos.');
  if (legsIn.length > MAX_LEGS) throw new JobError('skeleton_failed', `Demasiados tramos (${legsIn.length}).`);
  const seen = new Set<string>();
  const legs = legsIn.map((l, i) => {
    if (!isIsoDate(l.start_date) || !isIsoDate(l.end_date)) {
      throw new JobError('skeleton_failed', `Fechas inválidas para ${l.city}: ${l.start_date} – ${l.end_date}`);
    }
    const [start, end] = l.start_date <= l.end_date ? [l.start_date, l.end_date] : [l.end_date, l.start_date];
    let key = (l.key || `leg${i}`).trim();
    while (seen.has(key)) key = `${key}_${i}`;
    seen.add(key);
    return {
      id: newId(),
      key,
      city: l.city.trim(),
      country: (l.country ?? '').trim(),
      start_date: start,
      end_date: end,
      sort_order: 0,
      includes_organizer: l.includes_organizer !== false,
      participant_names: [...new Set((l.participant_names ?? []).map((n) => n.trim()).filter(Boolean))],
      dates: eachDate(start, end),
    };
  });
  legs.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date));
  legs.forEach((l, i) => (l.sort_order = i));
  const start_date = legs.reduce((m, l) => (l.start_date < m ? l.start_date : m), legs[0].start_date);
  const end_date = legs.reduce((m, l) => (l.end_date > m ? l.end_date : m), legs[0].end_date);
  if (diffDays(start_date, end_date) + 1 > MAX_TRIP_DAYS) {
    throw new JobError('skeleton_failed', `El viaje quedó de más de ${MAX_TRIP_DAYS} días.`);
  }
  const byKey = new Map(legs.map((l) => [l.key, l]));
  const transfers: PlannedTransfer[] = [];
  for (const t of sk.transfers ?? []) {
    const from = byKey.get(t.from_key);
    const to = byKey.get(t.to_key);
    if (!from || !to || from === to) continue;
    const date = isIsoDate(t.date) && to.dates.includes(t.date) ? t.date : to.start_date;
    const duration = Number.isFinite(t.duration_min) && t.duration_min > 0 ? Math.round(t.duration_min) : 60;
    transfers.push({ from_key: from.key, to_key: to.key, date, mode: t.mode, duration_min: Math.min(duration, 24 * 60) });
  }
  return {
    title: (sk.title ?? '').trim().slice(0, 80) || legs.map((l) => l.city).filter((c, i, a) => a.indexOf(c) === i).join(' + '),
    start_date,
    end_date,
    legs,
    transfers,
    assumptions: (sk.assumptions ?? []).map((a) => a.trim()).filter(Boolean),
  };
}

/** "Armé 3 tramos: Montevideo (17–19/10), Colonia y Buenos Aires en paralelo (20–21/10), Buenos Aires (22–24/10)" */
export function describeLegs(legs: Pick<PlannedLeg, 'city' | 'start_date' | 'end_date'>[]): string {
  const groups: { cities: string[]; start: string; end: string }[] = [];
  for (const l of legs) {
    const g = groups.find((x) => x.start === l.start_date && x.end === l.end_date);
    if (g) g.cities.push(l.city);
    else groups.push({ cities: [l.city], start: l.start_date, end: l.end_date });
  }
  const parts = groups.map((g) => {
    const names = g.cities.length > 1 ? `${g.cities.slice(0, -1).join(', ')} y ${g.cities.at(-1)} en paralelo` : g.cities[0];
    return `${names} (${shortRange(g.start, g.end)})`;
  });
  return `Armé ${legs.length} ${legs.length === 1 ? 'tramo' : 'tramos'}: ${parts.join(', ')}`;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Nombres del esqueleto → miembros existentes (por primer nombre) + los que todavía no están. */
export function matchNames(
  names: string[],
  members: { user_id: string; display_name: string | null }[],
  organizerId: string,
): { memberIds: string[]; unmatched: string[] } {
  const memberIds: string[] = [];
  const unmatched: string[] = [];
  for (const name of names) {
    const first = norm(name).split(/\s+/)[0];
    const m = members.find((x) => x.display_name && norm(x.display_name).split(/\s+/)[0] === first);
    if (m) {
      if (m.user_id !== organizerId && !memberIds.includes(m.user_id)) memberIds.push(m.user_id);
    } else if (!unmatched.includes(name)) {
      unmatched.push(name);
    }
  }
  return { memberIds, unmatched };
}

const MODE_LABEL: Record<TransferMode, string> = {
  walk: 'Caminata',
  transit: 'Transporte público',
  bus: 'Bus',
  ferry: 'Ferry',
  flight: 'Vuelo',
  car: 'Auto',
};

/** Respuestas de herramientas más chicas para el modelo (menos tokens por vuelta). */
export function compactForPlanner(name: ToolName, body: ToolResponse): string {
  if (!body.ok) return JSON.stringify(body);
  const data = body.data as Record<string, unknown> | unknown[];
  switch (name) {
    case 'add_block': {
      const d = data as { mode?: string; block?: { id: string; title: string; day_id: string | null }; proposal_id?: string };
      return JSON.stringify({ ok: true, mode: d.mode, block_id: d.block?.id, title: d.block?.title, day_id: d.block?.day_id, proposal_id: d.proposal_id });
    }
    case 'search_places':
      return JSON.stringify({
        ok: true,
        data: (data as Record<string, unknown>[]).map(({ types, ...p }) => ({ ...p, types: (types as string[] | undefined)?.slice(0, 3) })),
      });
    case 'place_details': {
      const { phone: _p, website: _w, google_maps_uri: _g, ...rest } = data as Record<string, unknown>;
      return JSON.stringify({ ok: true, data: rest });
    }
    default:
      return JSON.stringify(body);
  }
}

// ───────────────────────── Setup (síncrono)

type Member = { user_id: string; role: string; trip_prefs: unknown };

export type PlanStart = { job_id: string; trip_id: string; created_trip: boolean; run: () => Promise<void> };

export function titleFromConversation(input: ToolInput<'plan_trip'>): string {
  const first = input.conversation.find((m) => m.role === 'user')?.text.trim() ?? '';
  const line = first.split('\n')[0].replace(/[.!?¿¡]+$/g, '').trim();
  if (!line) return 'Nuevo viaje';
  return line.length <= 60 ? line.charAt(0).toUpperCase() + line.slice(1) : `${line.slice(0, 59).trimEnd()}…`;
}

export async function startPlanTrip(input: ToolInput<'plan_trip'>, ctx: ToolCtx, deps?: Partial<PlanDeps>): Promise<PlanStart> {
  const { admin, userId } = ctx;
  let tripId = input.trip_id;
  let created = false;

  if (tripId) {
    const role = await loadTripRole(admin, tripId, userId);
    if (role === null) throw notFound('No encontré ese viaje (o no sos miembro).');
    if (role !== 'organizer') throw forbidden('Solo quien organiza puede armar el plan del viaje.');
    const [{ data: legs, error: e1 }, { data: blocks, error: e2 }, { data: jobs, error: e3 }] = await Promise.all([
      admin.from('legs').select('id').eq('trip_id', tripId),
      admin.from('blocks').select('leg_id').eq('trip_id', tripId),
      admin
        .from('agent_jobs')
        .select('id,updated_at')
        .eq('trip_id', tripId)
        .eq('kind', 'plan_trip')
        .in('status', ['queued', 'running'])
        .gte('updated_at', new Date(Date.now() - 2 * 60_000).toISOString()),
    ]);
    if (e1) throw dbError(e1, 'legs');
    if (e2) throw dbError(e2, 'blocks');
    if (e3) throw dbError(e3, 'agent_jobs');
    if (jobs?.length) throw conflict('job_running', 'Ya hay un plan armándose para este viaje.');
    const withBlocks = new Set((blocks ?? []).map((b) => b.leg_id as string));
    if ((legs ?? []).length > 0 && (legs ?? []).every((l) => withBlocks.has(l.id as string))) {
      throw conflict('trip_not_empty', 'Todos los tramos de este viaje ya tienen bloques.');
    }
  } else {
    const { data, error } = await admin
      .from('trips')
      .insert({
        title: (input.title?.trim() || titleFromConversation(input)).slice(0, 80),
        status: 'planning',
        created_by: userId, // trigger on_trip_created → trip_members(organizer)
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
      })
      .select('id')
      .single();
    if (error) throw dbError(error, 'trips');
    tripId = data.id as string;
    created = true;
  }

  const firstLine = 'Leyendo lo que me contaste…';
  const jobId = await createJob(admin, { kind: 'plan_trip', trip_id: tripId, user_id: userId, firstLine });
  const trip_id = tripId;
  return {
    job_id: jobId,
    trip_id,
    created_trip: created,
    run: () => runPlanTrip({ jobId, tripId: trip_id, input, ctx, createdTrip: created, firstLine }, { ...defaultDepsLazy(), ...deps }),
  };
}

// defaultDeps() crea el cliente de Anthropic recién al usarse (los tests pasan sus deps).
function defaultDepsLazy(): PlanDeps {
  let d: PlanDeps | null = null;
  const get = () => (d ??= defaultDeps());
  return {
    get llm() {
      return get().llm;
    },
    get config() {
      return get().config;
    },
    today: () => get().today(),
    resolveCity: (c, k) => get().resolveCity(c, k),
    driveMinutes: (a, b) => get().driveMinutes(a, b),
    transfers: (c, a) => get().transfers!(c, a),
    planner: () => get().planner(),
    composeDeps: () => get().composeDeps(),
    forecast: (a) => get().forecast(a),
  };
}

// ───────────────────────── Job (en segundo plano)

type LegToFill = {
  id: string;
  city: string;
  country: string | null;
  start_date: string;
  end_date: string;
  lat: number | null;
  lng: number | null;
  days: { id: string; date: string }[];
  member_ids: string[];
  participant_names: string[];
  arrivals: { day_id: string; text: string }[];
  /** Traslados agendados (para la ventana del día de llegada en el armado). */
  transfers: { day_id: string | null; start_time: string | null; duration_min: number | null }[];
};

type RunArgs = { jobId: string; tripId: string; input: ToolInput<'plan_trip'>; ctx: ToolCtx; createdTrip: boolean; firstLine: string };

/** Texto del error para la persona (los de proveedor salen clasificados: "Claude se quedó sin créditos…"). */
export function readable(err: unknown): string {
  if (err instanceof JobError) return err.message;
  return jobErrorFields(err).error;
}

/** Código y proveedor del error que hizo fallar el job (agent_jobs.error_code / error_provider). */
export function errorCodeFields(err: unknown): { error_code: string; error_provider: string | null } {
  const f = jobErrorFields(err);
  return { error_code: f.error_code, error_provider: f.error_provider };
}

export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runPlanTrip(args: RunArgs, deps: PlanDeps): Promise<void> {
  const { jobId, tripId, input, ctx } = args;
  const { admin, userId } = ctx;
  const agentCtx: ToolCtx = { ...ctx, actor: 'agent' };
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: args.firstLine }]);
  const usage: Usage = emptyUsage();
  const createdLegIds: string[] = [];
  const createdBlocks: { id: string; leg_id: string }[] = [];
  const dateByDay = new Map<string, string>();
  const busy = new Set<string>();
  let assumptions: string[] = [];
  let hints: { leg_id: string; names: string[] }[] = [];
  let legsForCount: { id: string; city: string; start_date: string; end_date: string }[] = [];
  // En un reintento, la conversación original (del job anterior) sigue mandando para los prompts.
  let conversation = input.conversation;
  // PRD 31: lo que entendió trip_brief (gustos, ritmo, presupuesto); en un reintento, el del job anterior.
  let understanding = (input.understanding ?? null) as TripUnderstanding | null;
  // PRD 31 v2: anclas del viaje (investigadas en trip_shapes y/o dichas en la entrevista) y llegada internacional.
  let anchors: TripAnchor[] = [];
  let longHaulLegId: string | null = null;
  const failedLegs: { leg_id: string; city: string; error: string }[] = [];
  const t0 = Date.now();
  // PRD 31
  const mode = input.mode ?? 'auto';
  let optionsCount = 0;
  let choicesCount = 0;
  /** Tramos que quedaron con menú (leg_options). stage='menu' solo si hay al menos uno. */
  const menuLegs = new Set<string>();
  const noMenuNotes: string[] = [];
  const coverage: PlanCoverage[] = [];
  const composeIssues: string[] = [];

  const onBlockAdded = (b: { id: string; leg_id: string; day_id: string | null; title: string }) => {
    createdBlocks.push({ id: b.id, leg_id: b.leg_id });
    void progress.push(`Agregué ${b.title} al ${fmtDay(b.day_id ? dateByDay.get(b.day_id) : null)}`);
  };

  await progress.set({ status: 'running' });
  progress.startHeartbeat(
    () => (busy.size ? `Sigo armando ${[...busy].join(' y ')}…` : 'Sigo pensando el recorrido…'),
    deps.heartbeatMs ?? 10_000,
  );

  let fatal: string | null = null;
  let fatalErr: unknown = null;
  const failedReasons: unknown[] = [];
  try {
    // ── Contexto: miembros, perfiles, tramos existentes, lugares guardados
    const [{ data: membersRaw, error: e1 }, { data: legsRaw, error: e2 }] = await Promise.all([
      admin.from('trip_members').select('user_id,role,trip_prefs').eq('trip_id', tripId),
      admin.from('legs').select('id,city,country,lat,lng,start_date,end_date,sort_order').eq('trip_id', tripId).order('sort_order'),
    ]);
    if (e1) throw dbError(e1, 'trip_members');
    if (e2) throw dbError(e2, 'legs');
    const members = (membersRaw ?? []) as Member[];
    const { data: profRaw, error: e3 } = await admin
      .from('profiles')
      .select('id,display_name,interests,pace,chronotype,dietary,avoid,budget_level,languages')
      .in('id', members.map((m) => m.user_id).concat(userId));
    if (e3) throw dbError(e3, 'profiles');
    const profiles: PlannerProfile[] = (profRaw ?? []).map((p) => ({
      ...(p as Omit<PlannerProfile, 'user_id' | 'trip_prefs'>),
      user_id: p.id as string,
      trip_prefs: members.find((m) => m.user_id === p.id)?.trip_prefs ?? null,
    }));
    const memberNames = profiles.map((p) => ({ user_id: p.user_id, display_name: p.display_name }));

    let legsToFill: LegToFill[] = [];
    const existing = (legsRaw ?? []) as { id: string; city: string; country: string | null; lat: number | null; lng: number | null; start_date: string; end_date: string }[];

    if (existing.length === 0) {
      // ── Esqueleto
      let skeleton: TripSkeleton;
      if (input.skeleton) {
        // PRD 31: la forma ya la eligió el grupo en trip_shapes → no se vuelve a pensar.
        void progress.push('Uso la forma del viaje que eligieron…');
        skeleton = skeletonFromShape(input.skeleton);
      } else {
        void progress.push('Pensando cómo repartir los días…');
        const today = deps.today();
        const sk = await deps.llm.skeleton({
          system: SKELETON_SYSTEM,
          user: renderSkeletonRequest({ input, today, organizerId: userId, profiles, anchors: mergeAnchors(understanding?.anchors) }),
          config: deps.config,
        });
        addUsage(usage, sk.usage);
        skeleton = sk.skeleton;
      }
      const plan = normalizeSkeleton(skeleton);
      assumptions = plan.assumptions;

      const coords = await Promise.all(plan.legs.map((l) => deps.resolveCity(l.city, l.country)));
      const legRows = plan.legs.map((l, i) => ({
        id: l.id,
        trip_id: tripId,
        city: l.city,
        country: l.country || null,
        google_place_id: coords[i]?.google_place_id ?? null,
        lat: coords[i]?.lat ?? null,
        lng: coords[i]?.lng ?? null,
        start_date: l.start_date,
        end_date: l.end_date,
        sort_order: l.sort_order,
      }));
      // supabase-js no expone transacciones: tramos → miembros → días, en ese orden (el undo borra en cascada).
      const { error: e4 } = await admin.from('legs').insert(legRows);
      if (e4) throw dbError(e4, 'insert legs');
      createdLegIds.push(...legRows.map((l) => l.id));

      const legMemberRows: { leg_id: string; user_id: string }[] = [];
      const legMemberIds = new Map<string, string[]>();
      for (const l of plan.legs) {
        const { memberIds, unmatched } = matchNames(l.participant_names, memberNames, userId);
        const ids = [...(l.includes_organizer ? [userId] : []), ...memberIds];
        legMemberIds.set(l.id, ids);
        for (const user_id of ids) legMemberRows.push({ leg_id: l.id, user_id });
        if (unmatched.length) hints.push({ leg_id: l.id, names: unmatched });
      }
      if (legMemberRows.length) {
        const { error } = await admin.from('leg_members').insert(legMemberRows);
        if (error) throw dbError(error, 'insert leg_members');
      }
      const dayRows = plan.legs.flatMap((l) => l.dates.map((date) => ({ id: randomUUID(), leg_id: l.id, date })));
      const { error: e5 } = await admin.from('days').insert(dayRows);
      if (e5) throw dbError(e5, 'insert days');
      for (const d of dayRows) dateByDay.set(d.id, d.date);

      const tripPatch: Record<string, unknown> = { start_date: plan.start_date, end_date: plan.end_date };
      if (args.createdTrip && !input.title) tripPatch.title = plan.title;
      const { error: e6 } = await admin.from('trips').update(tripPatch).eq('id', tripId);
      if (e6) throw dbError(e6, 'trips');
      await progress.push(describeLegs(plan.legs));

      // ── Traslados entre tramos (determinístico: modo y duración del esqueleto; bus/auto con Routes)
      const byKey = new Map(plan.legs.map((l, i) => [l.key, { ...l, ...legRows[i] }]));
      const arrivals = new Map<string, { day_id: string; text: string }[]>();
      const transferTimes = new Map<string, LegToFill['transfers']>();
      const allLegs = new Set(createdLegIds);
      const transferCtx: ToolCtx = { ...agentCtx, plan: { jobId, emptyLegIds: allLegs, allowedLegIds: allLegs, onBlockAdded } };
      for (const t of plan.transfers) {
        const from = byKey.get(t.from_key)!;
        const to = byKey.get(t.to_key)!;
        let duration = t.duration_min;
        if ((t.mode === 'bus' || t.mode === 'car') && from.lat != null && from.lng != null && to.lat != null && to.lng != null) {
          duration = (await deps.driveMinutes({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng })) ?? duration;
        }
        const day = dayRows.find((d) => d.leg_id === to.id && d.date === t.date) ?? dayRows.find((d) => d.leg_id === to.id)!;
        const r = await runTool(
          'add_block',
          {
            trip_id: tripId,
            leg_id: to.id,
            day_id: day.id,
            type: 'transfer',
            title: `${MODE_LABEL[t.mode]} a ${to.city}`,
            description: `De ${from.city} a ${to.city}, ~${duration} min.`,
            time_flex: 'morning',
            duration_min: duration,
            transfer: { from: from.city, to: to.city, mode: t.mode, duration_min: duration },
            sort_order: 0,
          },
          transferCtx,
        );
        if (!r.body.ok) console.warn(`[plan_trip/${jobId}] traslado ${from.city}→${to.city}:`, r.body.error.message);
        const list = arrivals.get(to.id) ?? [];
        list.push({ day_id: day.id, text: `${fmtDay(day.date)}: ${MODE_LABEL[t.mode].toLowerCase()} desde ${from.city} (~${duration} min), a la mañana` });
        arrivals.set(to.id, list);
        transferTimes.set(to.id, [...(transferTimes.get(to.id) ?? []), { day_id: day.id, start_time: null, duration_min: duration }]);
      }

      legsToFill = plan.legs.map((l, i) => ({
        id: l.id,
        city: l.city,
        country: l.country || null,
        start_date: l.start_date,
        end_date: l.end_date,
        lat: legRows[i].lat,
        lng: legRows[i].lng,
        days: dayRows.filter((d) => d.leg_id === l.id).map((d) => ({ id: d.id, date: d.date })),
        member_ids: legMemberIds.get(l.id) ?? [],
        participant_names: hints.find((h) => h.leg_id === l.id)?.names ?? [],
        arrivals: arrivals.get(l.id) ?? [],
        transfers: transferTimes.get(l.id) ?? [],
      }));
      legsForCount = plan.legs;
      anchors = mergeAnchors(input.skeleton?.anchors, understanding?.anchors);
      const first = plan.legs[0];
      if (first && isLongHaulArrival(understanding?.origin, first.country, plan.assumptions)) longHaulLegId = first.id;
    } else {
      // ── Reintento: solo tramos sin bloques
      const ids = existing.map((l) => l.id);
      const [{ data: blocks }, { data: days }, { data: lm }, { data: prevJobs }] = await Promise.all([
        admin.from('blocks').select('leg_id').in('leg_id', ids),
        admin.from('days').select('id,leg_id,date').in('leg_id', ids).order('date'),
        admin.from('leg_members').select('leg_id,user_id').in('leg_id', ids),
        admin
          .from('agent_jobs')
          .select('result')
          .eq('trip_id', tripId)
          .eq('kind', 'plan_trip')
          .not('result', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      const withBlocks = new Set((blocks ?? []).map((b) => b.leg_id as string));
      const prevHints = ((prevJobs?.[0]?.result as PlanTripResult | undefined)?.participants_hint ?? []).filter((h) => ids.includes(h.leg_id));
      hints = prevHints;
      const prevResult = prevJobs?.[0]?.result as PlanTripResult | undefined;
      const prevRequest = prevResult?.request;
      understanding ??= (prevRequest?.understanding ?? null) as TripUnderstanding | null;
      anchors = mergeAnchors(input.skeleton?.anchors, understanding?.anchors, prevRequest?.understanding?.anchors);
      const first = [...existing].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
      if (first && isLongHaulArrival(understanding?.origin, first.country, [...(prevResult?.assumptions ?? []), ...(input.skeleton?.assumptions ?? [])])) longHaulLegId = first.id;
      if (prevRequest?.conversation?.length) {
        conversation = [...prevRequest.conversation, ...input.conversation.filter((m) => !prevRequest.conversation.some((p) => p.text === m.text))];
      }
      for (const d of days ?? []) dateByDay.set(d.id as string, d.date as string);
      legsToFill = existing
        .filter((l) => !withBlocks.has(l.id))
        .map((l) => ({
          ...l,
          days: (days ?? []).filter((d) => d.leg_id === l.id).map((d) => ({ id: d.id as string, date: d.date as string })),
          member_ids: (lm ?? []).filter((x) => x.leg_id === l.id).map((x) => x.user_id as string),
          participant_names: prevHints.find((h) => h.leg_id === l.id)?.names ?? [],
          arrivals: [],
          transfers: [],
        }));
      legsForCount = legsToFill;
      await progress.push(`Completo ${legsToFill.length === 1 ? 'el tramo' : `${legsToFill.length} tramos`} sin bloques: ${legsToFill.map((l) => l.city).join(', ')}`);
    }

    // ── Por tramo (hasta 3 en paralelo): catálogo → menú → (auto) armado; si el catálogo no sirve, relleno por LLM.
    const emptyLegIds = new Set(legsToFill.map((l) => l.id));
    const allLegs = (existing.length ? existing : legsToFill).map((l) => ({ id: l.id, city: l.city, start_date: l.start_date, end_date: l.end_date }));
    const legAnchors = (leg: LegToFill) => anchorsForLeg(anchors, leg, allLegs);
    const { data: saved } = await admin.from('saved_places').select('name,google_place_id,note,city').eq('user_id', userId).limit(200);
    const savedFor = (city: string) =>
      (saved ?? [])
        .filter((s) => s.city && norm(String(s.city)) === norm(city))
        .map((s) => ({ name: s.name as string, google_place_id: s.google_place_id as string | null, note: s.note as string | null }));
    const legPlanCtx = (leg: LegToFill): ToolCtx => ({
      ...agentCtx,
      plan: { jobId, emptyLegIds, allowedLegIds: new Set([leg.id]), onBlockAdded },
    });

    const withTimeout = async <T,>(what: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          fn(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new JobError('leg_timeout', `Se cortó por tiempo ${what}.`));
            }, deps.config.legTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };

    /** Traslados dentro de cada día (a pie / transporte público con líneas). Nunca hace fallar el tramo. */
    const addLegTransfers = async (leg: LegToFill): Promise<void> => {
      if (!deps.transfers) return;
      try {
        void progress.push(`Calculando cómo moverse en ${leg.city}…`);
        const tr = await deps.transfers(legPlanCtx(leg), { trip_id: tripId, leg_id: leg.id });
        if (tr.added) void progress.push(`Agregué ${tr.added} traslados en ${leg.city}`);
      } catch (e) {
        console.warn(`[plan_trip/${jobId}] traslados ${leg.city}:`, (e as Error).message);
      }
    };

    type LegMenu = { m: PlannerModules; options: LegOptionRow[]; items: CatalogItem[]; lodgingZones: ComposeLeg['lodgingZones']; group: PlannerGroup };

    /** Progreso sin repetir la misma línea (getCatalog ya avisa "Investigando…"; dos tramos no la duplican). */
    const said = new Set<string>();
    const sayOnce = (t: string) => {
      if (said.has(t)) return;
      said.add(t);
      void progress.push(t);
    };

    /** Catálogo del destino + menú del tramo (leg_options). Tira si no sirve (→ fallback). */
    const buildMenu = async (leg: LegToFill): Promise<LegMenu> => {
      const m = await deps.planner();
      const city = { city: leg.city, country: leg.country, lat: leg.lat, lng: leg.lng };
      const catalogDeps = m.defaultCatalogDeps();
      // Reintento: si el tramo ya tiene menú, se reusa (las reacciones del grupo quedan).
      const { data: prev, error: e0 } = await admin.from('leg_options').select('*').eq('leg_id', leg.id).order('sort_order');
      if (e0) throw dbError(e0, 'leg_options');
      let options = (prev ?? []) as LegOptionRow[];
      const dates = leg.days.map((d) => d.date);
      // Eventos del tramo en paralelo con el catálogo (no dependen de él; legEvents nunca tira y tiene su tope).
      const eventsP: Promise<CatalogItem[]> = options.length ? Promise.resolve([]) : m.legEvents(city, dates, catalogDeps).catch(() => []);
      // El catálogo avisa su propio progreso ("Investigando…", "Ubicando…"): no lo repetimos acá.
      const cat = await withTimeout(`investigando ${leg.city}`, (signal) => m.getCatalog(admin, city, catalogDeps, { signal, onProgress: sayOnce }));
      addUsage(usage, cat.usage);
      if (cat.items.length < MIN_CATALOG_ITEMS) {
        throw new JobError('catalog_small', `El catálogo de ${leg.city} quedó chico (${cat.items.length} lugares).`);
      }
      const group = await loadLegGroup(admin, m, tripId, leg.member_ids, understanding);
      const events = await eventsP;
      if (!options.length) {
        const drafts = m.buildLegOptions({ trip_id: tripId, leg_id: leg.id, dates, items: cat.items, events, group, saved: savedFor(leg.city) });
        if (!drafts.length) throw new JobError('catalog_small', `No armé opciones para ${leg.city}.`);
        const { data: rows, error } = await admin.from('leg_options').insert(drafts).select('*');
        if (error) throw dbError(error, 'insert leg_options');
        options = (rows ?? []) as LegOptionRow[];
        const musts = options.filter((o) => o.section === 'must').length;
        const forYou = options.filter((o) => o.section === 'for_you').length;
        void progress.push(`Armé el menú de ${leg.city}: ${musts} imperdibles, ${forYou} para ustedes`);
      }
      return { m, options, items: [...cat.items, ...events], lodgingZones: cat.lodging_zones, group };
    };

    /** mode auto: arma los días con lo preseleccionado (+ lo que nombró en la conversación). Devuelve bloques escritos. */
    const composeFromMenu = async (leg: LegToFill, menu: LegMenu): Promise<number> => {
      const { m, group } = menu;
      const picks = autoPicks(menu.options, conversation);
      const center = leg.lat != null && leg.lng != null ? { lat: leg.lat, lng: leg.lng } : null;
      const composeLeg: ComposeLeg = {
        id: leg.id,
        trip_id: tripId,
        city: leg.city,
        country: leg.country,
        center,
        days: leg.days,
        dayWindows: dayWindows(leg.days, leg.transfers, group.chronotype, { longHaulArrival: leg.id === longHaulLegId }),
        weather: await legWeather(center, leg.days.map((d) => d.date), deps.forecast),
        lodging: null,
        lodgingZones: menu.lodgingZones,
      };
      void progress.push(`Armando los días de ${leg.city} por zonas…`);
      const r = await composeAndCheck(m, { leg: composeLeg, group, picks, instruction: null, anchors: legAnchors(leg) }, deps.composeDeps(), {
        items: menu.items,
        mustOptions: mustOptions(menu.options),
        excludedReason: 'no estaba preseleccionado',
      });
      const w = await writeComposedBlocks(legPlanCtx(leg), { trip_id: tripId, leg_id: leg.id, blocks: r.blocks });
      // Las ideas (sin día) no pasan por onBlockAdded: se suman acá para el conteo y el undo.
      const known = new Set(createdBlocks.map((b) => b.id));
      for (const id of w.ids) if (!known.has(id)) createdBlocks.push({ id, leg_id: leg.id });
      choicesCount += w.choiceGroups;
      coverage.push({ ...r.coverage, choices: w.choiceGroups });
      composeIssues.push(...r.issues);
      if (w.ids.length) await addLegTransfers(leg);
      void progress.push(
        `Listo ${leg.city}: ${w.ids.length} bloques, ${r.coverage.must_covered}/${r.coverage.must_total} imperdibles${w.choiceGroups ? `, ${w.choiceGroups} para elegir` : ''}`,
      );
      return w.ids.length;
    };

    /** Relleno por LLM del PRD 01 (Tool Runner con las herramientas del backend). */
    const fillWithLlm = async (leg: LegToFill): Promise<number> => {
      const before = createdBlocks.filter((b) => b.leg_id === leg.id).length;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.config.legTimeoutMs);
      try {
        const tools = toClaudeTools(legPlanCtx(leg), PLANNER_TOOLS, compactForPlanner).map((t) => ({
          ...t,
          run: async (toolInput: never) => {
            const q = (toolInput as { query?: string }).query;
            if (t.name === 'search_places' && q) void progress.push(`Busqué «${q}» en ${leg.city}`);
            return t.run(toolInput);
          },
        })) as unknown as RunnerTool[];
        const res = await deps.llm.fillLeg({
          system: [
            { type: 'text', text: LEG_SYSTEM, cache_control: { type: 'ephemeral' } },
            {
              type: 'text',
              text: legContext({
                trip_id: tripId,
                leg,
                days: leg.days,
                conversation,
                organizerId: userId,
                profiles: profiles.filter((p) => leg.member_ids.includes(p.user_id)),
                participantNames: leg.participant_names,
                arrivals: leg.arrivals,
                savedPlaces: savedFor(leg.city),
                webSearch: deps.config.webSearch,
                anchors: legAnchors(leg),
                longHaulArrival: leg.id === longHaulLegId,
                origin: understanding?.origin ?? null,
              }),
            },
          ],
          user: legUserMessage(leg),
          tools,
          config: deps.config,
          signal: controller.signal,
        });
        addUsage(usage, res.usage);
        const added = createdBlocks.filter((b) => b.leg_id === leg.id).length - before;
        console.log(`[plan_trip/${jobId}] ${leg.city}: ${added} bloques, ${res.iterations} vueltas, stop=${res.stop_reason}`);
        if (res.stop_reason === 'refusal') throw new JobError('leg_failed', `Claude no quiso armar ${leg.city}.`);
        if (added <= 0) throw new JobError('leg_failed', `Se trancó armando ${leg.city}: no agregó bloques.`);
        await addLegTransfers(leg);
        void progress.push(`Listo ${leg.city}: ${added} bloques`);
        return added;
      } catch (err) {
        if (controller.signal.aborted) throw new JobError('leg_timeout', `Se cortó por tiempo armando ${leg.city}.`);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };

    const results = await pool(legsToFill, deps.config.concurrency, async (leg) => {
      busy.add(leg.city);
      try {
        if (!leg.days.length) throw new JobError('leg_failed', `El tramo ${leg.city} no tiene días.`);
        let menu: LegMenu | null = null;
        try {
          menu = await buildMenu(leg);
          optionsCount += menu.options.length;
          if (menu.options.length) menuLegs.add(leg.id);
        } catch (err) {
          rethrowIfFatal(err); // sin créditos / key inválida: el relleno por LLM fallaría igual
          console.warn(`[plan_trip/${jobId}] ${leg.city}: sin catálogo (${readable(err)}) → relleno por LLM`);
        }
        if (menu && mode === 'menu' && menu.options.length) return menu.options.length;
        if (mode === 'menu') {
          // Sin menú en este tramo: se arma directo (relleno por LLM) y se avisa, para que la app no lleve a un menú vacío.
          const n = await fillWithLlm(leg);
          const note = `No pude armar el menú de ${leg.city}; te armé los días directo`;
          noMenuNotes.push(note);
          void progress.push(note);
          return n;
        }
        if (menu) {
          try {
            const n = await composeFromMenu(leg, menu);
            if (n > 0) return n;
            console.warn(`[plan_trip/${jobId}] ${leg.city}: el armado no escribió bloques → relleno por LLM`);
          } catch (err) {
            rethrowIfFatal(err);
            console.warn(`[plan_trip/${jobId}] ${leg.city}: falló el armado (${readable(err)}) → relleno por LLM`);
          }
        }
        return await fillWithLlm(leg);
      } finally {
        busy.delete(leg.city);
      }
    });
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const leg = legsToFill[i];
        console.error(`[plan_trip/${jobId}] ${leg.city}:`, r.reason);
        failedLegs.push({ leg_id: leg.id, city: leg.city, error: readable(r.reason) });
        failedReasons.push(r.reason);
      }
    });
  } catch (err) {
    console.error(`[plan_trip/${jobId}]`, err);
    fatal = readable(err);
    fatalErr = err;
  } finally {
    progress.stopHeartbeat();
  }

  // ── Cierre: trip_planned (si se creó algo) + result + status
  // mode menu: 'menu' solo si algún tramo quedó con menú; si ninguno, el viaje ya está armado ('planned'). Los tramos
  // sin menú quedan armados directo y se avisa en assumptions.
  const stage: PlanTripResult['stage'] = mode === 'menu' && menuLegs.size > 0 ? 'menu' : 'planned';
  if (noMenuNotes.length) assumptions = [...assumptions, ...noMenuNotes];
  const menuReady = stage === 'menu';
  const daysCount = new Set(legsForCount.flatMap((l) => eachDate(l.start_date, l.end_date))).size;
  const legsText = legsForCount.map((l) => `${l.city} (${shortRange(l.start_date, l.end_date)})`).join(', ');
  const legsWord = `${legsForCount.length} ${legsForCount.length === 1 ? 'tramo' : 'tramos'}`;
  const summary = !legsForCount.length
    ? 'No llegué a armar nada.'
    : menuReady
      ? `Armé ${legsWord}, ${daysCount} días y un menú de ${optionsCount} opciones para elegir${noMenuNotes.length ? ` (y ${createdBlocks.length} bloques donde no hubo menú)` : ''}: ${legsText}.`
      : `Armé ${legsWord}, ${daysCount} días y ${createdBlocks.length} bloques: ${legsText}.`;
  let undo_token: string | null = null;
  try {
    const created = new Set(createdLegIds);
    const inverse: Op[] = [
      ...createdBlocks.filter((b) => !created.has(b.leg_id)).map((b) => ({ op: 'remove' as const, block_id: b.id })),
      ...createdLegIds.map((leg_id) => ({ op: 'remove_leg' as const, leg_id })),
    ];
    if (inverse.length) {
      const feed = await insertFeed(agentCtx, {
        trip_id: tripId,
        kind: 'trip_planned',
        payload: { summary: `${SCOUT.name} armó el viaje: ${summary}`, job_id: jobId, legs: legsForCount.length, blocks: createdBlocks.length, inverse },
        undoable: true,
      });
      undo_token = feed.undo_token ?? null;
    }
  } catch (err) {
    console.error(`[plan_trip/${jobId}] trip_planned:`, err);
  }

  const result: PlanTripResult = {
    legs: legsForCount.length,
    days: daysCount,
    blocks: createdBlocks.length,
    summary,
    assumptions,
    participants_hint: hints,
    undo_token,
    failed_legs: failedLegs,
    request: {
      conversation,
      ...(input.start_date ? { start_date: input.start_date } : {}),
      ...(input.end_date ? { end_date: input.end_date } : {}),
      // Las anclas viajan dentro de understanding: compose_days y los reintentos las reusan.
      ...(understanding || anchors.length ? { understanding: { ...(understanding ?? {}), ...(anchors.length ? { anchors } : {}) } } : {}),
    },
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    },
    stage,
    options: optionsCount,
    choices: choicesCount,
    coverage,
  };
  if (composeIssues.length) console.log(`[plan_trip/${jobId}] avisos del chequeo:`, composeIssues);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[plan_trip/${jobId}] fin en ${secs}s · ${createdBlocks.length} bloques · usage ${JSON.stringify(usage)} · ~USD ${estimateCostUsd(usage)}`,
  );
  const error = fatal ?? (failedLegs.length ? [...new Set(failedLegs.map((f) => f.error))].join(' ') : null);
  if (error) {
    await progress.push(fatal ? `Se trancó: ${fatal}` : `Quedó a medias: ${failedLegs.map((f) => f.city).join(', ')}`);
    await progress.set({ status: 'failed', error, ...errorCodeFields(fatalErr ?? failedReasons[0]), result });
  } else {
    await progress.push(
      menuReady
        ? `¡Listo el menú! ${legsWord}, ${daysCount} días, ${optionsCount} opciones para elegir`
        : `¡Listo! ${legsWord}, ${daysCount} días, ${createdBlocks.length} bloques`,
    );
    await progress.set({ status: 'done', error: null, error_code: null, error_provider: null, result });
  }
  await progress.flush();
}
