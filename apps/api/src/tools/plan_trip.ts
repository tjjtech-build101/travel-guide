import type { PlanTripStart, ToolInput } from '@build101/shared';
import { startPlanTrip } from '../agents/planTrip';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/** PRD 01: responde enseguida {job_id, trip_id}; el plan se arma en segundo plano (waitUntil en Vercel). */
export async function plan_trip(input: ToolInput<'plan_trip'>, ctx: ToolCtx): Promise<ToolOk<PlanTripStart>> {
  const start = await startPlanTrip(input, ctx);
  runInBackground(`plan_trip/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id, trip_id: start.trip_id } };
}
