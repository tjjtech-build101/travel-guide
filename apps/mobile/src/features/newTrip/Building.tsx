// Armando (progreso en vivo): AgentJobProgress + LiveItinerary. Al terminar, si plan_trip dejó el menú
// (stage 'menu', PRD 31) vamos al menú del viaje; si no, al viaje.
import type { PlanTripResult, PlanTripStart } from '@build101/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTrip, useTripLegs } from '../trips/queries';
import { useTripRealtime } from '../../realtime/useTripRealtime';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, space } from '../../ui/theme';
import { AgentJobProgress } from '../jobs/AgentJobProgress';
import { LiveItinerary } from '../jobs/LiveItinerary';
import { useNewTripStore } from './store';

export function Building({ job }: { job: PlanTripStart }) {
  const reset = useNewTripStore((s) => s.reset);
  const jobMode = useNewTripStore((s) => s.jobMode);
  const trip = useTrip(job.trip_id);
  const legs = useTripLegs(job.trip_id);
  useTripRealtime(job.trip_id); // legs/blocks llegan en vivo
  const [finished, setFinished] = useState<null | 'menu' | 'planned'>(null);

  // El viaje ya no existe (se borró o no tengo acceso): volvemos al inicio del flujo en vez de quedar en blanco.
  useEffect(() => {
    if (trip.isSuccess && trip.data === null) reset();
  }, [trip.isSuccess, trip.data, reset]);

  const openTrip = useCallback(
    (to: 'menu' | 'planned' = 'planned') => {
      reset();
      if (to === 'menu') router.replace({ pathname: '/trip/[tripId]/menu', params: { tripId: job.trip_id } });
      else router.replace({ pathname: '/trip/[tripId]', params: { tripId: job.trip_id } });
    },
    [job.trip_id, reset],
  );

  // Al terminar bien: un momento para ver el "Listo" y vamos al menú o al viaje.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => openTrip(finished), 1500);
    return () => clearTimeout(t);
  }, [finished, openTrip]);

  const onDone = useCallback((row: { result: unknown }) => {
    const stage = (row.result as PlanTripResult | null)?.stage;
    setFinished(stage === 'menu' ? 'menu' : 'planned');
  }, []);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.building}>
        <Text style={styles.tripTitle}>{trip.data?.title ?? 'Tu viaje'}</Text>
        {jobMode === 'menu' ? (
          <Text style={styles.sub}>Estoy armando los tramos y un menú por ciudad para que el grupo elija.</Text>
        ) : null}
        <View style={{ marginTop: space.md }}>
          <AgentJobProgress tripId={job.trip_id} jobId={job.job_id} onDone={onDone} showSkeleton />
        </View>
        <LiveItinerary tripId={job.trip_id} />
      </ScrollView>
      <View style={styles.footer}>
        <Button label="Ver el viaje" onPress={() => openTrip(finished ?? 'planned')} disabled={!legs.data?.length} />
        <Button
          label="Empezar otro viaje"
          variant="ghost"
          onPress={reset}
          accessibilityHint="El viaje que se está armando sigue en el inicio"
          style={{ marginTop: space.xs }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  building: { padding: space.lg, paddingBottom: space.xxl },
  tripTitle: { fontSize: font.title, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: space.xs },
  footer: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
