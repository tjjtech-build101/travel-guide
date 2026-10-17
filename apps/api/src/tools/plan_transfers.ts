import type { ToolInput } from '@build101/shared';
import { addTransfers } from '../agents/dayTransfers';
import { dbError, notFound } from '../errors';
import type { ToolCtx, ToolOk } from './types';

/** Traslados dentro del día para un viaje ya armado (botón del Plan o la voz). */
export async function plan_transfers(input: ToolInput<'plan_transfers'>, ctx: ToolCtx): Promise<ToolOk> {
  const { data: trip, error } = await ctx.db.from('trips').select('id').eq('id', input.trip_id).maybeSingle();
  if (error) throw dbError(error, 'trips');
  if (!trip) throw notFound('No encontré ese viaje (o no sos miembro).');
  const res = await addTransfers(ctx, { trip_id: input.trip_id, leg_id: input.leg_id, day_ids: input.day_id ? [input.day_id] : undefined });
  return { ok: true, data: res };
}
