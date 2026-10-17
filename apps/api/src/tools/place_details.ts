import type { ToolInput } from '@build101/shared';
import { placeDetails } from '../google/places';
import type { ToolCtx, ToolOk } from './types';

export async function place_details(input: ToolInput<'place_details'>, _ctx: ToolCtx): Promise<ToolOk> {
  return { ok: true, data: await placeDetails(input.google_place_id) };
}
