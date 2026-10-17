// ETA hasta el próximo bloque (PRD 19): route_eta a pie; si a pie pasa de 25 min, prueba transporte.
// Se recalcula cada 2 min o al moverse ~100 m (la key usa una celda de ~100 m), nunca más seguido.
// Mientras responde (o si falla) usa la estimación local por distancia.
import { useQuery } from '@tanstack/react-query';

import { callTool } from '../../lib/api';
import { etaCell, walkEstimateMin, type LatLng } from './selectors';

export type Eta = { minutes: number; mode: 'walk' | 'transit'; estimated: boolean };

type RouteResult = { total_min: number; estimated?: boolean };

const WALK_LIMIT_MIN = 25;

async function fetchEta(from: LatLng, to: LatLng): Promise<Eta> {
  const walk = await callTool<'route_eta', RouteResult>('route_eta', { stops: [from, to], mode: 'walk' });
  if (!walk.ok) return { minutes: walkEstimateMin(from, to), mode: 'walk', estimated: true };
  const w = Math.ceil(walk.data.total_min);
  if (w <= WALK_LIMIT_MIN) return { minutes: w, mode: 'walk', estimated: !!walk.data.estimated };
  const transit = await callTool<'route_eta', RouteResult>('route_eta', { stops: [from, to], mode: 'transit' });
  if (transit.ok && transit.data.total_min > 0 && transit.data.total_min < w) {
    return { minutes: Math.ceil(transit.data.total_min), mode: 'transit', estimated: !!transit.data.estimated };
  }
  return { minutes: w, mode: 'walk', estimated: !!walk.data.estimated };
}

export function useEta(from: LatLng | null, to: (LatLng & { id: string }) | null) {
  const cell = from ? etaCell(from) : null;
  return useQuery({
    queryKey: ['eta', to?.id, cell],
    enabled: !!from && !!to,
    queryFn: () => fetchEta(from!, to!),
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    placeholderData: from && to ? { minutes: walkEstimateMin(from, to), mode: 'walk' as const, estimated: true } : undefined,
  });
}
