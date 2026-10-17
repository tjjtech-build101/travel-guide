import type { ToolInput } from '@build101/shared';
import { startResearch } from '../agents/research';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/** Voz: "no lo sé, lo averiguo". Responde enseguida { job_id }; la investigación sigue en segundo plano. */
export async function research(input: ToolInput<'research'>, ctx: ToolCtx): Promise<ToolOk<{ job_id: string }>> {
  const start = await startResearch(input, ctx);
  runInBackground(`research/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id } };
}
