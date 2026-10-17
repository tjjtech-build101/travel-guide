import type { ComposeDaysStart, ToolInput } from '@build101/shared';
import { startComposeDays } from '../agents/planner/composeJob';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/** PRD 31: responde enseguida {job_id, trip_id}; los días se arman en segundo plano (job kind='compose_days'). */
export async function compose_days(input: ToolInput<'compose_days'>, ctx: ToolCtx): Promise<ToolOk<ComposeDaysStart>> {
  const start = await startComposeDays(input, ctx);
  runInBackground(`compose_days/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id, trip_id: start.trip_id } };
}
