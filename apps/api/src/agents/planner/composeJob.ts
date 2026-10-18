// compose_days (PRD 31): POST /tools/compose_days → job en agent_jobs que arma los días de los tramos con lo que
// eligió el grupo en el menú (leg_options + leg_option_reactions).
// 1) Setup síncrono: permisos (organizador o viajero del tramo), tramos a armar (con menú y sin bloques salvo
//    traslados), job queued → responde {job_id, trip_id}.
// 2) Por tramo (hasta 3 en paralelo): picks (optionIncluded) → composeLeg (con instruction) → checkPlan/repairPlan →
//    add_block con la excepción de plan (tramo sin bloques no-transfer) → choice_group → cobertura.
// 3) Cierre: 1 fila days_composed deshacible (borra todo lo creado) + result ComposeDaysResult.
import {
  SCOUT,
  type ComposeDaysResult,
  type LegOptionReactionRow,
  type LegOptionRow,
  type PlanCoverage,
  type PlanTripResult,
  type ToolInput,
  type TripUnderstanding,
} from '@build101/shared';
import type { Op } from '../../blocks';
import { badInput, conflict, dbError, forbidden, notFound } from '../../errors';
import { insertFeed } from '../../feed';
import { addTransfers } from '../dayTransfers';
import { fetchForecast } from '../../google/openMeteo';
import { createJob, JobProgress } from '../../jobs';
import { loadTripRole } from '../../policy/writeMode';
import type { ToolCtx } from '../../tools/types';
import { JobError } from '../llm';
import { defaultComposeDeps, pool, readable } from '../planTrip';
import {
  anchorsForLeg,
  composeAndCheck,
  dayWindows,
  isLongHaulArrival,
  mergeAnchors,
  legWeather,
  loadLegGroup,
  loadPlannerModules,
  mustOptions,
  picksFromReactions,
  writeComposedBlocks,
  type PlannerModules,
} from './runtime';
import { cityKey as cityKeyOf } from './catalog';
import type { ComposeDeps, ComposeLeg } from './types';

export type ComposeJobDeps = {
  planner: () => Promise<PlannerModules>;
  composeDeps: () => ComposeDeps;
  forecast: typeof fetchForecast;
  concurrency: number;
  heartbeatMs?: number;
  /** Traslados dentro de cada día después de armarlo (opcional: los tests que no lo pasan, lo saltean). */
  transfers?: (ctx: ToolCtx, args: { trip_id: string; leg_id: string }) => Promise<{ added: number }>;
};

export function defaultComposeJobDeps(): ComposeJobDeps {
  return {
    planner: loadPlannerModules,
    composeDeps: defaultComposeDeps,
    forecast: fetchForecast,
    concurrency: 3,
    transfers: (ctx, args) => addTransfers(ctx, args),
  };
}

type LegRow = { id: string; city: string; country: string | null; lat: number | null; lng: number | null; start_date: string; end_date: string };

export type ComposeStart = { job_id: string; trip_id: string; leg_ids: string[]; run: () => Promise<void> };

