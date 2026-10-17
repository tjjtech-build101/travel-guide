// Publica mi posición en member_locations (docs/AHORA-V2.md, PRD 13) mientras la pantalla está montada:
// cada 30 s o 50 m (lo primero). Respeta trip_members.location_sharing y ghost_until:
//   - 'never', fantasma activo o viaje terminado → no publica y borra mi fila (una vez).
//   - 'always' → publica.
//   - 'shared_only' (default) → solo durante un bloque compartido en curso (yo + ≥ 1 persona) o un tour en vivo.
// Upsert directo a Supabase con mi JWT (RLS: solo mi fila). Consume LocationProvider (real | simulado).
import type { LocationSharing } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { supabase } from '../../../../lib/supabase';
import { useLocationFix } from '../../../../location/LocationContext';
import { useTourStore } from '../../../../tour/store';
import { useMe, usePlanBlocks, usePlanOverview } from '../../../plan/queries';
import { tripKeys } from '../../../trips/keys';
import { useTrip } from '../../../trips/queries';
import { useNow } from '../../clock';
import { buildNowPlan, resolveToday } from '../../selectors';
import { isSharedBlock, type Published, sharingAllowed, shouldPublish } from './pure';

type MySharing = { location_sharing: LocationSharing | null; ghost_until: string | null };

export function useMySharing(tripId: string) {
  const me = useMe();
  return useQuery({
    // Bajo 'trip_members': Realtime lo invalida cuando cambio la opción o el fantasma.
    queryKey: [...tripKeys.table(tripId, 'trip_members'), 'my-sharing', me],
    enabled: !!me,
    queryFn: async (): Promise<MySharing | null> => {
      const { data, error } = await supabase
        .from('trip_members')
        .select('location_sharing, ghost_until')
        .eq('trip_id', tripId)
        .eq('user_id', me)
        .maybeSingle();
      if (error) throw error;
      return (data as MySharing | null) ?? null;
    },
  });
}

/** Devuelve si ahora estoy compartiendo (para mostrarlo, si hace falta). */
export function useShareMyLocation(tripId: string): { sharing: boolean } {
  const me = useMe();
  const fix = useLocationFix();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const mine = useMySharing(tripId);
  const tourLive = useTourStore((s) => s.phase === 'live');
  const { now } = useNow();

  // ¿Estoy en un bloque compartido ahora? (solo importa con 'shared_only')
  const sharedNow = useMemo(() => {
    if (tourLive) return true;
    if (!overview.data || !blocks.data || !me) return false;
    const today = resolveToday(overview.data.legs, me, now, trip.data);
    if (today.kind !== 'today') return false;
    const dayBlocks = blocks.data.filter((b) => b.day_id === today.day.id);
    return isSharedBlock(buildNowPlan(dayBlocks, me, today.minutes).current?.block, me);
  }, [tourLive, overview.data, blocks.data, me, now, trip.data]);

  const loaded = mine.isSuccess && !!mine.data;
  const allowed =
    loaded &&
    sharingAllowed({
      sharing: mine.data!.location_sharing ?? 'shared_only',
      ghostUntil: mine.data!.ghost_until,
      tripStatus: trip.data?.status,
      nowMs: Date.now(), // el fantasma va con el reloj real, no el simulado
      sharedNow,
    });

  const last = useRef<Published | null>(null);
  const cleared = useRef(false);

  useEffect(() => {
    if (!me || !loaded) return;
    if (!allowed) {
      last.current = null;
      if (cleared.current) return;
      cleared.current = true;
      void supabase
        .from('member_locations')
        .delete()
        .eq('trip_id', tripId)
        .eq('user_id', me)
        .then(({ error }) => {
          if (error && __DEV__) console.warn('[ahora] borrar member_locations', error.message);
        });
      return;
    }
    cleared.current = false;
    if (!fix) return;
    const at = Date.now();
    if (!shouldPublish(last.current, fix, at)) return;
    last.current = { at, lat: fix.lat, lng: fix.lng };
    void supabase
      .from('member_locations')
      .upsert(
        {
          trip_id: tripId,
          user_id: me,
          lat: fix.lat,
          lng: fix.lng,
          heading: fix.heading ?? null,
          speed: fix.speed ?? null,
          accuracy: fix.accuracy ?? null,
          updated_at: new Date(at).toISOString(),
        },
        { onConflict: 'trip_id,user_id' },
      )
      .then(({ error }) => {
        if (error && __DEV__) console.warn('[ahora] publicar member_locations', error.message);
      });
  }, [fix, allowed, loaded, me, tripId]);

  return { sharing: allowed };
}
