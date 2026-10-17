import type { ToolInput } from '@build101/shared';
import { nowBrief } from '../agents/nowBrief';
import { forbidden } from '../errors';
import { loadTripRole } from '../policy/writeMode';
import type { ToolCtx, ToolOk } from './types';

/** Frase de Scout para Ahora. Lectura, sin feed. Sin Claude devuelve la frase por reglas (source: 'rules'). */
export async function now_brief(input: ToolInput<'now_brief'>, ctx: ToolCtx): Promise<ToolOk> {
  if ((await loadTripRole(ctx.admin, input.trip_id, ctx.userId)) === null) throw forbidden('No sos miembro de este viaje.');
  const data = await nowBrief({ language: input.language, snapshot: input.snapshot });
  return { ok: true, data };
}
