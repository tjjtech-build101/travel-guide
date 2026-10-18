// Caché offline de Ahora (docs/AHORA-V2.md): guarda overview + bloques + propuestas en AsyncStorage
// (now_screen:{trip_id}, con fetched_at) cada vez que llegan datos nuevos, y al abrir hidrata el queryClient con las
// mismas queryKeys de features/plan/queries.ts (≤ 1 s). Offline = la última carga falló por red (no hay NetInfo).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { planKeys, usePendingProposals, usePlanBlocks, usePlanOverview } from '../../../plan/queries';
import { useNow } from '../../clock';
import { isNetworkError, minutesSince, nowCacheKey, parseNowCache, serializeNowCache } from './pure';

const WRITE_DEBOUNCE_MS = 1000;

export function useNowCache(tripId: string): { offline: boolean; minutesAgo: number } {
  const qc = useQueryClient();
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const proposals = usePendingProposals(tripId);
  useNow(60_000); // refresca "hace X min"

  // Hidratar al abrir: solo lo que todavía no está en memoria. updatedAt = fetched_at → queda viejo y se refresca.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(nowCacheKey(tripId))
      .then((raw) => {
        const c = parseNowCache(raw, tripId);
        if (!alive || !c) return;
        const updatedAt = Date.parse(c.fetched_at);
        const put = (key: readonly unknown[], data: unknown) => {
          if (data !== undefined && qc.getQueryData(key) === undefined) qc.setQueryData(key, data, { updatedAt });
        };
        put(planKeys.overview(tripId), c.overview);
        put(planKeys.blocks(tripId), c.blocks);
        put(planKeys.proposals(tripId), c.proposals);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [qc, tripId]);

  // Guardar cuando llega algo nuevo de la red (no al hidratar: ahí los updatedAt son los del caché).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fresh = Math.max(overview.dataUpdatedAt, blocks.dataUpdatedAt, proposals.dataUpdatedAt);
  const lastSaved = useRef(0);
  useEffect(() => {
    if (!fresh || fresh <= lastSaved.current) return;
    if (!overview.isFetchedAfterMount && !blocks.isFetchedAfterMount && !proposals.isFetchedAfterMount) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastSaved.current = fresh;
      const raw = serializeNowCache(
        tripId,
        {
          overview: qc.getQueryData(planKeys.overview(tripId)),
          blocks: qc.getQueryData(planKeys.blocks(tripId)),
          proposals: qc.getQueryData(planKeys.proposals(tripId)),
        },
        Date.now(),
      );
      if (raw) AsyncStorage.setItem(nowCacheKey(tripId), raw).catch(() => {});
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fresh, qc, tripId, overview.isFetchedAfterMount, blocks.isFetchedAfterMount, proposals.isFetchedAfterMount]);

  const qs = [overview, blocks, proposals];
  const offline = qs.some((q) => q.isError && isNetworkError(q.error));
  const oldest = Math.min(...qs.map((q) => q.dataUpdatedAt || Infinity));
  return { offline, minutesAgo: Number.isFinite(oldest) ? minutesSince(oldest, Date.now()) : 0 };
}
