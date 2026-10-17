import type { ToolInput } from '@build101/shared';
import { answerFromMemory, startResearch, type MemoryHit } from '../agents/research';
import { runInBackground } from '../jobs';
import type { ToolCtx, ToolOk } from './types';

/**
 * Voz: "no lo sé, lo averiguo". Si place_library ya lo responde, devuelve la respuesta al toque ({ cached: true,
 * answer, facts }); si no, responde enseguida { job_id } y la investigación sigue en segundo plano.
 */
export async function research(input: ToolInput<'research'>, ctx: ToolCtx): Promise<ToolOk<MemoryHit | { job_id: string }>> {
  const hit = await answerFromMemory(input, ctx);
  if (hit) return { ok: true, data: hit };
  const start = await startResearch(input, ctx);
  runInBackground(`research/${start.job_id}`, start.run());
  return { ok: true, data: { job_id: start.job_id } };
}
