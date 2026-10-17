// Sección del menú dev: fecha/hora simulada (vista Ahora, PRD 19) y vista previa de estados del ScoutAvatar.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { previewScoutState, useScoutStore, type ScoutState } from '../../voice/useScout';
import { Chip } from '../plan/components/Controls';
import { useClockStore, useNow } from './clock';
import { localParts } from './selectors';

const PRESETS: { label: string; at: string }[] = [
  { label: 'Día 1 · 12:30', at: '2026-10-17T12:30' },
  { label: 'Día 2 · 10:30', at: '2026-10-18T10:30' },
  { label: 'Día 2 · 12:45', at: '2026-10-18T12:45' },
  { label: 'Día 2 · 14:00', at: '2026-10-18T14:00' },
  { label: 'Antes del viaje', at: '2026-10-14T10:00' },
];

const STATES: { value: ScoutState; label: string }[] = [
  { value: 'idle', label: 'Quieto' },
  { value: 'listening', label: 'Escucha' },
  { value: 'thinking', label: 'Piensa' },
  { value: 'speaking', label: 'Habla' },
];

export function ClockDevSection() {
  const { now, simulated } = useNow(10_000);
  const simulate = useClockStore((s) => s.simulate);
  const reset = useClockStore((s) => s.reset);
  const scoutState = useScoutStore((s) => s.state);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const local = localParts(now, -180);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Fecha y hora (Ahora)</Text>
      <Text style={styles.muted}>
        {simulated ? 'Simulada' : 'Real'} · {local.date} {String(Math.floor(local.minutes / 60)).padStart(2, '0')}:
        {String(local.minutes % 60).padStart(2, '0')} (Montevideo)
      </Text>
      <View style={styles.chips}>
        <Chip label="Real" selected={!simulated} onPress={reset} />
        {PRESETS.map((p) => (
          <Chip key={p.at} label={p.label} onPress={() => simulate(p.at)} />
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="2026-10-18T10:30"
        placeholderTextColor={colors.masked}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        onSubmitEditing={() => setError(simulate(text) ? null : 'Formato: AAAA-MM-DDTHH:MM')}
        returnKeyType="done"
        accessibilityLabel="Fecha y hora simulada"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={[styles.title, { marginTop: space.lg }]}>Avatar del Scout</Text>
      <View style={styles.avatarRow}>
        <ScoutAvatar size={72} state={scoutState} showLabel />
        <View style={[styles.chips, { flex: 1 }]}>
          {STATES.map((s) => (
            <Chip key={s.value} label={s.label} selected={scoutState === s.value} onPress={() => previewScoutState(s.value)} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  title: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.body,
    color: colors.text,
    fontFamily: 'Menlo',
  },
  error: { fontSize: font.tiny, color: colors.danger },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
});
