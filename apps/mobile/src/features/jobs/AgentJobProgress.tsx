// Panel de progreso de plan_trip (PRD 01). Reutilizable: se monta arriba de Plan (PRD 02) o en "Nuevo viaje".
// running → barra + últimas 4 líneas + contador en vivo (+ esqueleto de tramos mientras no hay bloques)
// done → nada (pantalla limpia) · failed → banner + "Reintentar".
import type { AgentJobRow, PlanTripResult, PlanTripStart } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { callTool } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { tripKeys } from '../trips/keys';
import { useTripBlocks, useTripLegs } from '../trips/queries';
import { isStale, useAgentJob, useLatestPlanJob } from './queries';

type Props = {
  tripId: string;
  /** Job a seguir. Si no viene, se usa el último plan_trip del viaje. */
  jobId?: string;
  /** Se llama una vez cuando el job termina bien. */
  onDone?: (job: AgentJobRow) => void;
  /** Mostrar el esqueleto de tramos/días mientras no hay bloques (default true). */
  showSkeleton?: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AgentJobProgress({ tripId, jobId: jobIdProp, onDone, showSkeleton = true }: Props) {
  const qc = useQueryClient();
  const [retryJobId, setRetryJobId] = useState<string>();
  const [busy, setBusy] = useState<'retry' | null>(null);
  const latest = useLatestPlanJob(tripId, !jobIdProp && !retryJobId);
  const jobId = retryJobId ?? jobIdProp ?? latest.data?.id;
  const job = useAgentJob(jobId);
  const legs = useTripLegs(tripId);
  const blocks = useTripBlocks(tripId);

  const row = job.data ?? null;
  const progressLen = row?.progress?.length ?? 0;
  const status = row ? (isStale(row) ? 'failed' : row.status) : null;

  // days no viaja por Realtime: con cada novedad del job refrescamos tramos/días y bloques.
  useEffect(() => {
    if (!row) return;
    void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'days') });
    void qc.invalidateQueries({ queryKey: tripKeys.table(tripId, 'blocks') });
  }, [progressLen, status, row, qc, tripId]);

  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (row && status === 'done' && notified.current !== row.id) {
      notified.current = row.id;
      void qc.invalidateQueries({ queryKey: tripKeys.all(tripId) });
      void qc.invalidateQueries({ queryKey: tripKeys.mine() });
      onDone?.(row);
    }
  }, [row, status, onDone, qc, tripId]);

  if (!jobId || !row) {
    if (jobId && job.isPending) return <View style={styles.card}><Skeleton height={18} width="70%" /><Skeleton height={14} style={{ marginTop: space.md }} /></View>;
    return null;
  }

  const result = (row.result ?? null) as PlanTripResult | null;
  const legCount = legs.data?.length ?? 0;
  const blockCount = blocks.data?.length ?? 0;

  // Pantalla más limpia: el cartel "Listo: X tramos, Y días..." (con "Deshacer"/"Ver supuestos") ya no
  // se muestra en Ahora/Planificación una vez que plan_trip termina. Si hace falta reactivarlo, el
  // bloque vivía acá mismo (git log de este archivo tiene el detalle: chip + undo_token + assumptions).
  if (status === 'done') return null;

  if (status === 'failed') {
    const cities = result?.failed_legs?.map((f) => f.city) ?? [];
    const title = cities.length ? `Se trancó armando ${cities.join(' y ')}` : 'Se trancó armando el viaje';
    const retry = async () => {
      setBusy('retry');
      const conversation = result?.request?.conversation?.length
        ? result.request.conversation
        : [{ role: 'user' as const, text: 'Completá los tramos que faltan.' }];
      const res = await callTool<'plan_trip', PlanTripStart>('plan_trip', { trip_id: tripId, conversation });
      setBusy(null);
      if (res.ok) setRetryJobId(res.data.job_id);
      else if (res.error.code === 'trip_not_empty') Alert.alert('Ya está todo armado', 'Todos los tramos tienen bloques.');
      else Alert.alert('No pude reintentar', res.error.message);
    };
    return (
      <View style={styles.banner} accessibilityRole="alert">
        <Text style={styles.bannerTitle}>{title}</Text>
        {row.error ? (
          <Text style={styles.bannerDetail} numberOfLines={3}>
            {row.error}
          </Text>
        ) : null}
        <Text style={styles.bannerDetail}>Lo que ya armé queda. Reintentar completa solo lo que falta.</Text>
        <Button label="Reintentar" variant="danger" loading={busy === 'retry'} onPress={() => void retry()} style={{ marginTop: space.md }} />
      </View>
    );
  }

  // queued / running
  const lines = row.progress ?? [];
  const start = Math.max(0, lines.length - 4);
  return (
    <View>
      <View style={styles.card} accessibilityLiveRegion="polite">
        <Text style={styles.title}>Tu compañero está armando el viaje</Text>
        <IndeterminateBar />
        <View style={styles.lines}>
          {lines.slice(start).map((l, i) => (
            <Animated.Text
              key={start + i}
              entering={FadeInDown.duration(250)}
              style={[styles.line, start + i === lines.length - 1 && styles.lineLast]}
              numberOfLines={2}
            >
              {l.text}
            </Animated.Text>
          ))}
        </View>
        <Text style={styles.counter}>
          {plural(legCount, 'tramo', 'tramos')} · {plural(blockCount, 'bloque', 'bloques')}
        </Text>
      </View>
      {showSkeleton && blockCount === 0 ? <LegsSkeleton tripId={tripId} /> : null}
    </View>
  );
}

function IndeterminateBar() {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.4 + x.value * width * 1.4 }] }));
  return (
    <View style={styles.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel="Armando">
      <Animated.View style={[styles.barFill, { width: width * 0.4 }, style]} />
    </View>
  );
}

/** Nunca pantalla vacía: tramos/días que ya existen como esqueleto hasta que llega el primer bloque. */
function LegsSkeleton({ tripId }: { tripId: string }) {
  const legs = useTripLegs(tripId);
  const list = legs.data ?? [];
  if (!list.length) {
    return (
      <View style={styles.skeletonWrap}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.skeletonLeg}>
            <Skeleton width="45%" height={20} />
            <Skeleton height={44} style={{ marginTop: space.sm }} />
            <Skeleton height={44} style={{ marginTop: space.sm }} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.skeletonWrap}>
      {list.map((leg) => (
        <View key={leg.id} style={styles.skeletonLeg}>
          <Text style={styles.legTitle}>{leg.city}</Text>
          {leg.days.slice(0, 4).map((d) => (
            <View key={d.id} style={{ marginTop: space.sm }}>
              <Text style={styles.dayLabel}>{formatDay(d.date)}</Text>
              <Skeleton height={36} style={{ marginTop: space.xs }} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  title: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: space.md },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  lines: { marginTop: space.md, gap: space.xs, minHeight: 4 * 22 },
  line: { fontSize: font.small, color: colors.textMuted },
  lineLast: { color: colors.text, fontWeight: '600' },
  counter: { marginTop: space.md, fontSize: font.small, fontWeight: '700', color: colors.primary },
  banner: { backgroundColor: colors.dangerBg, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.danger },
  bannerTitle: { fontSize: font.h3, fontWeight: '700', color: colors.danger },
  bannerDetail: { fontSize: font.small, color: colors.text, marginTop: space.xs },
  skeletonWrap: { marginTop: space.lg, gap: space.lg },
  skeletonLeg: { gap: 0 },
  legTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  dayLabel: { fontSize: font.small, color: colors.textMuted, textTransform: 'capitalize' },
});
