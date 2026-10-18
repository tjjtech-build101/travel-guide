import type { GenerateTourStart, ToolInput } from '@build101/shared';
import { startIndoorTour } from '../agents/indoorTour';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/** Tour por dentro de un lugar: responde enseguida {job_id, tour_id}; el tour se arma en segundo plano (job generate_tour). */
export async function generate_indoor_tour(input: ToolInput<'generate_indoor_tour'>, ctx: ToolCtx): Promise<ToolOk<GenerateTourStart>> {
  const start = await startIndoorTour(input, ctx);
  runInBackground(`generate_indoor_tour/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id, tour_id: start.tour_id } };
}
