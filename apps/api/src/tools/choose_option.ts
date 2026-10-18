import type { ChooseOptionResult, ToolInput } from '@build101/shared';
import { applyOps, loadBlock, previousValues, type BlockWithParticipants, type Op } from '../blocks';
import { conflict, dbError } from '../errors';
import { actorLabel, emitBusyChanged, feedTitle, insertFeed } from '../feed';
import { decideWriteMode, loadMembership, type WriteDecision } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';
import { enforce, propose } from './write';

const shape = (b: BlockWithParticipants) => ({ participant_ids: b.participant_ids, is_private: b.is_private, created_by: b.created_by });

/**
 * PRD 31 · elige una opción de un lugar del día (blocks.choice_group): la elegida queda confirmada (si era
 * propuesta; el alojamiento queda como idea) y las otras del grupo pasan al banco de ideas. Permiso como editar
 * el bloque (writeMode). 1 fila option_chosen con undo_token que restaura todo.
 */
export async function choose_option(
  input: ToolInput<'choose_option'>,
  ctx: ToolCtx,
): Promise<ToolOk<ChooseOptionResult & { mode: 'applied' | 'proposed'; proposal_id?: string }>> {
  const { admin } = ctx;
  const chosen: BlockWithParticipants = await loadBlock(admin, input.block_id);
  // choice_group se lee aparte (no está en BLOCK_COLUMNS: ver blocks.ts).
  const { data: cg, error: cgErr } = await admin.from('blocks').select('choice_group').eq('id', chosen.id).maybeSingle();
  if (cgErr) throw dbError(cgErr, 'blocks');
  chosen.choice_group = (cg?.choice_group as string | null | undefined) ?? null;
  if (!chosen.choice_group) throw conflict('not_a_choice', 'Ese bloque no es una opción para elegir (no tiene alternativas).');
  const { data: sib, error } = await admin.from('blocks').select('id').eq('choice_group', chosen.choice_group).neq('id', chosen.id);
  if (error) throw dbError(error, 'blocks');
  const others = await Promise.all(
    (sib ?? []).map(async (r) => ({ ...(await loadBlock(admin, r.id as string)), choice_group: chosen.choice_group })),
  );

  const membership = await loadMembership(admin, chosen.trip_id, chosen.leg_id, ctx.userId);
  const decisions: WriteDecision[] = [chosen, ...others].map((b) =>
    decideWriteMode({
      actorId: ctx.userId,
      actor: ctx.actor,
      role: membership.role,
      isLegMember: membership.isLegMember,
      before: shape(b),
      after: shape(b),
    }),
  );
  decisions.forEach(enforce);

  const chosenPatch: Record<string, unknown> = { choice_group: null };
  if (chosen.status === 'proposed' && chosen.type !== 'lodging') chosenPatch.status = 'confirmed';
  const otherPatch = { day_id: null, status: 'idea', choice_group: null };
  const ops: Op[] = [
    { op: 'update', block_id: chosen.id, patch: chosenPatch },
    ...others.map((b) => ({ op: 'update' as const, block_id: b.id, patch: { ...otherPatch } })),
  ];
  const discarded = others.map((b) => b.id);
  const who = await actorLabel(ctx);
  const title = feedTitle(chosen);

  if (decisions.some((d) => d.mode === 'propose')) {
    const p = await propose(ctx, {
      trip_id: chosen.trip_id,
      leg_id: chosen.leg_id,
      day_id: chosen.day_id,
      ops,
      summary: `${who} propone elegir ${title}${discarded.length ? ` (las otras ${discarded.length === 1 ? 'opción va' : 'opciones van'} al banco de ideas)` : ''}`,
    });
    const d = p.data as { proposal_id: string };
    return { ...p, data: { mode: 'proposed', proposal_id: d.proposal_id, block_id: chosen.id, discarded_block_ids: discarded } };
  }

  const inverse: Op[] = [
    { op: 'update', block_id: chosen.id, patch: previousValues(chosen, chosenPatch) },
    ...others.map((b) => ({ op: 'update' as const, block_id: b.id, patch: previousValues(b, otherPatch) })),
  ];
  const touched = await applyOps(admin, ops);
  const isPrivate = chosen.is_private || others.some((b) => b.is_private);
  const feed = await insertFeed(ctx, {
    trip_id: chosen.trip_id,
    kind: 'option_chosen',
    payload: {
      summary: `${who} eligió ${title}${discarded.length ? `; ${discarded.length === 1 ? 'la otra opción quedó' : `las otras ${discarded.length} quedaron`} en el banco de ideas` : ''}`,
      block_id: chosen.id,
      day_id: chosen.day_id,
      discarded_block_ids: discarded,
      inverse,
    },
    undoable: true,
    private: isPrivate,
  });
  await emitBusyChanged(ctx, chosen.trip_id, touched);
  return { ok: true, data: { mode: 'applied', block_id: chosen.id, discarded_block_ids: discarded }, ...feed };
}
