// Piezas comunes de las herramientas de escritura.
import type { Db } from '../supabase';
import type { Op } from '../blocks';
import type { ToolCtx, ToolOk } from './types';
import { badInput, dbError, forbidden } from '../errors';
import { insertFeed } from '../feed';
import type { WriteDecision } from '../policy/writeMode';

export async function legMemberIds(admin: Db, legId: string): Promise<string[]> {
  const { data, error } = await admin.from('leg_members').select('user_id').eq('leg_id', legId);
  if (error) throw dbError(error, 'leg_members');
  return (data ?? []).map((r) => r.user_id as string);
}

/** Los participantes tienen que ser miembros (no seguidores) del viaje. */
export async function assertParticipants(admin: Db, tripId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await admin.from('trip_members').select('user_id,role').eq('trip_id', tripId).in('user_id', ids);
  if (error) throw dbError(error, 'trip_members');
  const ok = new Set((data ?? []).filter((r) => r.role !== 'follower').map((r) => r.user_id as string));
  const bad = [...new Set(ids)].filter((id) => !ok.has(id));
  if (bad.length) throw badInput(`Estos participantes no son viajeros del viaje: ${bad.join(', ')}`);
}

export function enforce(decision: WriteDecision): void {
  if (decision.mode === 'forbidden') throw forbidden(decision.reason);
}

/** Agente + compartido: crea agent_proposals pending (no toca blocks) + 1 fila proposal_created deshacible. */
export async function propose(
  ctx: ToolCtx,
  p: { trip_id: string; leg_id: string | null; day_id: string | null; ops: Op[]; summary: string; reason?: string },
): Promise<ToolOk> {
  const { data, error } = await ctx.admin
    .from('agent_proposals')
    .insert({
      trip_id: p.trip_id,
      leg_id: p.leg_id,
      day_id: p.day_id,
      created_by: ctx.userId,
      by_agent: true,
      summary: p.summary,
      reason: p.reason ?? null,
      ops: p.ops,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'agent_proposals');
  const proposal_id = data.id as string;
  const feed = await insertFeed(ctx, {
    trip_id: p.trip_id,
    kind: 'proposal_created',
    payload: { summary: p.summary, proposal_id, inverse: [] },
    undoable: true,
  });
  return { ok: true, data: { mode: 'proposed', proposal_id }, ...feed };
}

/** Quita claves undefined (Zod deja fuera las opcionales que no vinieron, pero por las dudas). */
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
