// Acceso a blocks / block_participants con service role (después de que la policy decidió) y aplicación de ops.
// Formato de op = agent_proposals.ops = activity_feed.payload.inverse: {op, block_id?, block?, patch?}.
import type { BlockRow } from '@build101/shared';
import type { Db } from './supabase';
import { dbError, notFound } from './errors';

export const BLOCK_COLUMNS = [
  'id',
  'trip_id',
  'leg_id',
  'day_id',
  'type',
  'title',
  'description',
  'google_place_id',
  'place_name',
  'lat',
  'lng',
  'start_time',
  'end_time',
  'time_flex',
  'duration_min',
  'is_private',
  'status',
  'plan_variant',
  'cost_estimate',
  'cost_currency',
  'booking_url',
  'notes',
  'transfer',
  'alerts',
  'sources',
  'tour_id',
  'sort_order',
  'created_by',
  'created_by_agent',
  'created_at',
  'updated_at',
] as const;
export const BLOCK_SELECT = BLOCK_COLUMNS.join(',');
// PRD 31: blocks.choice_group NO va en BLOCK_COLUMNS a propósito: si la migración 20261017000010 no está aplicada,
// todas las lecturas de bloques fallarían. Lo leen/escriben explícitamente choose_option y el armado de días.

/** Campos que se pueden escribir desde un patch (sin pertenencia ni auditoría). */
export const EDITABLE_FIELDS = [
  'type',
  'title',
  'description',
  'google_place_id',
  'place_name',
  'lat',
  'lng',
  'start_time',
  'end_time',
  'time_flex',
  'duration_min',
  'is_private',
  'status',
  'cost_estimate',
  'cost_currency',
  'booking_url',
  'notes',
  'transfer',
  'alerts',
  'sources',
  'sort_order',
  'day_id',
  // PRD 31: lo escriben solo choose_option (y su undo) y el armado; update_block no lo expone (no está en BlockPatch).
  'choice_group',
] as const;

export type BlockWithParticipants = BlockRow & { participant_ids: string[] };

export type Op =
  | { op: 'add'; block: Record<string, unknown> & { participant_ids?: string[] } }
  | { op: 'update'; block_id: string; patch: Record<string, unknown> & { participant_ids?: string[] } }
  | { op: 'move'; block_id: string; patch: Record<string, unknown> }
  | { op: 'remove'; block_id: string }
  /** Solo en el inverse de trip_planned: borra un tramo creado por plan_trip (cascade: días, miembros, bloques). */
  | { op: 'remove_leg'; leg_id: string };

export async function loadBlock(admin: Db, blockId: string): Promise<BlockWithParticipants> {
  const [{ data: block, error }, { data: parts, error: e2 }] = await Promise.all([
    admin.from('blocks').select(BLOCK_SELECT).eq('id', blockId).maybeSingle(),
    admin.from('block_participants').select('user_id').eq('block_id', blockId),
  ]);
  if (error) throw dbError(error, 'blocks');
  if (e2) throw dbError(e2, 'block_participants');
  if (!block) throw notFound('No encontré ese bloque.');
  return { ...(block as unknown as BlockRow), participant_ids: (parts ?? []).map((p) => p.user_id as string) };
}

export async function participantsByBlock(admin: Db, blockIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!blockIds.length) return map;
  const { data, error } = await admin.from('block_participants').select('block_id,user_id').in('block_id', blockIds);
  if (error) throw dbError(error, 'block_participants');
  for (const r of data ?? []) {
    const list = map.get(r.block_id as string) ?? [];
    list.push(r.user_id as string);
    map.set(r.block_id as string, list);
  }
  return map;
}

export async function setParticipants(admin: Db, blockId: string, userIds: string[]): Promise<void> {
  const { error } = await admin.from('block_participants').delete().eq('block_id', blockId);
  if (error) throw dbError(error, 'block_participants');
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const { error: e2 } = await admin.from('block_participants').insert(ids.map((user_id) => ({ block_id: blockId, user_id })));
  if (e2) throw dbError(e2, 'block_participants');
}

