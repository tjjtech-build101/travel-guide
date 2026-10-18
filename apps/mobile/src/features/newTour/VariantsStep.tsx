// Paso 3 · Elegí tu recorrido: 2-3 variantes de tour_variants (paradas reales en orden, minutos, km, pros/contras y
// qué lugares pedidos quedan afuera). "Armar este tour" → generate_tour con sus paradas.
import type { TourVariant } from '@build101/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { ErrorBox, InlineError, StepShell } from '../newTrip/parts';
import { requestVariants, startTour } from './flow';
import { kmLabel, parseTradeoff } from './model';
import { useNewTourStore } from './store';

export function VariantsStep() {
  const variants = useNewTourStore((s) => s.variants);
  const chosenId = useNewTourStore((s) => s.chosenId);
  const choose = useNewTourStore((s) => s.choose);
  const back = useNewTourStore((s) => s.back);
  const loading = useNewTourStore((s) => s.loading);
  const error = useNewTourStore((s) => s.error);
  const chosen = variants?.find((v) => v.id === chosenId) ?? null;
  const go = (v: TourVariant | null) => void startTour(v).then((ok) => ok && router.back());

  return (
    <StepShell
      step={3}
      title="Elegí tu recorrido"
      onBack={back}
      footer={chosen ? <Button label={`Armar "${chosen.label}"`} onPress={() => go(chosen)} loading={loading === 'start'} accessibilityHint="Investigo cada parada y escribo el tour; tarda un par de minutos" /> : null}
    >
      {loading === 'variants' ? (
        <View style={{ gap: space.md }} accessibilityLabel="Buscando lugares y armando recorridos">
          <Text style={styles.muted}>Buscando lugares con historia y armando 3 recorridos posibles…</Text>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton width="45%" height={22} />
              <Skeleton width="85%" height={16} />
              <Skeleton height={14} width="60%" />
              <Skeleton height={14} width="55%" />
            </View>
          ))}
        </View>
      ) : error.variants ? (
        <ErrorBox message={`${error.variants} Igual te lo puedo armar con lo que me contaste.`} onRetry={() => void requestVariants(true)} fallback={{ label: 'Armalo igual', onPress: () => go(null), loading: loading === 'start' }} />
      ) : variants?.length ? (
        <>
          <Text style={styles.muted}>Tocá el que más te guste. Después investigo cada parada a fondo.</Text>
          {variants.map((v) => (
            <VariantCard key={v.id} v={v} selected={v.id === chosenId} onPress={() => choose(v.id)} />
          ))}
          {error.start ? <InlineError message={error.start} /> : null}
        </>
      ) : (
        <ErrorBox message="Todavía no tengo recorridos para mostrarte." onRetry={() => void requestVariants(true)} />
      )}
    </StepShell>
  );
}

function VariantCard({ v, selected, onPress }: { v: TourVariant; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${v.label}${v.recommended ? ', recomendado' : ''}. ${v.pitch}. ${v.stops.length} paradas`}
      style={({ pressed }) => [styles.card, v.recommended && styles.recommended, selected && styles.selected, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.head}>
        <Text style={styles.label}>{v.label}</Text>
        {v.recommended ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Recomendado</Text>
          </View>
        ) : null}
      </View>
      {v.title ? <Text style={styles.title}>«{v.title}»</Text> : null}
      {v.pitch ? <Text style={styles.pitch}>{v.pitch}</Text> : null}
      <Text style={styles.meta}>
        {v.stops.length} paradas · ~{v.est_duration_min} min · {kmLabel(v.walk_m)} a pie
      </Text>
      <View style={styles.stops}>
        {v.stops.map((s, i) => (
          <View key={`${s.name}-${i}`} style={styles.stopRow}>
            <Text style={styles.stopNum}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stopName}>
                {s.name} <Text style={styles.stopKind}>· {s.kind}</Text>
              </Text>
              {s.why ? <Text style={styles.stopWhy}>{s.why}</Text> : null}
            </View>
          </View>
        ))}
      </View>
      {v.tradeoffs.length ? (
        <View style={{ gap: 2 }}>
          {v.tradeoffs.map((t) => {
            const p = parseTradeoff(t);
            return (
              <Text key={t} style={[styles.trade, p.sign === '+' ? styles.plus : p.sign === '−' ? styles.minus : null]}>
                {p.sign ?? '·'} {p.text}
              </Text>
            );
          })}
        </View>
      ) : null}
      {v.must_missing.length ? <Text style={styles.warn}>No entra: {v.must_missing.join(', ')}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: font.small, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.border, padding: space.lg, gap: space.sm },
  recommended: { borderColor: colors.khaki },
  selected: { borderColor: colors.primary, backgroundColor: colors.khakiLight },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  label: { fontSize: font.h3, fontWeight: '800', color: colors.text, flexShrink: 1 },
  badge: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: font.tiny, fontWeight: '800', color: colors.primaryText },
  title: { fontSize: font.body, fontWeight: '700', color: colors.khakiText },
  pitch: { fontSize: font.body, color: colors.text },
  meta: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  stops: { gap: space.xs, marginTop: space.xs },
  stopRow: { flexDirection: 'row', gap: space.sm },
  stopNum: { width: 20, fontSize: font.small, fontWeight: '800', color: colors.primary },
  stopName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  stopKind: { fontWeight: '400', color: colors.textMuted },
  stopWhy: { fontSize: font.tiny, color: colors.textMuted },
  trade: { fontSize: font.small, color: colors.text },
  plus: { color: colors.success },
  minus: { color: colors.danger },
  warn: { fontSize: font.small, fontWeight: '700', color: colors.danger },
});
