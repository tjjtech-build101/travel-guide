import type { ToolInput, TripShapesResult } from '@build101/shared';
import { tripShapes } from '../agents/planner/briefLlm';
import { assertPlannerMember } from './trip_brief';
import type { ToolCtx, ToolOk } from './types';

/** PRD 31 · 2-3 formas del viaje con pros y contras (la elegida va a plan_trip como skeleton). Síncrona (tope 45 s). */
export async function trip_shapes(input: ToolInput<'trip_shapes'>, ctx: ToolCtx): Promise<ToolOk<TripShapesResult>> {
  await assertPlannerMember(ctx, input.trip_id);
  return { ok: true, data: await tripShapes(input, ctx) };
}
