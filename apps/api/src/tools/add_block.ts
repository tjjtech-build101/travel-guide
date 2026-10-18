import type { ToolInput } from '@build101/shared';
import { insertBlock } from '../blocks';
import { badInput, dbError } from '../errors';
import { actorLabel, dayDate, emitBusyChanged, feedTitle, fmtDay, insertFeed } from '../feed';
import { decideWriteMode, loadMembership } from '../policy/writeMode';
import { fromMin, toMin } from '../schedule';
import type { ToolCtx, ToolOk } from './types';
import { assertParticipants, defined, enforce, legMemberIds, propose } from './write';

/** `extra`: columnas que no expone la herramienta (p. ej. tour_id cuando el Scout suma un tour al plan). */
export async function addBlockImpl(input: ToolInput<'add_block'>, ctx: ToolCtx, extra: Record<string, unknown> = {}): Promise<ToolOk> {
  const { trip_id, leg_id, day_id, reason, participant_ids, ...fields } = input;
  const { admin } = ctx;
  if (ctx.plan && !ctx.plan.allowedLegIds.has(leg_id)) {
    throw badInput('En este trabajo solo podés agregar bloques al tramo que estás armando.');
  }
  // Excepción de plan_trip: solo en un día real de un tramo que estaba vacío al empezar el job.
  const planEmptyLeg = !!ctx.plan && ctx.plan.emptyLegIds.has(leg_id) && day_id !== null;

  // Pertenencia: el tramo es del viaje y el día es del tramo.
  const [{ data: leg, error: e1 }, membership] = await Promise.all([
    admin.from('legs').select('id,trip_id').eq('id', leg_id).maybeSingle(),
    loadMembership(admin, trip_id, leg_id, ctx.userId),
  ]);
  if (e1) throw dbError(e1, 'legs');
  if (!leg || leg.trip_id !== trip_id) throw badInput('El tramo (leg_id) no es de este viaje.');
  if (day_id) {
    const { data: day, error } = await admin.from('days').select('id,leg_id').eq('id', day_id).maybeSingle();
    if (error) throw dbError(error, 'days');
    if (!day || day.leg_id !== leg_id) throw badInput('El día (day_id) no es de ese tramo.');
  }

  // Participantes: explícitos, o [yo] si es privado, o los miembros del tramo.
  const isPrivate = fields.is_private ?? false;
  let participants: string[];
  if (participant_ids) {
    participants = [...new Set(participant_ids)];
    await assertParticipants(admin, trip_id, participants);
  } else if (isPrivate) {
    participants = [ctx.userId];
  } else {
    participants = await legMemberIds(admin, leg_id);
  }

  const decision = decideWriteMode({
    actorId: ctx.userId,
    actor: ctx.actor,
    role: membership.role,
    isLegMember: membership.isLegMember,
    after: { participant_ids: participants, is_private: isPrivate, created_by: ctx.userId },
    planEmptyLeg,
  });
  enforce(decision);

  // sort_order por defecto: al final del día (o del banco de ideas del tramo).
  let sort_order = fields.sort_order;
  if (sort_order === undefined) {
    let q = admin.from('blocks').select('sort_order').eq('leg_id', leg_id).order('sort_order', { ascending: false }).limit(1);
    q = day_id ? q.eq('day_id', day_id) : q.is('day_id', null);
    const { data, error } = await q;
    if (error) throw dbError(error, 'blocks');
    sort_order = ((data?.[0]?.sort_order as number | null | undefined) ?? -1) + 1;
  }

  // Si viene inicio + duración sin fin, completamos end_time (la UI y el recálculo lo usan).
  let end_time = fields.end_time;
  const startMin = toMin(fields.start_time);
  if (!end_time && startMin !== null && fields.duration_min) end_time = fromMin(startMin + fields.duration_min);

  const row = {
    ...defined({ ...fields, end_time }),
    trip_id,
    leg_id,
    day_id,
    sort_order,
    created_by: ctx.userId,
    created_by_agent: ctx.actor === 'agent',
    ...extra,
  };
  const [who, date] = await Promise.all([actorLabel(ctx), dayDate(admin, day_id)]);
  const where = day_id ? `al ${fmtDay(date)}` : 'al banco de ideas';
  const title = feedTitle({ title: fields.title, is_private: isPrivate });

  if (decision.mode === 'propose') {
    return propose(ctx, {
      trip_id,
      leg_id,
      day_id,
      ops: [{ op: 'add', block: { ...row, participant_ids: participants } }],
      summary: `${who} propone agregar ${title} ${where}`,
      reason,
    });
  }

  const block = await insertBlock(admin, { ...row, participant_ids: participants });
  if (planEmptyLeg && ctx.plan) {
    // Sin fila de feed por bloque: el job escribe una sola trip_planned que deshace todo.
    ctx.plan.onBlockAdded({ id: block.id, leg_id, day_id, title: block.title, type: block.type });
    return { ok: true, data: { mode: 'applied', block } };
  }
  const feed = await insertFeed(ctx, {
    trip_id,
    kind: 'block_added',
    payload: {
      summary: `${who} agregó ${title} ${where}`,
      block_id: block.id,
      day_id,
      inverse: [{ op: 'remove', block_id: block.id }],
      ...(reason ? { reason } : {}),
    },
    undoable: true,
    private: block.is_private,
  });
  await emitBusyChanged(ctx, trip_id, [{ block_id: block.id, is_private: block.is_private, day_ids: [day_id] }]);
  return { ok: true, data: { mode: 'applied', block }, ...feed };
}

export const add_block = (input: ToolInput<'add_block'>, ctx: ToolCtx) => addBlockImpl(input, ctx);
