// Paso 3 · Elegí la forma del viaje: 2-3 TripShape de trip_shapes con línea de tiempo, pros/contras y supuestos.
import type { TripShape } from '@build101/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDateRange } from '../../lib/format';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { requestShapes, startPlan } from './flow';
import { durationLabel, MODE_LABEL, nightsLabel, parseTradeoff, shortRange, timeline } from './model';
import { ErrorBox, InlineError, ModeIcon, StepShell } from './parts';
import { useNewTripStore } from './store';

export function ShapesStep() {
  const shapes = useNewTripStore((s) => s.shapes);
  const chosenId = useNewTripStore((s) => s.chosenShapeId);
  const chooseShape = useNewTripStore((s) => s.chooseShape);
  const setPhase = useNewTripStore((s) => s.setPhase);
  const back = useNewTripStore((s) => s.back);
  const loading = useNewTripStore((s) => s.loading);
  const error = useNewTripStore((s) => s.error);

  useEffect(() => {
    const s = useNewTripStore.getState();
    if (!s.shapes?.length && !s.loading && !s.error.shapes) void requestShapes();
  }, []);

  const fallback = { label: 'Armalo igual', onPress: () => void startPlan('auto', false), loading: loading === 'plan' };

  return (
    <StepShell
      step={3}
      title="Elegí la forma del viaje"
      onBack={back}
      scout={
        loading === 'shapes'
          ? { text: 'Pensando 3 formas de armarlo…', mode: 'thinking' }
          : error.shapes
            ? { text: 'No me salieron las formas. Probemos de nuevo, o lo armo igual.', mode: 'error' }
            : shapes?.length
              ? { text: 'Te armé estas formas. Tocá la que más te guste: después lo afinamos.', pose: 'compass' }
              : undefined
      }
    >
      {loading === 'shapes' ? (
        <View style={{ gap: space.md }} accessibilityLabel="Pensando 3 formas de armarlo">
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.card}>
              <Skeleton width="50%" height={22} />
              <Skeleton width="85%" height={16} />
              <Skeleton height={14} width="60%" style={{ marginTop: space.sm }} />
              <Skeleton height={14} width="55%" />
              <Skeleton height={14} width="65%" />
            </View>
          ))}
        </View>
      ) : error.shapes ? (
        <ErrorBox error={error.shapes} doing="pensar las formas del viaje" onRetry={() => void requestShapes(true)} fallback={fallback} />
      ) : shapes?.length ? (
        <>
          {shapes.map((s) => (
            <ShapeCard
              key={s.id}
              shape={s}
              selected={s.id === chosenId}
              onPress={() => {
                chooseShape(s.id);
                setPhase('build');
              }}
            />
          ))}
          {error.plan ? <InlineError error={error.plan} doing="arrancar a armar el viaje" /> : null}
        </>
      ) : (
        <ErrorBox message="Todavía no tengo formas para mostrarte." onRetry={() => void requestShapes(true)} fallback={fallback} />
      )}
    </StepShell>
  );
}

export function ShapeTimeline({ shape }: { shape: TripShape }) {
  const rows = timeline(shape);
  return (
    <View style={styles.timeline}>
      {rows.map(({ leg, nights, transfer }, i) => (
        <View key={leg.key}>
          <View style={styles.legRow}>
            <View style={styles.dot} />
            <Text style={styles.city} numberOfLines={1}>
              {leg.city}
            </Text>
            <Text style={styles.legDates}>
              {shortRange(leg.start_date, leg.end_date)} · {nightsLabel(nights)}
            </Text>
          </View>
          {!leg.includes_organizer || leg.parallel_with.length ? (
            <Text style={styles.split}>{leg.participant_names.length ? `Van: ${leg.participant_names.join(', ')}` : 'En paralelo'}</Text>
          ) : null}
          {transfer && i < rows.length - 1 ? (
            <View style={styles.transfer} accessibilityLabel={`${MODE_LABEL[transfer.mode]}, ${durationLabel(transfer.duration_min)}`}>
              <ModeIcon mode={transfer.mode} />
              <Text style={styles.transferText}>
                {MODE_LABEL[transfer.mode]} · {durationLabel(transfer.duration_min)}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function ShapeCard({ shape, selected, onPress }: { shape: TripShape; selected: boolean; onPress: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${shape.label}${shape.recommended ? ', recomendado' : ''}. ${shape.pitch}`}
      accessibilityHint="Elige esta forma del viaje"
      style={({ pressed }) => [styles.card, shape.recommended && styles.cardRecommended, selected && styles.cardSelected, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.label}>{shape.label}</Text>
        {shape.recommended ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Recomendado</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.pitch}>{shape.pitch}</Text>
      <Text style={styles.range}>{formatDateRange(shape.start_date, shape.end_date)}</Text>
      <ShapeTimeline shape={shape} />
      {shape.tradeoffs.length ? (
        <View style={styles.tradeoffs}>
          {shape.tradeoffs.map((t) => {
            const { sign, text } = parseTradeoff(t);
            return (
              <View key={t} style={styles.tradeoff}>
                <Text style={[styles.sign, sign === '+' ? styles.plus : sign === '−' ? styles.minus : null]}>{sign ?? '·'}</Text>
                <Text style={styles.tradeoffText}>{text}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {shape.assumptions.length ? (
        <>
          <Pressable
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            hitSlop={6}
            style={styles.assumeBtn}
          >
            <Text style={styles.assumeToggle}>
              {open ? 'Ocultar supuestos' : `Supuestos (${shape.assumptions.length})`}
            </Text>
          </Pressable>
          {open
            ? shape.assumptions.map((a) => (
                <Text key={a} style={styles.assume}>
                  · {a}
                </Text>
              ))
            : null}
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  cardRecommended: { borderColor: colors.khaki },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  label: { fontSize: font.h3, fontWeight: '800', color: colors.text, flexShrink: 1 },
  badge: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: font.tiny, fontWeight: '800', color: colors.primaryText },
  pitch: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  range: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  timeline: { gap: 2, paddingLeft: space.xs },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  city: { fontSize: font.small, fontWeight: '700', color: colors.text, flexShrink: 1 },
  legDates: { fontSize: font.tiny, color: colors.textMuted, marginLeft: 'auto' },
  split: { fontSize: font.tiny, color: colors.ghost, marginLeft: 18 },
  transfer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 1, paddingVertical: 2, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: space.md },
  transferText: { fontSize: font.tiny, color: colors.textMuted },
  tradeoffs: { gap: 2 },
  tradeoff: { flexDirection: 'row', gap: space.sm },
  sign: { fontSize: font.small, fontWeight: '800', color: colors.textMuted, width: 12, textAlign: 'center' },
  plus: { color: colors.success },
  minus: { color: colors.danger },
  tradeoffText: { fontSize: font.small, color: colors.text, flex: 1 },
  assumeBtn: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  assumeToggle: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  assume: { fontSize: font.tiny, color: colors.textMuted, lineHeight: 18 },
});
