// agent_jobs en vivo. Por id: canal Realtime propio `job:<id>` que escribe la fila nueva en la caché
// (sirve aunque el viaje recién se creó). Por viaje: la consulta la invalida useTripRealtime.
// Fallback GET /jobs/:id solo si el canal falla (PRD 00/01). Nunca polling.
import type { AgentJobRow } from '@build101/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { env } from '../../lib/env';
import { supabase } from '../../lib/supabase';
import { tripKeys } from '../trips/keys';

export const jobKeys = {
  one: (jobId: string) => ['job', jobId] as const,
};

async function fetchJob(jobId: string): Promise<AgentJobRow | null> {
  const { data, error } = await supabase.from('agent_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error && error.code !== '22P02') throw error;
  return (data as AgentJobRow | null) ?? null;
}

/** Fallback cuando Realtime no anda: GET /jobs/:id de la API. */
async function fetchJobFromApi(jobId: string): Promise<AgentJobRow | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!env.apiUrl || !token) return null;
  const res = await fetch(`${env.apiUrl}/jobs/${jobId}`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => null)) as { ok: boolean; data?: AgentJobRow } | null;
  return json?.ok ? (json.data ?? null) : null;
}

export function useAgentJob(jobId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: jobKeys.one(jobId ?? 'none'),
    enabled: !!jobId,
    queryFn: () => fetchJob(jobId!),
  });

  useEffect(() => {
    if (!jobId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    const key = jobKeys.one(jobId);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = supabase
        // Nombre único: dos componentes mirando el mismo job (o un remount) reusarían un canal ya suscripto.
        .channel(`job:${jobId}:${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_jobs', filter: `id=eq.${jobId}` }, (payload) => {
          qc.setQueryData(key, payload.new as AgentJobRow);
        })
        .subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            // Lo que pasó antes de suscribirnos.
            void qc.invalidateQueries({ queryKey: key });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            void fetchJobFromApi(jobId).then((row) => row && qc.setQueryData(key, row));
          }
        });
    })();
    // Al volver de background: ponerse al día una vez.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void qc.invalidateQueries({ queryKey: key });
    });
    return () => {
      cancelled = true;
      sub.remove();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [jobId, qc]);

  return query;
}

/** Último job de armado del viaje: plan_trip o compose_days (PRD 31). Lo invalida useTripRealtime con cada evento de agent_jobs. */
export function useLatestPlanJob(tripId: string, enabled = true) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'agent_jobs'),
    enabled,
    queryFn: async (): Promise<AgentJobRow | null> => {
      const { data, error } = await supabase
        .from('agent_jobs')
        .select('*')
        .eq('trip_id', tripId)
        .in('kind', ['plan_trip', 'compose_days'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as AgentJobRow | null) ?? null;
    },
  });
}

/** Un job 'running' sin novedades hace rato quedó colgado (se cayó la función): se trata como fallido. */
export function isStale(job: Pick<AgentJobRow, 'status' | 'updated_at'>, now = Date.now()): boolean {
  return (job.status === 'running' || job.status === 'queued') && now - new Date(job.updated_at).getTime() > 3 * 60_000;
}
