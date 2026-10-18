// PRD 11 · decide_proposal: aceptar o rechazar una propuesta pendiente (agent_proposals).
// Aceptar aplica TODAS las ops o ninguna: se reclama la propuesta (pending → accepted) para que dos personas no la
// apliquen dos veces, se aplica en orden guardando las inversas y, si una op falla, se deshace lo aplicado y la
// propuesta vuelve a pending. supabase-js no expone transacciones; esto es lo más cerca sin conexión directa a Postgres.
// Expiración perezosa: más de 24 h, o un bloque afectado cambió (o ya no está) después de crearla → expired.
import { PROPOSAL_TTL_MS, type AgentProposalRow, type DecideProposalResult, type ProposalStatus, type ToolInput } from '@build101/shared';
import {
  applyOps,
  deleteBlockRow,
  insertBlock,
  loadBlock,
  previousValues,
  snapshot,
  updateBlockRow,
  type BlockWithParticipants,
  type Op,
  type Touched,
} from '../blocks';
import { badInput, conflict, dbError, forbidden, notFound, ToolFailure } from '../errors';
import { actorLabel, emitBusyChanged, insertFeed } from '../feed';
import { decideWriteMode, loadMembership, loadTripRole } from '../policy/writeMode';
import { fromMin, toMin } from '../schedule';
import type { ToolCtx, ToolOk } from './types';
import { enforce } from './write';

const PROPOSAL_SELECT = 'id,trip_id,leg_id,day_id,created_by,by_agent,summary,reason,ops,status,decided_by,decided_at,created_at';

const DECIDED_LABEL: Record<ProposalStatus, string> = {
  pending: 'está pendiente',
  accepted: 'se aceptó',
  rejected: 'se rechazó',
  expired: 'venció',
  applied_urgent: 'ya se aplicó',
};

type Result = ToolOk<DecideProposalResult>;

export async function decide_proposal(input: ToolInput<'decide_proposal'>, ctx: ToolCtx): Promise<Result> {
  const p = await loadProposal(ctx, input);

  // Permisos: organizer, o viajero del tramo de la propuesta. Seguidor / no miembro → 403.
  const role = await loadTripRole(ctx.admin, p.trip_id, ctx.userId);
  if (role === null) throw forbidden('No sos miembro de este viaje.');
  if (role === 'follower') throw forbidden('Los seguidores no pueden decidir propuestas.');
  if (role !== 'organizer' && p.leg_id) {
    const m = await loadMembership(ctx.admin, p.trip_id, p.leg_id, ctx.userId);
    if (!m.isLegMember) throw forbidden('Solo deciden quienes están en ese tramo del viaje.');
  }

  if (p.status !== 'pending') throw conflict('proposal_decided', `Esa propuesta ya ${DECIDED_LABEL[p.status]}.`);
  if (Date.now() - Date.parse(p.created_at) > PROPOSAL_TTL_MS) {
    return expire(ctx, p, 'Pasaron más de 24 horas desde que se propuso.');
  }

  // Lo decide una persona (aunque lo pida por voz): el feed lleva su nombre, no el del Scout.
  const who = await actorLabel({ ...ctx, actor: 'user' });
  return input.decision === 'reject' ? reject(ctx, p, who, input.note) : accept(ctx, p, who, input.note);
}

