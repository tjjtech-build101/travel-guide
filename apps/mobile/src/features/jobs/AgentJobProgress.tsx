// Panel de progreso de plan_trip (PRD 01). Reutilizable: se monta arriba de Plan (PRD 02) o en "Nuevo viaje".
// running → barra + últimas 4 líneas + contador en vivo (+ esqueleto de tramos mientras no hay bloques)
// done → chip "Listo: …" con "Ver supuestos" y "Deshacer" · failed → banner + "Reintentar".
import type { AgentJobRow, PlanTripResult, PlanTripStart } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
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

/** El chip de "Listo" se muestra hasta 6 h después de terminar (después ya no aporta). */
const DONE_VISIBLE_MS = 6 * 60 * 60 * 1000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AgentJobProgress({ tripId, jobId: jobIdProp, onDone, showSkeleton = true }: Props) {
  const qc = useQueryClient();
  const [retryJobId, setRetryJobId] = useState<string>();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState<'undo' | 'retry' | null>(null);
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

  if (status === 'done') {
    if (Date.now() - new Date(row.updated_at).getTime() > DONE_VISIBLE_MS && !jobIdProp) return null;
    if (undone) {
      return (
        <View style={[styles.chip, styles.chipMuted]} accessibilityLiveRegion="polite">
          <Text style={styles.chipText}>Deshiciste el plan. El viaje quedó vacío.</Text>
        </View>
      );
    }
    const undo = async () => {
      if (!result?.undo_token) return;
      setBusy('undo');
      const res = await callTool('undo', { undo_token: result.undo_token });
      setBusy(null);
      if (res.ok || res.error.code === 'already_undone') {
        setUndone(true);
        void qc.invalidateQueries({ queryKey: tripKeys.all(tripId) });
        void qc.invalidateQueries({ queryKey: tripKeys.mine() });
      } else {
        Alert.alert('No pude deshacer', res.error.message);
      }
    };
    return (
      <View style={styles.chip} accessibilityLiveRegion="polite">
        <Text style={styles.chipText}>
          Listo: {plural(result?.legs ?? legCount, 'tramo', 'tramos')}, {plural(result?.days ?? 0, 'día', 'días')},{' '}
          {plural(result?.blocks ?? blockCount, 'bloque', 'bloques')}
        </Text>
        <View style={styles.chipActions}>
          {result?.assumptions?.length ? (
            <ChipLink label="Ver supuestos" onPress={() => Alert.alert('Lo que supuse', result.assumptions.map((a) => `• ${a}`).join('\n\n'))} />
          ) : null}
          {result?.undo_token ? (
            <ChipLink
              label={busy === 'undo' ? 'Deshaciendo…' : 'Deshacer'}
              onPress={() =>
                Alert.alert('¿Deshacer todo el plan?', 'Se borran los tramos, días y bloques que armó el compañero.', [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Deshacer', style: 'destructive', onPress: () => void undo() },
                ])
              }
            />
          ) : null}
        </View>
      </View>
    );
  }

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

function ChipLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={styles.chipLink}>
      <Text style={styles.chipLinkText}>{label}</Text>
    </Pressable>
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
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  chipMuted: { backgroundColor: colors.surfaceMuted },
  chipText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  chipActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  chipLink: { minHeight: 32, justifyContent: 'center' },
  chipLinkText: { fontSize: font.small, color: colors.primary, fontWeight: '600' },
  banner: { backgroundColor: colors.dangerBg, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.danger },
  bannerTitle: { fontSize: font.h3, fontWeight: '700', color: colors.danger },
  bannerDetail: { fontSize: font.small, color: colors.text, marginTop: space.xs },
  skeletonWrap: { marginTop: space.lg, gap: space.lg },
  skeletonLeg: { gap: 0 },
  legTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  dayLabel: { fontSize: font.small, color: colors.textMuted, textTransform: 'capitalize' },
});
