// report_late (Ahora v2): "Juan llega 10 min tarde a Almuerzo". Solo escribe activity_feed (running_late), no mueve
// bloques. Un aviso por persona y bloque: uno nuevo reemplaza al anterior. Deshacer borra el aviso (undo.ts).
import type { ToolInput } from '@build101/shared';
import { loadBlock } from '../blocks';
import { badInput, dbError, forbidden } from '../errors';
import { actorLabel, insertFeed } from '../feed';
import { loadTripRole } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

export function lateSummary(who: string, lateByMin: number, title: string): string {
  return `${who} llega ${lateByMin} min tarde a ${title}`;
}

export async function report_late(input: ToolInput<'report_late'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin } = ctx;
  const block = await loadBlock(admin, input.block_id);
  if (block.trip_id !== input.trip_id) throw badInput('El bloque no es de este viaje.');
  const role = await loadTripRole(admin, input.trip_id, ctx.userId);
  if (role === null) throw forbidden('No sos miembro de este viaje.');
  if (role === 'follower') throw forbidden('Los seguidores no avisan llegadas.');
  if (block.is_private && !block.participant_ids.includes(ctx.userId) && block.created_by !== ctx.userId) {
    throw forbidden('Es un bloque privado de otra persona.');
  }

  // El aviso es de la persona aunque lo mande Scout por voz: "Juan llega…", no "Scout llega…".
  const who = await actorLabel({ ...ctx, actor: 'user' });
  const summary = lateSummary(who, input.late_by_min, block.title);

  // Menos ruido: si ya había avisado para este bloque, el nuevo aviso reemplaza al viejo.
  const { error: delErr } = await admin
    .from('activity_feed')
    .delete()
    .eq('trip_id', input.trip_id)
    .eq('kind', 'running_late')
    .eq('actor_user_id', ctx.userId)
    .eq('payload->>block_id', block.id);
  if (delErr) throw dbError(delErr, 'activity_feed');

  const feed = await insertFeed(ctx, {
    trip_id: input.trip_id,
    kind: 'running_late',
    payload: {
      summary,
      block_id: block.id,
      day_id: block.day_id,
      late_by_min: input.late_by_min,
      ...(input.note ? { note: input.note } : {}),
      inverse: [],
    },
    undoable: true,
    // Privado: solo lo ve quien avisa (RLS de 20261017000007), igual que el resto del feed sobre privados.
    private: block.is_private,
  });
  return { ok: true, data: { feed_id: feed.feed_id, summary }, ...feed };
}
