// Ideas para un hueco libre (docs/AHORA-V2.md, hero free): hasta 3 de gap_suggestions (banco del tramo, lugares
// abiertos cerca, eventos de hoy). add(item) las agenda en un toque:
//   - idea del banco → move_block al día del hueco a la hora del hueco;
//   - lugar / evento → add_block personal (solo yo) con la hora del hueco.
// El toast con "Deshacer" lo muestran useMoveBlock / useAddBlock (como en el Plan).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useAddBlock, useMoveBlock } from '../../../plan/mutations';
import { useMe } from '../../../plan/queries';
import { showToast } from '../../../plan/store';
import { etaCell, type LatLng } from '../../selectors';
import type { GapSuggestion } from '../types';
import { callNowTool } from './nowApi';
import { gapAction } from './pure';

type Args = {
  tripId: string;
  legId: string | null;
  /** Día del hueco (hacia donde se agenda). */
  dayId: string | null;
  here: LatLng | null;
  minutes: number;
  /** Fecha y hora local del tramo. */
  date: string;
  localTime: string;
  enabled: boolean;
};

const bucket15 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.floor(((h || 0) * 60 + (m || 0)) / 15);
};

export function useGapSuggestions({ tripId, legId, dayId, here, minutes, date, localTime, enabled }: Args) {
  const me = useMe();
  const move = useMoveBlock(tripId);
  const addBlock = useAddBlock(tripId);
  const [added, setAdded] = useState<string[]>([]);
  const mins = Math.max(15, Math.min(600, Math.round(minutes)));

  const q = useQuery<GapSuggestion[]>({
    // Celda de ~100 m y franjas de 15 min: no se repide con cada paso ni con cada tick.
    queryKey: ['gap_suggestions', tripId, legId, here ? etaCell(here) : null, Math.round(mins / 15), date, bucket15(localTime)],
    enabled: enabled && !!legId && !!here && minutes > 0,
    staleTime: 10 * 60_000,
    retry: 1,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }): Promise<GapSuggestion[]> => {
      const res = await callNowTool<'gap_suggestions', { items: GapSuggestion[] }>(
        'gap_suggestions',
        { trip_id: tripId, leg_id: legId!, lat: here!.lat, lng: here!.lng, minutes: mins, date, local_time: localTime.slice(0, 5), limit: 3 },
        { signal },
      );
      if (!res.ok) throw new Error(res.error.message);
      return res.data.items ?? [];
    },
  });

  const add = useCallback(
    (item: GapSuggestion) => {
      if (!legId || !dayId) {
        showToast({ text: 'No encontré el día para agendarlo.', tone: 'error' });
        return;
      }
      const action = gapAction(item, { tripId, legId, dayId, me, localTime, minutes: mins });
      const done = () => setAdded((xs) => [...xs, item.id]);
      if (action.kind === 'move') {
        move.mutate(
          { blockId: action.blockId, dayId: action.dayId, startTime: action.startTime, title: action.title, toLabel: `a las ${action.startTime}` },
          { onSuccess: done },
        );
      } else {
        addBlock.mutate(
          { kind: 'block', input: action.input },
          {
            onSuccess: done,
            onError: () => showToast({ text: 'No se pudo agregar. Probá de nuevo.', tone: 'error' }),
          },
        );
      }
    },
    [legId, dayId, tripId, me, localTime, mins, move, addBlock],
  );

  return {
    items: (q.data ?? []).filter((i) => !added.includes(i.id)),
    isLoading: q.isLoading,
    isError: q.isError,
    adding: move.isPending || addBlock.isPending,
    add,
  };
}
