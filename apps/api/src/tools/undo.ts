import type { ActivityFeedRow, ToolInput } from '@build101/shared';
import { applyOps, type Op } from '../blocks';
import { conflict, dbError, forbidden, notFound } from '../errors';
import { actorLabel, emitBusyChanged, insertFeed } from '../feed';
import { loadTripRole } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

/** Revierte la acción de un undo_token. Solo el mismo actor o un organizer. Segundo undo → 409. */
export async function undo(input: ToolInput<'undo'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin } = ctx;
  const { data, error } = await admin
    .from('activity_feed')
    .select('id,trip_id,actor_user_id,actor_agent,kind,payload,undo_token,created_at')
    .eq('undo_token', input.undo_token)
    .maybeSingle();
  if (error) throw dbError(error, 'activity_feed');
  if (!data) throw notFound('No encontré esa acción para deshacer.');
  const feed = data as ActivityFeedRow;
  feed.payload ??= { summary: '' };

  const role = await loadTripRole(admin, feed.trip_id, ctx.userId);
  if (role === null) throw forbidden('No sos miembro de este viaje.');
  if (feed.actor_user_id !== ctx.userId && role !== 'organizer') {
    throw forbidden('Solo quien hizo el cambio o un organizador lo puede deshacer.');
  }

  const { data: prior, error: e2 } = await admin
    .from('activity_feed')
    .select('id')
    .eq('trip_id', feed.trip_id)
    .eq('kind', 'undo')
    .eq('payload->>undo_of', feed.id)
    .limit(1);
  if (e2) throw dbError(e2, 'activity_feed');
  if (prior && prior.length) throw conflict('already_undone', 'Eso ya se deshizo.');

  let touched: Awaited<ReturnType<typeof applyOps>> = [];
  const proposalId = typeof feed.payload.proposal_id === 'string' ? feed.payload.proposal_id : null;
  if (feed.kind === 'running_late') {
    // report_late: deshacer borra el aviso (no tocó bloques).
    const { error: e4 } = await admin.from('activity_feed').delete().eq('id', feed.id);
    if (e4) throw dbError(e4, 'activity_feed');
  } else if (feed.kind === 'proposal_created' && proposalId) {
    const { data: rows, error: e3 } = await admin
      .from('agent_proposals')
      .update({ status: 'rejected', decided_by: ctx.userId, decided_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('status', 'pending')
      .select('id');
    if (e3) throw dbError(e3, 'agent_proposals');
    if (!rows?.length) throw conflict('proposal_decided', 'Esa propuesta ya se decidió; no se puede deshacer así.');
  } else {
    touched = await applyOps(admin, (feed.payload.inverse ?? []) as Op[]);
  }

  const who = await actorLabel(ctx);
  const undoFeed = await insertFeed(ctx, {
    trip_id: feed.trip_id,
    kind: 'undo',
    payload: { summary: `${who} deshizo: ${feed.payload.summary}`, undo_of: feed.id },
    undoable: false,
    private: feed.payload.private === true,
  });
  await emitBusyChanged(ctx, feed.trip_id, touched);
  return { ok: true, data: { reverted: true, feed_id: undoFeed.feed_id, undo_of: feed.id }, feed_id: undoFeed.feed_id };
}