/** Inserta un bloque (+ participantes). `block` puede traer id (re-crear en undo). */
export async function insertBlock(
  admin: Db,
  block: Record<string, unknown> & { participant_ids?: string[] },
): Promise<BlockWithParticipants> {
  const { participant_ids, ...row } = block;
  const clean: Record<string, unknown> = {};
  for (const k of BLOCK_COLUMNS) if (row[k] !== undefined) clean[k] = row[k];
  const { data, error } = await admin.from('blocks').insert(clean).select(BLOCK_SELECT).single();
  if (error) throw dbError(error, 'insert blocks');
  const inserted = data as unknown as BlockRow;
  const ids = participant_ids ?? [];
  await setParticipants(admin, inserted.id, ids);
  return { ...inserted, participant_ids: [...new Set(ids)] };
}

/** Actualiza campos editables (+ participantes si vienen). Devuelve la fila nueva. */
export async function updateBlockRow(
  admin: Db,
  blockId: string,
  patch: Record<string, unknown> & { participant_ids?: string[] },
): Promise<BlockWithParticipants> {
  const { participant_ids, ...rest } = patch;
  const clean: Record<string, unknown> = {};
  for (const k of [...EDITABLE_FIELDS, 'leg_id', 'created_by_agent'] as const) if (rest[k] !== undefined) clean[k] = rest[k];
  if (Object.keys(clean).length) {
    const { error } = await admin.from('blocks').update(clean).eq('id', blockId);
    if (error) throw dbError(error, 'update blocks');
  }
  if (participant_ids) await setParticipants(admin, blockId, participant_ids);
  return loadBlock(admin, blockId);
}

export async function deleteBlockRow(admin: Db, blockId: string): Promise<void> {
  const { error: e1 } = await admin.from('block_participants').delete().eq('block_id', blockId);
  if (e1) throw dbError(e1, 'block_participants');
  const { error } = await admin.from('blocks').delete().eq('id', blockId);
  if (error) throw dbError(error, 'delete blocks');
}

/** Snapshot completo para re-crear un bloque (op add inversa de un remove). */
export function snapshot(b: BlockWithParticipants): Record<string, unknown> & { participant_ids: string[] } {
  const out: Record<string, unknown> = {};
  for (const k of BLOCK_COLUMNS) {
    if (k === 'updated_at') continue;
    out[k] = (b as unknown as Record<string, unknown>)[k];
  }
  return { ...out, participant_ids: [...b.participant_ids] };
}

/** Valores previos de las claves de un patch (para la op inversa de un update). */
export function previousValues(
  b: BlockWithParticipants,
  patch: Record<string, unknown>,
): Record<string, unknown> & { participant_ids?: string[] } {
  const prev: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    if (k === 'participant_ids') prev.participant_ids = [...b.participant_ids];
    else if (k in b) prev[k] = (b as unknown as Record<string, unknown>)[k] ?? null;
  }
  return prev;
}

export type Touched = { block_id: string; is_private: boolean; day_ids: (string | null)[] };

/** Aplica ops en orden (sin transacción: supabase-js no las expone; cada op es atómica por sí sola). */
export async function applyOps(admin: Db, ops: Op[]): Promise<Touched[]> {
  const touched: Touched[] = [];
  for (const op of ops) {
    if (op.op === 'add') {
      const b = await insertBlock(admin, op.block);
      touched.push({ block_id: b.id, is_private: b.is_private, day_ids: [b.day_id] });
    } else if (op.op === 'remove_leg') {
      const { data: blocks } = await admin.from('blocks').select('id,is_private,day_id').eq('leg_id', op.leg_id);
      const { error } = await admin.from('legs').delete().eq('id', op.leg_id);
      if (error) throw dbError(error, 'delete legs');
      for (const b of blocks ?? []) {
        touched.push({ block_id: b.id as string, is_private: !!b.is_private, day_ids: [b.day_id as string | null] });
      }
    } else if (op.op === 'remove') {
      const { data } = await admin.from('blocks').select('id,is_private,day_id').eq('id', op.block_id).maybeSingle();
      if (!data) continue; // ya no está: nada que borrar
      await deleteBlockRow(admin, op.block_id);
      touched.push({ block_id: op.block_id, is_private: !!data.is_private, day_ids: [data.day_id as string | null] });
    } else {
      const before = await loadBlock(admin, op.block_id);
      const after = await updateBlockRow(admin, op.block_id, op.patch);
      touched.push({
        block_id: op.block_id,
        is_private: before.is_private || after.is_private,
        day_ids: [before.day_id, after.day_id],
      });
    }
  }
  return touched;
}
