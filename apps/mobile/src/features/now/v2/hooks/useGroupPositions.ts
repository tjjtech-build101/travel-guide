// Posiciones de los demás (docs/AHORA-V2.md): member_locations del viaje (RLS ya oculta 'never' y fantasmas) +
// perfiles de usePlanOverview, con distancia a mí. Ignora posiciones de hace > 15 min. Realtime invalida
// ['trip', id, 'member_locations']; nada de polling.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { supabase } from '../../../../lib/supabase';
import { useMe, usePlanOverview } from '../../../plan/queries';
import { tripKeys } from '../../../trips/keys';
import { useNow } from '../../clock';
import type { LatLng } from '../../selectors';
import type { GroupPosition } from '../types';
import { buildGroupPositions, type MemberLocationRow } from './pure';

export function useMemberLocations(tripId: string) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'member_locations'),
    queryFn: async (): Promise<MemberLocationRow[]> => {
      const { data, error } = await supabase
        .from('member_locations')
        .select('user_id, lat, lng, updated_at')
        .eq('trip_id', tripId);
      if (error) throw error;
      return (data ?? []) as MemberLocationRow[];
    },
  });
}

export function useGroupPositions(tripId: string, here: LatLng | null): GroupPosition[] {
  const me = useMe();
  const rows = useMemberLocations(tripId);
  const overview = usePlanOverview(tripId);
  // Re-render cada 60 s para que caigan las viejas (no pide nada a la red).
  useNow(60_000);
  const nowMs = Date.now();
  const hereKey = here ? `${here.lat.toFixed(4)},${here.lng.toFixed(4)}` : null;
  const minute = Math.floor(nowMs / 60_000);
  return useMemo(
    () => buildGroupPositions(rows.data ?? [], overview.data?.members ?? [], me, here, nowMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows.data, overview.data?.members, me, hereKey, minute],
  );
}
