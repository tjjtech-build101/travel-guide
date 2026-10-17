// Las 3 rutas (a pie · transporte · auto) con detalle, vía route_eta { detail: true } (React Query).
// El origen es fijo hasta que se recalcula (fuera de ruta): así cada fix del GPS no dispara pedidos.
import { ROUTE_MODES, type RouteDetail, type RouteMode, type ToolInput } from '@build101/shared';
import { useQueries } from '@tanstack/react-query';

import { callTool, ToolCallError } from '../../lib/api';
import { toRouteDetail } from './model';

type LatLng = { lat: number; lng: number };

export async function fetchRouteDetail(from: LatLng, to: LatLng, mode: RouteMode, signal?: AbortSignal): Promise<RouteDetail> {
  // `detail` es el input nuevo de route_eta (contrato RouteDetail); si la API todavía no lo conoce, lo ignora y
  // toRouteDetail arma el detalle con la polilínea y las líneas de siempre.
  const input = { stops: [from, to], mode, detail: true } as ToolInput<'route_eta'>;
  const res = await callTool<'route_eta', Parameters<typeof toRouteDetail>[0]>('route_eta', input, { signal });
  if (!res.ok) throw new ToolCallError(res.error.code, res.error.message);
  return toRouteDetail(res.data, mode, from, to);
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function useRouteDetails(origin: LatLng | null, dest: LatLng | null) {
  const results = useQueries({
    queries: ROUTE_MODES.map((mode) => ({
      queryKey: ['route-detail', mode, origin && round(origin.lat), origin && round(origin.lng), dest && round(dest.lat), dest && round(dest.lng)],
      enabled: !!origin && !!dest,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRouteDetail(origin!, dest!, mode, signal),
      staleTime: 2 * 60_000,
      // Al recalcular (origen nuevo) queda la ruta anterior hasta que llega la nueva: nada de parpadeo.
      placeholderData: (prev: RouteDetail | undefined) => prev,
      retry: 1,
    })),
  });
  return Object.fromEntries(ROUTE_MODES.map((m, i) => [m, results[i]])) as Record<RouteMode, (typeof results)[number]>;
}
