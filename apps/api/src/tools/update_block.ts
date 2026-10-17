import type { ToolInput } from '@build101/shared';
import { loadBlock, previousValues, updateBlockRow } from '../blocks';
import { badInput } from '../errors';
import { actorLabel, emitBusyChanged, feedTitle, insertFeed } from '../feed';
import { decideWriteMode, loadMembership } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';
import { assertParticipants, defined, enforce, propose } from './write';

export async function update_block(input: ToolInput<'update_block'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin } = ctx;
  const patch = defined(input.patch) as Record<string, unknown> & { participant_ids?: string[] };
  if (!Object.keys(patch).length) throw badInput('El patch está vacío.');

  const before = await loadBlock(admin, input.block_id);
  const membership = await loadMembership(admin, before.trip_id, before.leg_id, ctx.userId);
  if (patch.participant_ids) {
    patch.participant_ids = [...new Set(patch.participant_ids)];
    await assertParticipants(admin, before.trip_id, patch.participant_ids);
  }

  const decision = decideWriteMode({
    actorId: ctx.userId,
    actor: ctx.actor,
    role: membership.role,
    isLegMember: membership.isLegMember,
    before: { participant_ids: before.participant_ids, is_private: before.is_private, created_by: before.created_by },
    after: {
      participant_ids: patch.participant_ids ?? before.participant_ids,
      is_private: (patch.is_private as boolean | undefined) ?? before.is_private,
      created_by: before.created_by,
    },
  });
  enforce(decision);

  const who = await actorLabel(ctx);
  const title = feedTitle(before);

  if (decision.mode === 'propose') {
    return propose(ctx, {
      trip_id: before.trip_id,
      leg_id: before.leg_id,
      day_id: before.day_id,
      ops: [{ op: 'update', block_id: before.id, patch }],
      summary: `${who} propone cambiar ${title}`,
      reason: input.reason,
    });
  }

  const inverse = [{ op: 'update' as const, block_id: before.id, patch: previousValues(before, patch) }];
  const block = await updateBlockRow(admin, before.id, patch);
  const feed = await insertFeed(ctx, {
    trip_id: before.trip_id,
    kind: 'block_updated',
    payload: {
      summary: `${who} cambió ${title}`,
      block_id: before.id,
      day_id: before.day_id,
      inverse,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    undoable: true,
    private: before.is_private || block.is_private,
  });
  await emitBusyChanged(ctx, before.trip_id, [
    { block_id: before.id, is_private: before.is_private || block.is_private, day_ids: [before.day_id] },
  ]);
  return { ok: true, data: { mode: 'applied', block }, ...feed };
}
