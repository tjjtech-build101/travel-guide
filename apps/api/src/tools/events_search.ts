import type { ToolInput } from '@build101/shared';
import { runEventsSearch } from '../agents/eventsSearch';
import type { ToolCtx, ToolOk } from './types';

export async function events_search(input: ToolInput<'events_search'>, ctx: ToolCtx): Promise<ToolOk> {
  const data = await runEventsSearch(input, ctx.admin, ctx.userId);
  return { ok: true, data };
}
