// Armando (progreso en vivo): AgentJobProgress + LiveItinerary. Al terminar, si plan_trip dejó el menú
// (stage 'menu', PRD 31) vamos al menú del viaje; si no, al viaje.
import type { AgentJobRow, PlanTripResult, PlanTripStart } from '@build101/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTrip, useTripLegs } from '../trips/queries';
import { describeError, type ErrorView } from '../../lib/errors';
import { useTripRealtime } from '../../realtime/useTripRealtime';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { ScoutSays } from '../../ui/ScoutSays';
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
  // Si el armado falla, el Scout no puede seguir diciendo "Estoy armando…": cuenta la causa (lib/errors).
  const [failure, setFailure] = useState<ErrorView | null>(null);
  const onStatus = useCallback(
    (status: string | null, row: AgentJobRow | null) => {
      setFailure(status === 'failed' && row ? describeError(row.status === 'failed' ? row : { code: 'job_stale', message: '' }, { doing: 'armar el viaje' }) : null);
    },
    [],
  );

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
        <ScoutSays
          style={{ marginTop: space.sm }}
          size={78}
          pose={finished ? 'thumbs' : failure ? 'think' : 'map'}
          mode={failure ? 'thinking' : 'idle'}
          text={
            finished
              ? '¡Listo! Vamos a verlo.'
              : failure
                ? failure.retryable
                  ? `Uy, me trabé. ${failure.title}. Lo que ya armé queda; abajo podés reintentar.`
                  : `Uy, me trabé. ${failure.title}. Esto no se arregla reintentando: abajo te explico qué pasó.`
                : jobMode === 'menu'
                ? 'Estoy armando los tramos y un menú por ciudad para que el grupo elija. Te los voy mostrando acá.'
                : 'Estoy armando los días. Te los voy mostrando a medida que salen.'
          }
        />
        <View style={{ marginTop: space.md }}>
          <AgentJobProgress tripId={job.trip_id} jobId={job.job_id} onDone={onDone} onStatus={onStatus} showSkeleton />
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
  footer: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
});
