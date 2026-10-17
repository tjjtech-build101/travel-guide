// Frase de Scout (docs/AHORA-V2.md): al instante la versión por reglas (nowBriefRules) y, cuando el momento se
// queda quieto 1,5 s, la de Claude (now_brief). La key no incluye la hora (briefKey): solo se pide otra frase
// cuando cambia algo que se nota. Mientras llega, si el momento es el mismo (briefIdentity), sigue la frase
// anterior de Claude: nada de LLM → reglas → LLM. Si now_brief falla o no hay saldo, quedan las reglas.
import { type NowBriefOutput, type NowBriefSnapshotT, nowBriefRules } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { briefIdentity, briefKey } from './pure';
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

  // Última frase de Claude y de qué momento era.
  const identity = briefIdentity(snapshot);
  const lastLlm = useRef<{ identity: string; text: string } | null>(null);
  const fresh = settled?.key === key ? q.data : null;
  if (fresh && settled) lastLlm.current = { identity: briefIdentity(settled.snapshot) ?? '', text: fresh.text };

  if (!snapshot || !key) return { text: null, source: 'rules', loading: false };
  if (fresh) return { text: fresh.text, source: fresh.source, loading: false };
  if (lastLlm.current && lastLlm.current.identity === identity) return { text: lastLlm.current.text, source: 'llm', loading: false };
  return { text: rules, source: 'rules', loading: settled?.key !== key || q.isFetching };
}
