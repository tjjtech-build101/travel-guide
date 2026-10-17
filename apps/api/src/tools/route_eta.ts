import type { ToolInput } from '@build101/shared';
import { transitSummary } from '../agents/dayTransfers';
import { badInput } from '../errors';
import {
  computeRoute,
  hasCoords,
  mapsTransitUrl,
  routeDetail,
  transitPlan,
  transitPlanFromDetail,
  type TransitPlan,
} from '../google/routes';
import type { ToolCtx, ToolOk } from './types';

export async function route_eta(input: ToolInput<'route_eta'>, _ctx: ToolCtx): Promise<ToolOk> {
  input.stops.forEach((s, i) => {
    if (!s.google_place_id && !hasCoords(s)) throw badInput(`La parada ${i} necesita {lat, lng} o {google_place_id}.`);
  });
  const [a, b] = input.stops;
  const pair = input.stops.length === 2 && hasCoords(a) && hasCoords(b) ? ([a, b] as const) : null;
  const withTransit = (base: object, plan: TransitPlan | null): ToolOk =>
    plan && pair
      ? { ok: true, data: { ...base, transit: { ...plan, summary: transitSummary(plan), maps_url: mapsTransitUrl(pair[0], pair[1]) } } }
      : { ok: true, data: base };

  // "Cómo llego" embebido (Ahora): UNA consulta a Google con polilínea + pasos; segments/total_min y, en transporte,
  // las líneas salen de ahí (no se pide la misma ruta 2–3 veces). routeDetail nunca falla (estima sin Google).
  if (input.detail && pair) {
    const detail = await routeDetail(pair[0], pair[1], input.mode, input.departure_time);
    const segment = { from_idx: 0, to_idx: 1, duration_min: detail.duration_min, distance_m: detail.distance_m, polyline: detail.polyline };
    const base = { segments: [segment], total_min: detail.duration_min, ...(detail.estimated ? { estimated: true } : {}), detail };
    return withTransit(base, input.mode === 'transit' ? transitPlanFromDetail(detail) : null);
  }

  const route = await computeRoute(input.stops, input.mode, input.departure_time);
  // Transporte entre dos puntos: además, las líneas (así la voz puede decir "tomá el 121 en Ciudadela").
  if (input.mode === 'transit' && pair) {
    try {
      return withTransit(route, await transitPlan(pair[0], pair[1], input.departure_time));
    } catch (e) {
      console.warn('[route_eta] transit:', (e as Error).message);
    }
  }
  return { ok: true, data: route };
}
