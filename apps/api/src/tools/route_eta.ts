import type { ToolInput } from '@build101/shared';
import { transitSummary } from '../agents/dayTransfers';
import { badInput } from '../errors';
import { computeRoute, hasCoords, mapsTransitUrl, transitPlan } from '../google/routes';
import type { ToolCtx, ToolOk } from './types';

export async function route_eta(input: ToolInput<'route_eta'>, _ctx: ToolCtx): Promise<ToolOk> {
  input.stops.forEach((s, i) => {
    if (!s.google_place_id && !hasCoords(s)) throw badInput(`La parada ${i} necesita {lat, lng} o {google_place_id}.`);
  });
  const route = await computeRoute(input.stops, input.mode, input.departure_time);
  // Transporte entre dos puntos: además, las líneas (así la voz puede decir "tomá el 121 en Ciudadela").
  const [a, b] = input.stops;
  if (input.mode === 'transit' && input.stops.length === 2 && hasCoords(a) && hasCoords(b)) {
    try {
      const plan = await transitPlan(a, b, input.departure_time);
      if (plan) return { ok: true, data: { ...route, transit: { ...plan, summary: transitSummary(plan), maps_url: mapsTransitUrl(a, b) } } };
    } catch (e) {
      console.warn('[route_eta] transit:', (e as Error).message);
    }
  }
  return { ok: true, data: route };
}
