import type { ToolInput } from '@build101/shared';
import { deleteBlockRow, loadBlock, snapshot } from '../blocks';
import { actorLabel, dayDate, emitBusyChanged, feedTitle, fmtDay, insertFeed } from '../feed';
import { decideWriteMode, loadMembership } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';
import { enforce, propose } from './write';

export async function remove_block(input: ToolInput<'remove_block'>, ctx: ToolCtx): Promise<ToolOk> {
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

  const [who, date] = await Promise.all([actorLabel(ctx), dayDate(admin, block.day_id)]);
  const title = feedTitle(block);
  const where = block.day_id ? `del ${fmtDay(date)}` : 'del banco de ideas';

  if (decision.mode === 'propose') {
    return propose(ctx, {
      trip_id: block.trip_id,
      leg_id: block.leg_id,
      day_id: block.day_id,
      ops: [{ op: 'remove', block_id: block.id }],
      summary: `${who} propone sacar ${title} ${where}`,
      reason: input.reason,
    });
  }

  const inverse = [{ op: 'add' as const, block: snapshot(block) }];
  await deleteBlockRow(admin, block.id);
  const feed = await insertFeed(ctx, {
    trip_id: block.trip_id,
    kind: 'block_removed',
    payload: {
      summary: `${who} sacó ${title} ${where}`,
      block_id: block.id,
      day_id: block.day_id,
      inverse,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    undoable: true,
    private: block.is_private,
  });
  await emitBusyChanged(ctx, block.trip_id, [{ block_id: block.id, is_private: block.is_private, day_ids: [block.day_id] }]);
  return { ok: true, data: { mode: 'applied', block_id: block.id }, ...feed };
}
