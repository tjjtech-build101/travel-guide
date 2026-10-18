import type { ToolInput, TripShapesResult } from '@build101/shared';
import { tripShapes } from '../agents/planner/briefLlm';
import { assertPlannerMember } from './trip_brief';
import type { ToolCtx, ToolOk } from './types';

/** PRD 31 · 2-3 formas del viaje con pros y contras, armadas alrededor de las anclas investigadas (la elegida va a plan_trip como skeleton). Síncrona (~45 s; peor caso ~80 s si hay que re-entender e investigar). */
export async function trip_shapes(input: ToolInput<'trip_shapes'>, ctx: ToolCtx): Promise<ToolOk<TripShapesResult>> {
  await assertPlannerMember(ctx, input.trip_id);
  return { ok: true, data: await tripShapes(input, ctx) };
}