export async function startComposeDays(
  input: ToolInput<'compose_days'>,
  ctx: ToolCtx,
  deps?: Partial<ComposeJobDeps>,
): Promise<ComposeStart> {
  const { admin, userId } = ctx;
  const tripId = input.trip_id;
  const role = await loadTripRole(admin, tripId, userId);
  if (role === null) throw notFound('No encontré ese viaje (o no sos miembro).');
  if (role === 'follower') throw forbidden('Los seguidores no pueden armar el plan.');

  const [{ data: legsRaw, error: e1 }, { data: opts, error: e2 }, { data: blocks, error: e3 }, { data: mine, error: e4 }, { data: jobs, error: e5 }] =
    await Promise.all([
      admin.from('legs').select('id,city,country,lat,lng,start_date,end_date,sort_order').eq('trip_id', tripId).order('sort_order'),
      admin.from('leg_options').select('leg_id').eq('trip_id', tripId),
      admin.from('blocks').select('leg_id,type').eq('trip_id', tripId),
      admin.from('leg_members').select('leg_id').eq('user_id', userId),
      admin
        .from('agent_jobs')
        .select('id')
        .eq('trip_id', tripId)
        .in('kind', ['compose_days', 'plan_trip'])
        .in('status', ['queued', 'running'])
        .gte('updated_at', new Date(Date.now() - 2 * 60_000).toISOString()),
    ]);
  if (e1) throw dbError(e1, 'legs');
  if (e2) throw dbError(e2, 'leg_options');
  if (e3) throw dbError(e3, 'blocks');
  if (e4) throw dbError(e4, 'leg_members');
  if (e5) throw dbError(e5, 'agent_jobs');
  if (jobs?.length) throw conflict('job_running', 'Ya hay un plan armándose para este viaje.');

  const legs = (legsRaw ?? []) as LegRow[];
  const byId = new Map(legs.map((l) => [l.id, l]));
  if (input.leg_ids) {
    const bad = input.leg_ids.filter((id) => !byId.has(id));
    if (bad.length) throw badInput('Hay tramos (leg_ids) que no son de este viaje.');
  }
  const myLegs = new Set((mine ?? []).map((r) => r.leg_id as string));
  if (role !== 'organizer' && input.leg_ids?.some((id) => !myLegs.has(id))) {
    throw forbidden('Solo podés armar los días de los tramos en los que estás.');
  }
  const withMenu = new Set((opts ?? []).map((o) => o.leg_id as string));
  const armed = new Set((blocks ?? []).filter((b) => b.type !== 'transfer').map((b) => b.leg_id as string));
  const requested = input.leg_ids ? input.leg_ids.map((id) => byId.get(id)!) : legs;
  const targets = requested.filter((l) => withMenu.has(l.id) && !armed.has(l.id) && (role === 'organizer' || myLegs.has(l.id)));
  if (!targets.length) {
    throw conflict('trip_not_empty', 'No hay tramos con menú para armar: o ya tienen días armados o todavía no tienen opciones.');
  }

  const firstLine = 'Mirando lo que eligió el grupo…';
  const jobId = await createJob(admin, { kind: 'compose_days', trip_id: tripId, user_id: userId, firstLine });
  const full = { ...defaultComposeJobDeps(), ...deps };
  return {
    job_id: jobId,
    trip_id: tripId,
    leg_ids: targets.map((l) => l.id),
    run: () => runComposeDays({ jobId, tripId, legs: targets, allLegs: legs, instruction: input.instruction ?? null, ctx, firstLine }, full),
  };
}

type RunArgs = {
  jobId: string;
  tripId: string;
  legs: LegRow[];
  /** Todos los tramos del viaje (para saber cuál es el primero y a qué tramo va cada ancla). Default: legs. */
  allLegs?: LegRow[];
  instruction: string | null;
  ctx: ToolCtx;
  firstLine: string;
};

