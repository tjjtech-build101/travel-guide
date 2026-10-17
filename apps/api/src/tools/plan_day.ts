// plan_day (Ahora v2): Scout arma el hueco [from_time, to_time) del día y lo deja como UNA propuesta
// (agent_proposals). Nunca aplica, ni siquiera si lo pide la persona (x-actor: user): se acepta en la UI de propuestas.
import { walkEstimateMin, type BlockRow, type ToolInput } from '@build101/shared';
import { anthropicPlanDay, PLAN_DAY_SYSTEM, renderPlanDayUser, sanitizePlan, type PlanDayLLM } from '../agents/planDay';
import { BLOCK_SELECT, type Op } from '../blocks';
import { env } from '../env';
import { badInput, dbError, ToolFailure } from '../errors';
import { compareBlocks, fromMin, toMin } from '../schedule';
import { decideWriteMode, loadMembership } from '../policy/writeMode';
import { loadBankIdeas, maxWalkFor, nearbyOpenPlaces, radiusFor } from './gap_suggestions';
import type { ToolCtx, ToolOk } from './types';
import { enforce, legMemberIds, propose } from './write';

const DEFAULT_END = '22:00';
const MIN_GAP = 30;
const LLM_TIMEOUT_MS = 45_000;

/** "HH:MM" para textos (fromMin devuelve HH:MM:SS, el formato de la DB). */
const hhmm = (m: number) => fromMin(m).slice(0, 5);

export const scoutUnavailable = () => new ToolFailure(503, 'scout_unavailable', 'Scout no está disponible ahora.');

/** Fin del hueco: el pedido, o el próximo bloque con hora después de `from`, o 22:00. */
export function gapEnd(from: number, blocks: { start_time: string | null }[], to?: string): number {
  if (to) return toMin(to) ?? toMin(DEFAULT_END)!;
  const starts = blocks.map((b) => toMin(b.start_time)).filter((m): m is number => m !== null && m > from);
  return Math.min(toMin(DEFAULT_END)!, ...starts);
}

