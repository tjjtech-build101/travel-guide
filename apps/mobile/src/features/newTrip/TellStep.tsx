// Paso 1 · Contame: texto libre + frases de ejemplo + fecha de inicio. "Seguir" → trip_brief; "Armalo ya" → plan_trip auto.
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { formatDay } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { requestBrief, startPlan } from './flow';
import { TELL_EXAMPLES, TELL_PROMPT } from './model';
import { DateRow, InlineError, StepShell } from './parts';
import { useNewTripStore } from './store';

export function TellStep() {
  const story = useNewTripStore((s) => s.story);
  const startDate = useNewTripStore((s) => s.startDate);
  const setStory = useNewTripStore((s) => s.setStory);
  const setStartDate = useNewTripStore((s) => s.setStartDate);
  const loading = useNewTripStore((s) => s.loading);
  const planError = useNewTripStore((s) => s.error.plan);
  const [showDates, setShowDates] = useState(false);
  const empty = !story.trim();

  return (
    <StepShell
      step={1}
      title="Contame"
      scout={
        loading === 'brief'
          ? { text: 'Dale, lo leo…', mode: 'thinking' }
          : loading === 'plan'
            ? { text: '¡Manos a la obra! Lo armo con lo que me contaste.', pose: 'map' }
            : empty
              ? { text: TELL_PROMPT, pose: 'wave' }
              : { text: '¡Buenísimo! Cuando quieras, seguimos.', pose: 'thumbs' }
      }
      footer={
        <>
          <Button label="Seguir" onPress={() => void requestBrief()} disabled={empty} loading={loading === 'brief'} />
          <Button
            label="Armalo ya"
            variant="ghost"
            onPress={() => void startPlan('auto', false)}
            disabled={empty}
            loading={loading === 'plan'}
            accessibilityHint="Arma el viaje directo con lo que contaste, sin preguntas"
          />
        </>
      }
    >
      <TextInput
        value={story}
        onChangeText={setStory}
        placeholder="Ej.: Montevideo y Buenos Aires, 8 días…"
        placeholderTextColor={colors.masked}
        style={styles.input}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        accessibilityLabel="Contame el viaje"
      />

      {empty ? (
        <View style={styles.examples}>
          <Text style={styles.label}>Por ejemplo</Text>
          {TELL_EXAMPLES.map((e) => (
            <Pressable
              key={e}
              onPress={() => setStory(e)}
              accessibilityRole="button"
              accessibilityLabel={`Usar ejemplo: ${e}`}
              style={({ pressed }) => [styles.example, pressed && { opacity: 0.75 }]}
            >
              <Text style={styles.exampleText}>“{e}”</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.dates}>
        <Text style={styles.label}>¿Ya tenés fecha de inicio?</Text>
        <View style={styles.chips}>
          <Chip
            label={startDate ? `Desde el ${formatDay(startDate)}` : 'Elegir fecha'}
            selected={!!startDate}
            onPress={() => setShowDates((v) => !v)}
          />
          {startDate ? <Chip label="Sin fecha" onPress={() => setStartDate(null)} /> : null}
        </View>
        {showDates ? (
          <DateRow
            value={startDate}
            onChange={(d) => {
              setStartDate(d);
              if (d) setShowDates(false);
            }}
          />
        ) : null}
      </View>

      {planError ? <InlineError error={planError} doing="arrancar a armar el viaje" /> : null}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 120,
    maxHeight: 240,
    fontSize: font.body,
    lineHeight: 23,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  label: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  examples: { gap: space.sm },
  example: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  exampleText: { fontSize: font.small, color: colors.primary, fontWeight: '600', lineHeight: 21 },
  dates: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
