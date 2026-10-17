import type { ToolInput, TripBriefResult } from '@build101/shared';
import { tripBrief } from '../agents/planner/briefLlm';
import { forbidden, notFound } from '../errors';
import { loadTripRole } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

/** Viaje existente: hay que ser viajero (no seguidor) para planificarlo. */
export async function assertPlannerMember(ctx: ToolCtx, tripId: string | undefined): Promise<void> {
  if (!tripId) return;
  const role = await loadTripRole(ctx.admin, tripId, ctx.userId);
  if (role === null) throw notFound('No encontré ese viaje (o no sos miembro).');
  if (role === 'follower') throw forbidden('Los seguidores no pueden planificar el viaje.');
}

/** PRD 31 · entrevista antes de plan_trip: lo que entendí + 0-4 preguntas. Síncrona (tope 15 s). */
export async function trip_brief(input: ToolInput<'trip_brief'>, ctx: ToolCtx): Promise<ToolOk<TripBriefResult>> {
  await assertPlannerMember(ctx, input.trip_id);
  return { ok: true, data: await tripBrief(input, ctx) };
}
