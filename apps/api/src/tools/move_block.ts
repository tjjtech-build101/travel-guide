import type { BlockRow, ToolInput } from '@build101/shared';
import { BLOCK_SELECT, loadBlock, updateBlockRow, type Op } from '../blocks';
import { badInput, dbError } from '../errors';
import { actorLabel, dayDate, emitBusyChanged, feedTitle, fmtDay, insertFeed } from '../feed';
import { travelMinutes } from '../google/routes';
import { decideWriteMode, loadMembership } from '../policy/writeMode';
import { compareBlocks, fromMin, insertIndex, recomputeTimes, toMin, type SchedChange } from '../schedule';
import type { ToolCtx, ToolOk } from './types';
import { enforce, propose } from './write';

/**
 * Mueve un bloque a otro día del mismo tramo (o al banco de ideas con day_id null).
 * `sort_order` = posición (0 = primero) dentro del día destino; sin él, se ubica por `start_time` o al final.
 * Después renumera sort_order del día y, con recompute_times, corre los bloques flexibles siguientes.
 */
export async function move_block(input: ToolInput<'move_block'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin } = ctx;
  const block = await loadBlock(admin, input.block_id);
  const membership = await loadMembership(admin, block.trip_id, block.leg_id, ctx.userId);
  const shape = { participant_ids: block.participant_ids, is_private: block.is_private, created_by: block.created_by };
  const decision = decideWriteMode({
    actorId: ctx.userId,
    actor: ctx.actor,
    role: membership.role,
    isLegMember: membership.isLegMember,
    before: shape,
    after: shape,
  });
  enforce(decision);

  const destDay = input.day_id;
  if (destDay) {
    const { data: day, error } = await admin.from('days').select('id,leg_id').eq('id', destDay).maybeSingle();
    if (error) throw dbError(error, 'days');
    if (!day) throw badInput('No existe ese día (day_id).');
    if (day.leg_id !== block.leg_id) {
      throw badInput('El día destino es de otro tramo. Para pasarlo de tramo, sacalo y agregalo de nuevo.');
    }
  }

  const [who, fromDate, toDate] = await Promise.all([
    actorLabel(ctx),
    dayDate(admin, block.day_id),
    dayDate(admin, destDay),
  ]);
  const title = feedTitle(block);
  const toLabel = destDay ? `al ${fmtDay(toDate)}` : 'al banco de ideas';

  if (decision.mode === 'propose') {
    const patch: Record<string, unknown> = { day_id: destDay };
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.start_time !== undefined) patch.start_time = input.start_time;
    if (!block.day_id && destDay && block.status === 'idea') patch.status = 'confirmed';
    if (block.day_id && !destDay && block.status !== 'booked') patch.status = 'idea';
    return propose(ctx, {
      trip_id: block.trip_id,
      leg_id: block.leg_id,
      day_id: destDay,
      ops: [{ op: 'move', block_id: block.id, patch }],
      summary: `${who} propone pasar ${title} ${toLabel}`,
      reason: input.reason,
    });
  }

  // Bloques del destino (sin el movido), en el orden en que se muestran.
  let q = admin.from('blocks').select(BLOCK_SELECT).eq('leg_id', block.leg_id).neq('id', block.id);
  q = destDay ? q.eq('day_id', destDay) : q.is('day_id', null);
  const { data: rows, error } = await q;
  if (error) throw dbError(error, 'blocks');
  const others = ((rows ?? []) as unknown as BlockRow[]).sort(compareBlocks);

  // Estado nuevo del bloque movido.
  const moved: BlockRow = { ...block, day_id: destDay };
  if (input.start_time !== undefined) {
    moved.start_time = fromMin(toMin(input.start_time) ?? 0);
    const dur = block.duration_min ?? durationOf(block);
    if (dur !== null) moved.end_time = fromMin((toMin(input.start_time) ?? 0) + dur);
  }
  const idx = insertIndex(others, { position: input.sort_order, start_time: moved.start_time });
  const ordered = [...others.slice(0, idx), moved, ...others.slice(idx)];

  // Cambios por bloque: sort_order renumerado + horarios recalculados.
  const changes = new Map<string, Record<string, unknown>>();
  const put = (id: string, c: Record<string, unknown>) => changes.set(id, { ...(changes.get(id) ?? {}), ...c });
  ordered.forEach((b, i) => {
    if (b.id === block.id || b.sort_order !== i) put(b.id, { sort_order: i });
  });
  put(block.id, { day_id: destDay });
  // Agendar una idea la confirma; mandar un bloque al banco de ideas lo vuelve idea (va en la inversa).
  if (!block.day_id && destDay && block.status === 'idea') put(block.id, { status: 'confirmed' });
  if (block.day_id && !destDay && block.status !== 'booked') put(block.id, { status: 'idea' });
  if (moved.start_time !== block.start_time) put(block.id, { start_time: moved.start_time });
  if (moved.end_time !== block.end_time) put(block.id, { end_time: moved.end_time });

  let timeChanges = new Map<string, SchedChange>();
  if (destDay && input.recompute_times) {
    timeChanges = await recomputeTimes(
      ordered,
      idx,
      travelMinutes,
      input.start_time !== undefined ? idx : undefined,
    );
    for (const [id, c] of timeChanges) put(id, c);
  }

  // Inversas (valores previos) y aplicación.
  const byId = new Map(ordered.map((b) => [b.id, b === moved ? block : b]));
  const inverse: Op[] = [];
  for (const [id, c] of changes) {
    const prev = byId.get(id) as unknown as Record<string, unknown>;
    const prevPatch = Object.fromEntries(Object.keys(c).map((k) => [k, prev[k] ?? null]));
    inverse.push(id === block.id ? { op: 'move', block_id: id, patch: prevPatch } : { op: 'update', block_id: id, patch: prevPatch });
  }
  for (const [id, c] of changes) {
    if (id !== block.id) await updateBlockRow(admin, id, c);
  }
  const updated = await updateBlockRow(admin, block.id, changes.get(block.id) ?? {});

  const changed_block_ids = [...timeChanges.entries()]
    .filter(([id, c]) => id !== block.id && (c.start_time !== undefined || c.end_time !== undefined))
    .map(([id]) => id);

  const fromLabel = block.day_id ? `del ${fmtDay(fromDate)}` : 'del banco de ideas';
  const same = block.day_id === destDay;
  const feed = await insertFeed(ctx, {
    trip_id: block.trip_id,
    kind: 'block_moved',
    payload: {
      summary: same ? `${who} reordenó ${title} ${fromLabel}` : `${who} pasó ${title} ${fromLabel} ${toLabel}`,
      block_id: block.id,
      day_id: destDay,
      from_day_id: block.day_id,
      changed_block_ids,
      inverse,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    undoable: true,
    private: block.is_private,
  });
  await emitBusyChanged(ctx, block.trip_id, [
    { block_id: block.id, is_private: block.is_private, day_ids: [block.day_id, destDay] },
    ...others.filter((b) => changes.has(b.id)).map((b) => ({ block_id: b.id, is_private: b.is_private, day_ids: [destDay] })),
  ]);
  return { ok: true, data: { mode: 'applied', block: updated, changed_block_ids }, ...feed };
}

function durationOf(b: { start_time: string | null; end_time: string | null }): number | null {
  const s = toMin(b.start_time);
  const e = toMin(b.end_time);
  return s !== null && e !== null && e > s ? e - s : null;
}
