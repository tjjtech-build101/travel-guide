import type { GenerateTourStart, ToolInput } from '@build101/shared';
import { startGenerateTour } from '../agents/tourGenerator';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/** PRD 06/18: responde enseguida {job_id, tour_id}; el tour se arma en segundo plano (waitUntil en Vercel). */
export async function generate_tour(input: ToolInput<'generate_tour'>, ctx: ToolCtx): Promise<ToolOk<GenerateTourStart>> {
  const start = await startGenerateTour(input, ctx);
  runInBackground(`generate_tour/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id, tour_id: start.tour_id } };
}