export async function planDayImpl(input: ToolInput<'plan_day'>, ctx: ToolCtx, llm: PlanDayLLM = anthropicPlanDay()): Promise<ToolOk> {
  const { admin } = ctx;
  const { data: day, error } = await admin.from('days').select('id,leg_id,date').eq('id', input.day_id).maybeSingle();
  if (error) throw dbError(error, 'days');
  if (!day) throw badInput('No existe ese día (day_id).');
  const { data: leg, error: e2 } = await admin.from('legs').select('id,trip_id,city,lat,lng').eq('id', day.leg_id).maybeSingle();
  if (e2) throw dbError(e2, 'legs');
  if (!leg || leg.trip_id !== input.trip_id) throw badInput('El día (day_id) no es de este viaje.');

  // Permisos: los mismos que para proponer en el tramo (el agente propone en lo compartido).
  const [membership, members] = await Promise.all([
    loadMembership(admin, input.trip_id, leg.id as string, ctx.userId),
    legMemberIds(admin, leg.id as string),
  ]);
  enforce(
    decideWriteMode({
      actorId: ctx.userId,
      actor: 'agent',
      role: membership.role,
      isLegMember: membership.isLegMember,
      after: { participant_ids: members, is_private: false, created_by: ctx.userId },
    }),
  );

  const { data: rows, error: e3 } = await admin.from('blocks').select(BLOCK_SELECT).eq('day_id', day.id);
  if (e3) throw dbError(e3, 'blocks');
  const dayBlocks = ((rows ?? []) as unknown as BlockRow[])
    .filter((b) => !b.plan_variant || b.plan_variant === 'main')
    .sort(compareBlocks);

  const from = toMin(input.from_time)!;
  const to = gapEnd(from, dayBlocks, input.to_time);
  if (to - from < MIN_GAP) throw badInput('No hay un hueco libre de al menos 30 min en ese horario.');

  // Lo ocupado: los privados ajenos se ven como "Ocupado" (sin título).
  const busy = dayBlocks
    .filter((b) => b.start_time)
    .map((b) => {
      const start = toMin(b.start_time)!;
      const end = toMin(b.end_time) ?? start + (b.duration_min ?? 60);
      const mine = !b.is_private || b.created_by === ctx.userId;
      return { title: mine ? b.title : 'Ocupado', start_time: hhmm(start), end_time: hhmm(end), start, end };
    });

  const here =
    input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng }
      : leg.lat != null && leg.lng != null
        ? { lat: leg.lat as number, lng: leg.lng as number }
        : null;
  const [ideasAll, placesAll] = await Promise.all([
    loadBankIdeas(admin, leg.id as string, ctx.userId),
    here ? nearbyOpenPlaces(here, radiusFor(maxWalkFor(Math.min(to - from, 120)) * 2), 10) : Promise.resolve([]),
  ]);
  const walk = (p: { lat: number | null; lng: number | null }) =>
    here && p.lat != null && p.lng != null ? walkEstimateMin(here, { lat: p.lat, lng: p.lng }) : null;
  const ideas = ideasAll.slice(0, 30).map((i) => ({ ...i, walk_min: walk(i) }));
  const places = placesAll.map((p, i) => ({ ref: `p${i + 1}`, ...p, walk_min: walk(p) }));

  let plan;
  try {
    plan = await llm.plan({
      system: PLAN_DAY_SYSTEM,
      user: renderPlanDayUser({
        date: day.date as string,
        city: (leg.city as string | null) ?? null,
        from: hhmm(from),
        to: hhmm(to),
        reason: input.reason,
        busy,
        ideas,
        places: places.map((p) => ({ ref: p.ref, name: p.name, address: p.address, types: p.types, rating: p.rating, walk_min: p.walk_min })),
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[plan_day] sin Claude:', (err as Error)?.message ?? err);
    throw scoutUnavailable();
  }

  const items = sanitizePlan(plan, {
    from,
    to,
    busy,
    ideaIds: new Set(ideas.map((i) => i.id)),
    placeRefs: new Set(places.map((p) => p.ref)),
  });
  if (!items.length) throw new ToolFailure(422, 'empty_plan', 'Scout no encontró nada para proponer en ese horario.');

  const maxSort = Math.max(-1, ...dayBlocks.map((b) => b.sort_order ?? -1));
  const ops: Op[] = items.map((it, i) => {
    const times = { start_time: fromMin(it.start), end_time: fromMin(it.end), duration_min: it.end - it.start };
    if (it.idea_id) {
      // Una idea del banco se agenda (move): no se duplica.
      return { op: 'move', block_id: it.idea_id, patch: { day_id: day.id, ...times, status: 'confirmed' } };
    }
    const place = it.place_ref ? places.find((p) => p.ref === it.place_ref) : undefined;
    return {
      op: 'add',
      block: {
        trip_id: input.trip_id,
        leg_id: leg.id,
        day_id: day.id,
        type: it.type,
        title: it.title,
        description: it.description ?? null,
        place_name: place?.name ?? null,
        google_place_id: place?.google_place_id ?? null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        ...times,
        status: 'confirmed',
        sort_order: maxSort + 1 + i,
        created_by: ctx.userId,
        created_by_agent: true,
        participant_ids: members,
      },
    };
  });

  const range = `${hhmm(from)}–${hhmm(to)}`;
  const summary = `Scout propone ${items.length === 1 ? '1 plan' : `${items.length} planes`} para ${range}: ${plan.summary.trim()}`.slice(0, 200);
  const res = await propose({ ...ctx, actor: 'agent' }, {
    trip_id: input.trip_id,
    leg_id: leg.id as string,
    day_id: day.id as string,
    ops,
    summary,
    reason: input.reason ?? 'Armame la tarde',
  });
  const proposal_id = (res.data as { proposal_id: string }).proposal_id;
  return {
    ...res,
    data: {
      mode: 'proposed',
      proposal_id,
      summary,
      count: items.length,
      blocks: items.map((it) => ({ title: it.title, start_time: hhmm(it.start), end_time: hhmm(it.end), from_idea: !!it.idea_id })),
    },
  };
}

export async function plan_day(input: ToolInput<'plan_day'>, ctx: ToolCtx): Promise<ToolOk> {
  if (!env().ANTHROPIC_API_KEY) throw scoutUnavailable();
  return planDayImpl(input, ctx);
}