async function loadProposal(ctx: ToolCtx, input: ToolInput<'decide_proposal'>): Promise<AgentProposalRow> {
  if (input.proposal_id) {
    const { data, error } = await ctx.admin.from('agent_proposals').select(PROPOSAL_SELECT).eq('id', input.proposal_id).maybeSingle();
    if (error) throw dbError(error, 'agent_proposals');
    if (!data) throw notFound('No encontré esa propuesta.');
    return data as unknown as AgentProposalRow;
  }
  if (!input.trip_id) throw badInput('Falta proposal_id (o trip_id para decidir la última pendiente).');
  const { data, error } = await ctx.admin
    .from('agent_proposals')
    .select(PROPOSAL_SELECT)
    .eq('trip_id', input.trip_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw dbError(error, 'agent_proposals');
  const p = data?.[0] as unknown as AgentProposalRow | undefined;
  if (!p) throw notFound('No hay propuestas pendientes en este viaje.');
  return p;
}

/** pending → status, solo si sigue pending (el que llega segundo recibe 0 filas). */
async function claim(ctx: ToolCtx, p: AgentProposalRow, status: 'accepted' | 'rejected' | 'expired'): Promise<boolean> {
  const { data, error } = await ctx.admin
    .from('agent_proposals')
    .update({ status, decided_by: status === 'expired' ? null : ctx.userId, decided_at: new Date().toISOString() })
    .eq('id', p.id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw dbError(error, 'agent_proposals');
  return !!data?.length;
}

async function expire(ctx: ToolCtx, p: AgentProposalRow, why: string): Promise<Result> {
  if (await claim(ctx, p, 'expired')) {
    await insertFeed(ctx, {
      trip_id: p.trip_id,
      kind: 'proposal_expired',
      payload: { summary: `Venció la propuesta: ${p.summary}`, proposal_id: p.id, why },
      undoable: false,
    });
  }
  return {
    ok: true,
    data: { proposal_id: p.id, status: 'expired', applied_block_ids: [], summary: `La propuesta venció: ${why} Pedile al Scout que la vuelva a armar.` },
  };
}

async function reject(ctx: ToolCtx, p: AgentProposalRow, who: string, note?: string): Promise<Result> {
  if (!(await claim(ctx, p, 'rejected'))) throw conflict('proposal_decided', 'Esa propuesta ya se decidió.');
  const feed = await insertFeed(ctx, {
    trip_id: p.trip_id,
    kind: 'proposal_rejected',
    payload: { summary: `${who} rechazó: ${p.summary}`, proposal_id: p.id, ...(note ? { note } : {}) },
    undoable: false,
  });
  return { ok: true, data: { proposal_id: p.id, status: 'rejected', applied_block_ids: [], summary: p.summary }, feed_id: feed.feed_id };
}

async function accept(ctx: ToolCtx, p: AgentProposalRow, who: string, note?: string): Promise<Result> {
  const { admin } = ctx;
  const ops = (p.ops ?? []) as Op[];
  if (!ops.length) throw badInput('La propuesta no tiene cambios.');

  // 1. Validar antes de tocar nada: cada bloque afectado existe, no cambió desde la propuesta y la persona puede editarlo.
  const targetIds = [...new Set(ops.flatMap((o) => ('block_id' in o ? [o.block_id] : [])))];
  const current = new Map<string, BlockWithParticipants>();
  for (const id of targetIds) {
    let b: BlockWithParticipants;
    try {
      b = await loadBlock(admin, id);
    } catch (e) {
      if (e instanceof ToolFailure && e.status === 404) return expire(ctx, p, 'Uno de los bloques ya no está en el plan.');
      throw e;
    }
    if (Date.parse(b.updated_at) > Date.parse(p.created_at)) {
      return expire(ctx, p, `Alguien cambió «${b.is_private ? 'un bloque privado' : b.title}» después de la propuesta.`);
    }
    current.set(id, b);
  }
  const legIds = [...new Set([...current.values()].map((b) => b.leg_id).concat(ops.flatMap((o) => (o.op === 'add' && typeof o.block.leg_id === 'string' ? [o.block.leg_id] : []))))];
  const memberships = new Map(await Promise.all(legIds.map(async (l) => [l, await loadMembership(admin, p.trip_id, l, ctx.userId)] as const)));
  for (const o of ops) {
    if (o.op === 'remove_leg') throw badInput('Una propuesta no puede borrar tramos.');
    const b = 'block_id' in o ? current.get(o.block_id) : undefined;
    const legId = b?.leg_id ?? (o.op === 'add' ? (o.block.leg_id as string | undefined) : undefined);
    const m = legId ? memberships.get(legId) : undefined;
    if (o.op === 'add' && (!legId || o.block.trip_id !== p.trip_id)) throw badInput('La propuesta agrega un bloque fuera de este viaje.');
    if (b && b.status === 'booked' && (o.op === 'remove' || o.op === 'move')) {
      throw conflict('booked', `«${b.title}» está reservado: la propuesta no lo puede mover ni sacar.`);
    }
    const shape = b ? { participant_ids: b.participant_ids, is_private: b.is_private, created_by: b.created_by } : undefined;
    const addParts = o.op === 'add' && Array.isArray(o.block.participant_ids) ? (o.block.participant_ids as string[]) : [];
    enforce(
      decideWriteMode({
        actorId: ctx.userId,
        actor: 'user', // quien decide es una persona: la regla de propuesta ya se aplicó al crearla
        role: m?.role ?? null,
        isLegMember: m?.isLegMember ?? false,
        before: shape,
        after: shape ?? { participant_ids: addParts, is_private: o.op === 'add' && o.block.is_private === true, created_by: p.created_by },
      }),
    );
  }

  // 2. Reclamar: si otro la decidió en el medio, no aplicamos nada.
  if (!(await claim(ctx, p, 'accepted'))) throw conflict('proposal_decided', 'Esa propuesta ya se decidió.');

  // 3. Aplicar en orden. inverse queda en orden inverso (lo último aplicado se deshace primero).
  const inverse: Op[] = [];
  const touched: Touched[] = [];
  const applied: string[] = [];
  try {
    for (const o of ops) {
      if (o.op === 'add') {
        const { id: _drop, ...row } = o.block as Record<string, unknown> & { participant_ids?: string[] };
        if (row.status === 'proposed') row.status = 'confirmed';
        row.created_by_agent = p.by_agent;
        const b = await insertBlock(admin, row);
        inverse.unshift({ op: 'remove', block_id: b.id });
        touched.push({ block_id: b.id, is_private: b.is_private, day_ids: [b.day_id] });
        applied.push(b.id);
      } else if (o.op === 'remove') {
        const before = await loadBlock(admin, o.block_id);
        inverse.unshift({ op: 'add', block: snapshot(before) });
        await deleteBlockRow(admin, o.block_id);
        touched.push({ block_id: before.id, is_private: before.is_private, day_ids: [before.day_id] });
        applied.push(before.id);
      } else if (o.op === 'update' || o.op === 'move') {
        const before = await loadBlock(admin, o.block_id);
        const patch = o.op === 'move' ? await movePatch(ctx, before, o.patch) : { ...o.patch };
        const prev = previousValues(before, patch);
        if ('choice_group' in patch) prev.choice_group = await choiceGroupOf(ctx, before.id);
        inverse.unshift({ op: o.op, block_id: before.id, patch: prev } as Op);
        const after = await updateBlockRow(admin, before.id, patch);
        touched.push({ block_id: before.id, is_private: before.is_private || after.is_private, day_ids: [before.day_id, after.day_id] });
        applied.push(before.id);
      }
    }
  } catch (err) {
    console.error(`[decide_proposal/${p.id}] falló al aplicar; deshago lo aplicado`, err);
    try {
      await applyOps(admin, inverse);
    } catch (rollbackErr) {
      console.error(`[decide_proposal/${p.id}] el rollback también falló`, rollbackErr);
    }
    await admin.from('agent_proposals').update({ status: 'pending', decided_by: null, decided_at: null }).eq('id', p.id);
    const msg = err instanceof Error ? err.message : String(err);
    throw conflict('apply_failed', `No pude aplicar la propuesta, así que no cambié nada. (${msg})`);
  }

  const feed = await insertFeed(ctx, {
    trip_id: p.trip_id,
    kind: 'proposal_accepted',
    payload: {
      summary: `${who} aceptó: ${p.summary}`,
      proposal_id: p.id,
      day_id: p.day_id,
      block_ids: applied,
      inverse,
      ...(note ? { note } : {}),
    },
    undoable: true,
    private: touched.some((t) => t.is_private),
  });
  await emitBusyChanged(ctx, p.trip_id, touched);
  return {
    ok: true,
    data: { proposal_id: p.id, status: 'accepted', applied_block_ids: [...new Set(applied)], summary: p.summary },
    ...feed,
  };
}

/**
 * Patch de un move al aplicarlo: si trae hora de inicio, corre el fin con la duración del bloque; si no trae
 * posición, va al final del día destino (como move_block sin sort_order ni hora).
 */
async function movePatch(ctx: ToolCtx, before: BlockWithParticipants, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const patch = { ...raw };
  const start = typeof patch.start_time === 'string' ? toMin(patch.start_time) : null;
  if (start !== null) {
    patch.start_time = fromMin(start);
    const s0 = toMin(before.start_time);
    const e0 = toMin(before.end_time);
    const dur = before.duration_min ?? (s0 !== null && e0 !== null && e0 > s0 ? e0 - s0 : null);
    if (dur) patch.end_time = fromMin(start + dur);
  }
  if (patch.sort_order === undefined && 'day_id' in patch && patch.day_id !== before.day_id) {
    let q = ctx.admin.from('blocks').select('sort_order').eq('leg_id', before.leg_id).order('sort_order', { ascending: false }).limit(1);
    q = typeof patch.day_id === 'string' ? q.eq('day_id', patch.day_id) : q.is('day_id', null);
    const { data, error } = await q;
    if (error) throw dbError(error, 'blocks');
    patch.sort_order = ((data?.[0]?.sort_order as number | null | undefined) ?? -1) + 1;
  }
  return patch;
}

/** blocks.choice_group va fuera de BLOCK_COLUMNS (ver blocks.ts): lo leemos aparte para la inversa. */
async function choiceGroupOf(ctx: ToolCtx, blockId: string): Promise<string | null> {
  const { data } = await ctx.admin.from('blocks').select('choice_group').eq('id', blockId).maybeSingle();
  return (data?.choice_group as string | null | undefined) ?? null;
}
