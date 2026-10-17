// Barra de tiempo del simulador: muestra el avance (con marcas de las paradas) y salta con botones de ±10 s / ±1 min.
// (Una barra arrastrable dentro del modal del menú dev no recibía los toques de forma confiable; los botones sí.)
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { formatClock } from './format';

type Props = {
  value: number;
  max: number;
  onSeek: (value: number) => void;
  /** Marcas (por ejemplo, paradas) en segundos. */
  ticks?: number[];
};

const STEPS = [
  { label: '−1 min', delta: -60 },
  { label: '−10 s', delta: -10 },
  { label: '+10 s', delta: 10 },
  { label: '+1 min', delta: 60 },
];

export function ScrubBar({ value, max, onSeek, ticks = [] }: Props) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={styles.hit}
        accessibilityRole="progressbar"
        accessibilityLabel="Posición en el track"
        accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
          {ticks.map((t, i) =>
            max > 0 ? <View key={i} style={[styles.tick, { left: `${Math.min(100, (t / max) * 100)}%` }]} /> : null,
          )}
        </View>
        <View style={[styles.thumb, { left: `${pct * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.mono}>{formatClock(value)}</Text>
        <Text style={styles.mono}>-{formatClock(Math.max(0, max - value))}</Text>
      </View>
      <View style={styles.steps}>
        {STEPS.map((s) => (
          <Pressable
            key={s.label}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            disabled={max <= 0}
            onPress={() => onSeek(Math.min(max, Math.max(0, value + s.delta)))}
            style={({ pressed }) => [styles.step, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <Text style={styles.stepText}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 24, justifyContent: 'center' },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.primary },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colors.text, opacity: 0.35 },
  thumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  mono: { fontFamily: 'Menlo', fontSize: font.tiny, color: colors.textMuted },
  steps: { flexDirection: 'row', gap: space.xs },
  step: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: font.tiny, fontWeight: '600', color: colors.text },
});