export async function runComposeDays(args: RunArgs, deps: ComposeJobDeps): Promise<void> {
  const { jobId, tripId, ctx } = args;
  const { admin } = ctx;
  const agentCtx: ToolCtx = { ...ctx, actor: 'agent' };
  const progress = new JobProgress(admin, jobId, [{ at: new Date().toISOString(), text: args.firstLine }]);
  const created: { id: string; leg_id: string }[] = [];
  const coverage: PlanCoverage[] = [];
  const issues: string[] = [];
  const failedLegs: { leg_id: string; city: string; error: string }[] = [];
  const busy = new Set<string>();
  let choices = 0;
  let fatal: string | null = null;

  const emptyLegIds = new Set(args.legs.map((l) => l.id));
  const onBlockAdded = (b: { id: string; leg_id: string; day_id: string | null; title: string }) => {
    created.push({ id: b.id, leg_id: b.leg_id });
  };

  await progress.set({ status: 'running' });
  progress.startHeartbeat(() => (busy.size ? `Sigo armando ${[...busy].join(' y ')}…` : 'Sigo acomodando los días…'), deps.heartbeatMs ?? 10_000);

  try {
    const m = await deps.planner();
    // Lo que entendió la entrevista (trip_brief → plan_trip.request) y las zonas de alojamiento del catálogo.
    const [{ data: prevJobs }, { data: cats }] = await Promise.all([
      admin
        .from('agent_jobs')
        .select('result')
        .eq('trip_id', tripId)
        .eq('kind', 'plan_trip')
        .not('result', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1),
      admin
        .from('destination_catalog')
        .select('city_key,lodging_zones')
        .in('city_key', args.legs.map((l) => cityKeyOf(l.city, l.country))),
    ]);
    const prevResult = prevJobs?.[0]?.result as PlanTripResult | undefined;
    const understanding = (prevResult?.request?.understanding ?? null) as TripUnderstanding | null;
    // Anclas (guardadas por plan_trip en request.understanding) y llegada internacional al primer tramo del viaje.
    const anchors = mergeAnchors(understanding?.anchors);
    const allLegs = args.allLegs?.length ? args.allLegs : args.legs;
    const firstLeg = [...allLegs].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const longHaulLegId =
      firstLeg && isLongHaulArrival(understanding?.origin, firstLeg.country, prevResult?.assumptions ?? []) ? firstLeg.id : null;
    const zonesByCity = new Map(
      ((cats ?? []) as { city_key: string; lodging_zones: ComposeLeg['lodgingZones'] | null }[]).map((c) => [c.city_key, c.lodging_zones ?? []]),
    );
    const results = await pool(args.legs, deps.concurrency, async (leg) => {
      busy.add(leg.city);
      try {
        const [{ data: optsRaw, error: e1 }, { data: reactRaw, error: e2 }, { data: days, error: e3 }, { data: lm, error: e4 }, { data: existing, error: e5 }] =
          await Promise.all([
            admin.from('leg_options').select('*').eq('leg_id', leg.id).order('sort_order'),
            admin.from('leg_option_reactions').select('option_id,user_id,reaction').eq('trip_id', tripId),
            admin.from('days').select('id,date').eq('leg_id', leg.id).order('date'),
            admin.from('leg_members').select('user_id').eq('leg_id', leg.id),
            admin.from('blocks').select('type,status,day_id,start_time,duration_min,lat,lng').eq('leg_id', leg.id),
          ]);
        if (e1) throw dbError(e1, 'leg_options');
        if (e2) throw dbError(e2, 'leg_option_reactions');
        if (e3) throw dbError(e3, 'days');
        if (e4) throw dbError(e4, 'leg_members');
        if (e5) throw dbError(e5, 'blocks');
        const options = (optsRaw ?? []) as LegOptionRow[];
        const optionIds = new Set(options.map((o) => o.id));
        const reactions = ((reactRaw ?? []) as LegOptionReactionRow[]).filter((r) => optionIds.has(r.option_id));
        const legDays = ((days ?? []) as { id: string; date: string }[]).map((d) => ({ id: d.id, date: d.date }));
        if (!legDays.length) throw new JobError('leg_failed', `El tramo ${leg.city} no tiene días.`);

        const picks = picksFromReactions(options, reactions);
        if (!picks.length) throw new JobError('leg_failed', `En ${leg.city} el grupo sacó todas las opciones: no hay nada para armar.`);
        const group = await loadLegGroup(admin, m, tripId, (lm ?? []).map((r) => r.user_id as string), understanding);
        const blocksNow = (existing ?? []) as { type: string; status: string; day_id: string | null; start_time: string | null; duration_min: number | null; lat: number | null; lng: number | null }[];
        const lodging = blocksNow.find((b) => b.type === 'lodging' && (b.status === 'confirmed' || b.status === 'booked') && b.lat != null && b.lng != null);
        const center = leg.lat != null && leg.lng != null ? { lat: leg.lat, lng: leg.lng } : null;
        const composeLeg: ComposeLeg = {
          id: leg.id,
          trip_id: tripId,
          city: leg.city,
          country: leg.country,
          center,
          days: legDays,
          dayWindows: dayWindows(legDays, blocksNow.filter((b) => b.type === 'transfer'), group.chronotype, {
            longHaulArrival: leg.id === longHaulLegId,
          }),
          weather: await legWeather(center, legDays.map((d) => d.date), deps.forecast),
          lodging: lodging ? { lat: lodging.lat!, lng: lodging.lng! } : null,
          lodgingZones: zonesByCity.get(cityKeyOf(leg.city, leg.country)) ?? [],
        };

        void progress.push(`Armando ${leg.city} por zonas con ${picks.length} lugares elegidos…`);
        const legAnchors = anchorsForLeg(anchors, leg, allLegs);
        const r = await composeAndCheck(m, { leg: composeLeg, group, picks, instruction: args.instruction, anchors: legAnchors }, deps.composeDeps(), {
          items: options.map((o) => o.item),
          mustOptions: mustOptions(options),
        });
        const planCtx: ToolCtx = { ...agentCtx, plan: { jobId, emptyLegIds, allowedLegIds: new Set([leg.id]), onBlockAdded } };
        const w = await writeComposedBlocks(planCtx, { trip_id: tripId, leg_id: leg.id, blocks: r.blocks });
        const known = new Set(created.map((b) => b.id));
        for (const id of w.ids) if (!known.has(id)) created.push({ id, leg_id: leg.id });
        if (!w.ids.length) throw new JobError('leg_failed', `No pude escribir los días de ${leg.city}.`);
        choices += w.choiceGroups;
        coverage.push({ ...r.coverage, choices: w.choiceGroups });
        issues.push(...r.issues);
        if (deps.transfers) {
          try {
            void progress.push(`Calculando cómo moverse en ${leg.city}…`);
            const tr = await deps.transfers(planCtx, { trip_id: tripId, leg_id: leg.id });
            if (tr.added) void progress.push(`Agregué ${tr.added} traslados en ${leg.city}`);
          } catch (e) {
            console.warn(`[compose_days/${jobId}] traslados ${leg.city}:`, (e as Error).message);
          }
        }
        void progress.push(
          `Listo ${leg.city}: ${w.ids.length} bloques, ${r.coverage.must_covered}/${r.coverage.must_total} imperdibles${w.choiceGroups ? `, ${w.choiceGroups} para elegir` : ''}`,
        );
        return w.ids.length;
      } finally {
        busy.delete(leg.city);
      }
    });
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const leg = args.legs[i];
        console.error(`[compose_days/${jobId}] ${leg.city}:`, r.reason);
        failedLegs.push({ leg_id: leg.id, city: leg.city, error: readable(r.reason) });
      }
    });
  } catch (err) {
    console.error(`[compose_days/${jobId}]`, err);
    fatal = readable(err);
  } finally {
    progress.stopHeartbeat();
  }

  const musts = coverage.reduce((a, c) => [a[0] + c.must_covered, a[1] + c.must_total], [0, 0]);
  const cities = args.legs.filter((l) => !failedLegs.some((f) => f.leg_id === l.id)).map((l) => l.city);
  const summary = created.length
    ? `Armé los días de ${cities.join(', ')}: ${created.length} bloques${musts[1] ? `, ${musts[0]}/${musts[1]} imperdibles` : ''}${choices ? `, ${choices} lugares para elegir` : ''}.`
    : 'No llegué a armar los días.';
  let undo_token: string | null = null;
  if (created.length) {
    try {
      const inverse: Op[] = created.map((b) => ({ op: 'remove' as const, block_id: b.id }));
      const feed = await insertFeed(agentCtx, {
        trip_id: tripId,
        kind: 'days_composed',
        payload: { summary: `${SCOUT.name} armó los días: ${summary}`, job_id: jobId, blocks: created.length, choices, inverse },
        undoable: true,
      });
      undo_token = feed.undo_token ?? null;
    } catch (err) {
      console.error(`[compose_days/${jobId}] days_composed:`, err);
    }
  }
  const result: ComposeDaysResult = {
    blocks: created.length,
    choices,
    summary,
    coverage,
    issues: [...new Set(issues)].slice(0, 20),
    undo_token,
    failed_legs: failedLegs,
  };
  const error = fatal ?? (failedLegs.length ? failedLegs.map((f) => f.error).join(' ') : null);
  if (error) {
    await progress.push(fatal ? `Se trancó: ${fatal}` : `Quedó a medias: ${failedLegs.map((f) => f.city).join(', ')}`);
    await progress.set({ status: 'failed', error, result });
  } else {
    await progress.push(`¡Listo! ${created.length} bloques${choices ? `, ${choices} lugares para elegir` : ''}`);
    await progress.set({ status: 'done', error: null, result });
  }
  await progress.flush();
}
