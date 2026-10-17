import type { ToolInput } from '@build101/shared';
import { transitSummary } from '../agents/dayTransfers';
import { badInput } from '../errors';
import { computeRoute, hasCoords, mapsTransitUrl, routeDetail, transitPlan } from '../google/routes';
import type { ToolCtx, ToolOk } from './types';

export async function route_eta(input: ToolInput<'route_eta'>, _ctx: ToolCtx): Promise<ToolOk> {
  input.stops.forEach((s, i) => {
    if (!s.google_place_id && !hasCoords(s)) throw badInput(`La parada ${i} necesita {lat, lng} o {google_place_id}.`);
  });
  const [a, b] = input.stops;
  const pair = input.stops.length === 2 && hasCoords(a) && hasCoords(b) ? ([a, b] as const) : null;
  // "Cómo llego" embebido (Ahora): polilínea + pasos, en paralelo. routeDetail nunca falla (estima si no hay Google).
  const detailP = input.detail && pair ? routeDetail(pair[0], pair[1], input.mode, input.departure_time) : null;
  const route = await computeRoute(input.stops, input.mode, input.departure_time);
  const detail = detailP ? await detailP : null;
  const base = detail ? { ...route, detail } : route;
  // Transporte entre dos puntos: además, las líneas (así la voz puede decir "tomá el 121 en Ciudadela").
  if (input.mode === 'transit' && pair) {
    try {
      const plan = await transitPlan(pair[0], pair[1], input.departure_time);
      if (plan) return { ok: true, data: { ...base, transit: { ...plan, summary: transitSummary(plan), maps_url: mapsTransitUrl(pair[0], pair[1]) } } };
    } catch (e) {
      console.warn('[route_eta] transit:', (e as Error).message);
    }
  }
  return { ok: true, data: base };
}
