import type { ReactOptionResult, ToolInput } from '@build101/shared';
import { dbError, forbidden, notFound } from '../errors';
import { loadMembership } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

/**
 * PRD 31 · reacción a una opción del menú del tramo (love / no / must, null = sacar la mía).
 * Puede reaccionar el organizador o un viajero del tramo. Sin feed: es liviano y llega a todos por Realtime.
 */
export async function react_option(input: ToolInput<'react_option'>, ctx: ToolCtx): Promise<ToolOk<ReactOptionResult>> {
  const { admin, userId } = ctx;
  const { data: option, error } = await admin.from('leg_options').select('id,trip_id,leg_id').eq('id', input.option_id).maybeSingle();
  if (error) throw dbError(error, 'leg_options');
  if (!option) throw notFound('No encontré esa opción del menú.');
  const { role, isLegMember } = await loadMembership(admin, option.trip_id as string, option.leg_id as string, userId);
  if (role === null) throw notFound('No encontré esa opción del menú.');
  if (role === 'follower') throw forbidden('Los seguidores no pueden elegir opciones.');
  if (role !== 'organizer' && !isLegMember) throw forbidden('No estás en este tramo del viaje.');

  if (input.reaction === null) {
    const { error: e2 } = await admin.from('leg_option_reactions').delete().eq('option_id', input.option_id).eq('user_id', userId);
    if (e2) throw dbError(e2, 'leg_option_reactions');
  } else {
    const { error: e2 } = await admin
      .from('leg_option_reactions')
      .upsert(
        { option_id: input.option_id, trip_id: option.trip_id, user_id: userId, reaction: input.reaction, created_at: new Date().toISOString() },
        { onConflict: 'option_id,user_id' },
      );
    if (e2) throw dbError(e2, 'leg_option_reactions');
  }
  return { ok: true, data: { option_id: input.option_id, reaction: input.reaction } };
}
