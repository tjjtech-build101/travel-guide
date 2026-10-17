// Borra un viaje entero. IRREVERSIBLE: no deja undo_token (restaurar un viaje completo —tramos, días,
// bloques, tours, gastos— no entra en el sistema de undo por op, pensado para acciones puntuales).
// Solo el organizador. Todo lo que cuelga de trip_id tiene ON DELETE CASCADE (ver migraciones).
import type { ToolInput } from '@build101/shared';
import { dbError, forbidden, notFound } from '../errors';
import { loadTripRole } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

export async function delete_trip(input: ToolInput<'delete_trip'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin, userId } = ctx;
  const role = await loadTripRole(admin, input.trip_id, userId);
  if (role === null) throw notFound('No encontré ese viaje (o no sos miembro).');
  if (role !== 'organizer') throw forbidden('Solo quien organiza puede borrar el viaje.');

  const { error } = await admin.from('trips').delete().eq('id', input.trip_id);
  if (error) throw dbError(error, 'trips');
  return { ok: true, data: { deleted: true } };
}
