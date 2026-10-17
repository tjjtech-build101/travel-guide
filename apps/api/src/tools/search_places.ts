import type { ToolInput } from '@build101/shared';
import { badInput } from '../errors';
import { searchPlaces } from '../google/places';
import type { ToolCtx, ToolOk } from './types';

export async function search_places(input: ToolInput<'search_places'>, _ctx: ToolCtx): Promise<ToolOk> {
  if (!input.query && !input.near) throw badInput('Mandá al menos query o near.');
  const data = await searchPlaces(input);
  return { ok: true, data };
}
