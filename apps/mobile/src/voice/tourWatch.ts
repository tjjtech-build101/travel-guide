// generate_tour es un job (PRD 06/18): la voz recibe { job_id, tour_id } enseguida y las paradas llegan después.
// Escuchamos el job por Realtime (canal propio, como features/jobs/queries) y armamos el payload de [EVENTO:tour_ready].
// Sin polling: si el canal falla, una sola lectura (GET de la fila) y el timeout.
import type { AgentJobRow, GenerateTourResult, TourReadyEvent } from '@build101/shared';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../lib/supabase';

const TIMEOUT_MS = 6 * 60_000;
/** El job escribe progreso cada ~10 s (heartbeat). Sin novedades en este tiempo, la función murió (p. ej. límite de Vercel). */
const STALE_MS = 45_000;

export type TourWatchResult = { ok: true; event: TourReadyEvent } | { ok: false; error: string };

async function readJob(jobId: string): Promise<AgentJobRow | null> {
  const { data } = await supabase.from('agent_jobs').select('*').eq('id', jobId).maybeSingle();
  return (data as AgentJobRow | null) ?? null;
}

/** Título y nombres de las paradas (tours / tour_stops / place_library, lectura con RLS). */
export async function tourReadyPayload(tourId: string, result: GenerateTourResult | null): Promise<TourReadyEvent> {
  const [{ data: tour }, { data: stops }] = await Promise.all([
    supabase.from('tours').select('title').eq('id', tourId).maybeSingle(),
    supabase.from('tour_stops').select('sort_order, place_library(name)').eq('tour_id', tourId).order('sort_order'),
  ]);
  const list = ((stops ?? []) as unknown as { sort_order: number; place_library: { name: string | null } | null }[]).map((s) => ({
    sort_order: s.sort_order,
    name: s.place_library?.name ?? `Parada ${s.sort_order}`,
  }));
  return {
    tour_id: tourId,
    title: (tour?.title as string | null | undefined) ?? null,
    stop_count: result?.stop_count ?? list.length,
    est_duration_min: result?.est_duration_min ?? 0,
    total_walk_m: result?.total_walk_m ?? 0,
    stops: list,
  };
}

/** Resuelve cuando el job termina (done → payload; failed/timeout → error). */
export function watchTourJob(jobId: string, tourId: string): Promise<TourWatchResult> {
  return new Promise((resolve) => {
    let channel: RealtimeChannel | null = null;
    let finished = false;
    let stale: ReturnType<typeof setTimeout> | null = null;
    const armStale = () => {
      if (stale) clearTimeout(stale);
      stale = setTimeout(() => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (channel) void supabase.removeChannel(channel);
        resolve({ ok: false, error: 'El armado del tour se cortó a mitad de camino' });
      }, STALE_MS);
    };
    armStale();
    const finish = async (row: AgentJobRow | null) => {
      if (finished || !row) return;
      if (row.status !== 'done' && row.status !== 'failed') return armStale(); // progreso: sigue vivo
      if (stale) clearTimeout(stale);
      finished = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
      if (row.status === 'failed') return resolve({ ok: false, error: row.error ?? 'No se pudo armar el tour' });
      resolve({ ok: true, event: await tourReadyPayload(tourId, row.result as GenerateTourResult | null) });
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      if (channel) void supabase.removeChannel(channel);
      resolve({ ok: false, error: 'El armado del tour tardó demasiado' });
    }, TIMEOUT_MS);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      channel = supabase
        .channel(`voice-tour-job:${jobId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_jobs', filter: `id=eq.${jobId}` }, (p) =>
          void finish(p.new as AgentJobRow),
        )
        .subscribe((status) => {
          // Al suscribirse (o si el canal falla): una lectura por si ya terminó antes.
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void readJob(jobId).then(finish);
        });
    })();
  });
}
