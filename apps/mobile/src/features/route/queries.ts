// Rutas de "Cómo llego" (React Query). Para no pegarle a Google de más:
// - el detalle (polilínea + pasos, route_eta { detail: true }) se pide SOLO para el modo elegido;
// - los minutos de los otros modos del selector son un route_eta sin detalle, una vez por apertura;
// - el origen es fijo hasta que se recalcula (fuera de ruta) y eso refetchea solo el modo activo.
import { ROUTE_MODES, type RouteDetail, type RouteMode, type ToolInput } from '@build101/shared';
import { useQueries, useQuery } from '@tanstack/react-query';

import { callTool, ToolCallError } from '../../lib/api';
import { toRouteDetail } from './model';

type LatLng = { lat: number; lng: number };

export async function fetchRouteDetail(
  from: LatLng,
  to: LatLng,
  mode: RouteMode,
  departure_time?: string,
  signal?: AbortSignal,
): Promise<RouteDetail> {
  // detail: true → la API devuelve data.detail (RouteDetail). Si una API vieja no lo trae, toRouteDetail arma el
  // detalle con la polilínea y las líneas de siempre.
  const input: ToolInput<'route_eta'> = { stops: [from, to], mode, detail: true, ...(departure_time ? { departure_time } : {}) };
  const res = await callTool<'route_eta', Parameters<typeof toRouteDetail>[0]>('route_eta', input, { signal });
  if (!res.ok) throw new ToolCallError(res.error.code, res.error.message);
  return toRouteDetail(res.data, mode, from, to);
}

async function fetchRouteMin(from: LatLng, to: LatLng, mode: RouteMode, departure_time?: string, signal?: AbortSignal): Promise<number> {
  const input: ToolInput<'route_eta'> = { stops: [from, to], mode, ...(departure_time ? { departure_time } : {}) };
  const res = await callTool<'route_eta', { total_min: number }>('route_eta', input, { signal });
  if (!res.ok) throw new ToolCallError(res.error.code, res.error.message);
  return res.data.total_min;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const ll = (p: LatLng | null) => (p ? [round(p.lat), round(p.lng)] : null);

/** Detalle del modo elegido. `departure_time` (ISO) solo cuenta en transporte: horarios de la línea que vas a tomar. */
export function useRouteDetail(origin: LatLng | null, dest: LatLng | null, mode: RouteMode, departure_time?: string) {
  const dep = mode === 'transit' ? departure_time : undefined;
  return useQuery({
    queryKey: ['route-detail', mode, ll(origin), ll(dest), dep ?? null],
    enabled: !!origin && !!dest,
    queryFn: ({ signal }) => fetchRouteDetail(origin!, dest!, mode, dep, signal),
    staleTime: 2 * 60_000,
    // Al recalcular (origen nuevo) queda la ruta anterior hasta que llega la nueva: nada de parpadeo.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === mode ? prev : undefined),
    retry: 1,
  });
}

/** Minutos de los modos que no se están mirando (sin detalle). `skip`: modos que ya tienen minutos por otro lado. */
export function useRouteMinutes(origin: LatLng | null, dest: LatLng | null, skip: (m: RouteMode) => boolean, departure_time?: string) {
  const results = useQueries({
    queries: ROUTE_MODES.map((mode) => {
      const dep = mode === 'transit' ? departure_time : undefined;
      return {
        queryKey: ['route-min', mode, ll(origin), ll(dest), dep ?? null],
        enabled: !!origin && !!dest && !skip(mode),
        queryFn: ({ signal }: { signal: AbortSignal }) => fetchRouteMin(origin!, dest!, mode, dep, signal),
        staleTime: 5 * 60_000,
        retry: 1,
      };
    }),
  });
  return Object.fromEntries(ROUTE_MODES.map((m, i) => [m, results[i]])) as Record<RouteMode, (typeof results)[number]>;
}
