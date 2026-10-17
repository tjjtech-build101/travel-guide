import type { ToolInput } from '@build101/shared';
import { badInput } from '../errors';
import { computeRoute, hasCoords } from '../google/routes';
import type { ToolCtx, ToolOk } from './types';

export async function route_eta(input: ToolInput<'route_eta'>, _ctx: ToolCtx): Promise<ToolOk> {
  input.stops.forEach((s, i) => {
    if (!s.google_place_id && !hasCoords(s)) throw badInput(`La parada ${i} necesita {lat, lng} o {google_place_id}.`);
  });
  return { ok: true, data: await computeRoute(input.stops, input.mode, input.departure_time) };
}
