// Frase de Scout (docs/AHORA-V2.md): al instante la versión por reglas (nowBriefRules) y, cuando el momento se
// queda quieto 1,5 s, la de Claude (now_brief). La key redondea minutos a 5: no se llama en cada tick.
// Si now_brief falla o no hay saldo, quedan las reglas.
import { type NowBriefOutput, type NowBriefSnapshotT, nowBriefRules } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { briefKey } from './pure';
import { callNowTool } from './nowApi';

const DEBOUNCE_MS = 1500;

export function useScoutLine(
  snapshot: NowBriefSnapshotT | null,
  tripId: string,
): { text: string | null; source: 'llm' | 'rules'; loading: boolean } {
  const key = useMemo(() => briefKey(snapshot), [snapshot]);
  const rules = useMemo(() => (snapshot ? nowBriefRules(snapshot) : null), [snapshot]);

  // El snapshot que se manda es el del momento en que la key se asentó.
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [settled, setSettled] = useState<{ key: string; snapshot: NowBriefSnapshotT } | null>(null);
  useEffect(() => {
    if (!key) return;
    const id = setTimeout(() => {
      if (latest.current) setSettled({ key, snapshot: latest.current });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [key]);

  const q = useQuery({
    queryKey: ['now_brief', tripId, settled?.key ?? null],
    enabled: !!settled,
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<NowBriefOutput | null> => {
      const res = await callNowTool<'now_brief', NowBriefOutput>(
        'now_brief',
        { trip_id: tripId, language: 'es', snapshot: settled!.snapshot },
        { signal },
      );
      return res.ok && res.data.text ? res.data : null;
    },
  });

  if (!snapshot || !key) return { text: null, source: 'rules', loading: false };
  const llm = settled?.key === key ? q.data : null;
  if (llm) return { text: llm.text, source: llm.source, loading: false };
  return { text: rules, source: 'rules', loading: settled?.key !== key || q.isFetching };
}
