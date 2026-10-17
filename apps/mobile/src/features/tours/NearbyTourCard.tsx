// Progreso de "Tour acá, ahora" en Ahora (PRD 18 → 07): líneas del job en vivo (Realtime de agent_jobs),
// paradas cuando está listo y "Empezar" (start_tour + motor). Error → "No pude armar el tour" + Reintentar.
import { SCOUT, type GenerateTourResult } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { supabase } from '../../lib/supabase';
import { useTourStore } from '../../tour/store';
import { Button } from '../../ui/Button';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { isStale, useAgentJob } from '../jobs/queries';
import { startNearbyTour, useNearbyTourJob } from './nearbyTour';

type TourStopName = { sort_order: number; name: string };

function useTourStops(tourId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['tour', tourId, 'stops'],
    enabled: !!tourId && enabled,
    queryFn: async () => {
      const [{ data: tour }, { data: stops }] = await Promise.all([
        supabase.from('tours').select('*').eq('id', tourId!).maybeSingle(), // '*': thesis puede no existir todavía
        supabase.from('tour_stops').select('sort_order, place_library(name)').eq('tour_id', tourId!).order('sort_order'),
      ]);
      const list = ((stops ?? []) as unknown as { sort_order: number; place_library: { name: string | null } | null }[]).map(
        (s): TourStopName => ({ sort_order: s.sort_order, name: s.place_library?.name ?? `Parada ${s.sort_order}` }),
      );
      return {
        title: (tour?.title as string | null) ?? null,
        thesis: ((tour as { thesis?: string | null } | null)?.thesis as string | null) ?? null,
        status: (tour?.status as string | null) ?? null,
        stops: list,
      };
    },
  });
}

/** Errores crudos del proveedor (JSON, códigos HTTP) → texto para la persona. */
function friendlyError(error: string | null | undefined): string {
  if (!error) return 'Algo falló armando el recorrido.';
  if (/credit balance|rate.?limit|overloaded|^\d{3}\s*\{/i.test(error)) {
    return `${SCOUT.name} no pudo investigar los lugares en este momento. Probá de nuevo en un rato.`;
  }
  return error.length > 160 ? `${error.slice(0, 157)}…` : error;
}

export function NearbyTourCard({ here }: { here: { lat: number; lng: number } | null }) {
  const job = useNearbyTourJob((s) => s.job);
  const clear = useNearbyTourJob((s) => s.clear);
  const q = useAgentJob(job?.jobId);
  const phase = useTourStore((s) => s.phase);
  const row = q.data ?? null;
  const status = row ? (isStale(row) ? 'failed' : row.status) : 'queued';
  const stops = useTourStops(job?.tourId ?? null, status === 'done');

  useEffect(() => {
    void useNearbyTourJob.getState().hydrate();
  }, []);

  if (!job) return null;
  const result = (row?.result ?? null) as GenerateTourResult | null;
  const lines = (row?.progress ?? []).slice(-3);

  const retry = async () => {
    if (!here) return;
    clear();
    // Mismas respuestas de la entrevista, desde donde estás ahora.
    await startNearbyTour({ ...job.input, lat: here.lat, lng: here.lng, duration_min: job.durationMin, trip_id: job.tripId ?? undefined });
  };

  const start = async () => {
    const ok = await useTourStore.getState().start({ tourId: job.tourId, tripId: job.tripId });
    if (ok) clear();
  };

  if (status === 'failed') {
    return (
      <View style={[styles.card, styles.error]}>
        <Text style={styles.kicker}>TOUR ACÁ, AHORA</Text>
        <Text style={styles.title}>No pude armar el tour</Text>
        <Text style={styles.body}>{friendlyError(row?.error)}</Text>
        <Button label="Reintentar" onPress={() => void retry()} disabled={!here} style={styles.btn} />
        <Button label="Cerrar" variant="ghost" onPress={clear} />
      </View>
    );
  }

  if (status === 'done') {
    const list = stops.data?.stops ?? [];
    return (
      <View style={[styles.card, styles.ready]}>
        <Text style={[styles.kicker, { color: colors.success }]}>TU TOUR ESTÁ LISTO</Text>
        <Text style={styles.title}>{stops.data?.title ?? 'Tour acá, ahora'}</Text>
        {stops.data?.thesis ? <Text style={styles.thesis}>{stops.data.thesis}</Text> : null}
        {result ? (
          <Text style={styles.body}>
            {result.stop_count} paradas · ~{result.est_duration_min} min · {(Math.round(result.total_walk_m / 100) / 10).toString().replace(".", ",")} km a pie
          </Text>
        ) : null}
        {list.length ? (
          <View style={styles.stops}>
            {list.map((s) => (
              <Text key={s.sort_order} style={styles.stop} numberOfLines={1}>
                {s.sort_order}. {s.name}
              </Text>
            ))}
          </View>
        ) : stops.isPending ? (
          <Skeleton height={18} />
        ) : null}
        <Button label="Empezar" loading={phase === 'starting'} onPress={() => void start()} style={styles.btn} />
        <Button label="Ahora no" variant="ghost" onPress={clear} />
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <ScoutAvatar size={44} state="thinking" />
        <View style={styles.flex}>
          <Text style={styles.kicker}>TOUR ACÁ, AHORA · {job.durationMin} MIN</Text>
          <Text style={styles.title}>{SCOUT.name} está armando tu tour…</Text>
        </View>
      </View>
      {lines.length ? (
        lines.map((l, i) => (
          <Text key={`${l.at}-${i}`} style={[styles.line, i === lines.length - 1 && styles.lineLast]}>
            {l.text}
          </Text>
        ))
      ) : (
        <Skeleton height={16} />
      )}
      <Text style={styles.muted}>Busco lugares, pienso la historia y verifico cada dato con su fuente. Tarda un par de minutos.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.scout, padding: space.lg, gap: space.xs },
  ready: { borderColor: colors.success },
  error: { borderColor: colors.danger },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.scout },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, color: colors.text },
  thesis: { fontSize: font.small, color: colors.textMuted, fontStyle: 'italic' },
  muted: { fontSize: font.small, color: colors.textMuted, marginTop: space.xs },
  line: { fontSize: font.small, color: colors.textMuted },
  lineLast: { color: colors.text, fontWeight: '700' },
  stops: { gap: 2, marginTop: space.xs },
  stop: { fontSize: font.body, color: colors.text },
  btn: { marginTop: space.sm },
});
