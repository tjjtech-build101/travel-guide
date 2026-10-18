// Paso 1 · Contame: texto libre + frases de ejemplo + fechas (calendario con rango opcional) + "¿Cuántos días?".
// "Seguir" → trip_brief; "Armalo ya" → plan_trip auto.
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { shortDay, todayIso } from './calendarModel';
import { CalendarSheet } from './Calendar';
import { requestBrief, startPlan } from './flow';
import { TELL_EXAMPLES, TELL_PROMPT } from './model';
import { Bubble, DaysStepper, InlineError, StepShell } from './parts';
import { useNewTripStore } from './store';

export function TellStep() {
  const story = useNewTripStore((s) => s.story);
  const startDate = useNewTripStore((s) => s.startDate);
  const setStory = useNewTripStore((s) => s.setStory);
  const endDate = useNewTripStore((s) => s.endDate);
  const days = useNewTripStore((s) => s.days);
  const setDates = useNewTripStore((s) => s.setDates);
  const setDays = useNewTripStore((s) => s.setDays);
  const loading = useNewTripStore((s) => s.loading);
  const planError = useNewTripStore((s) => s.error.plan);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const today = todayIso();
  const dateLabel = startDate
    ? endDate
      ? `${shortDay(startDate, today)} → ${shortDay(endDate, today)}`
      : `Desde el ${shortDay(startDate, today)}`
    : 'Elegir en el calendario';
  const empty = !story.trim();

  return (
    <StepShell
      step={1}
      title="Contame"
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
      <Bubble text={TELL_PROMPT} />

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
        <Text style={styles.label}>¿Cuándo pensás ir? (opcional)</Text>
        <View style={styles.chips}>
          <Chip
            label={dateLabel}
            selected={!!startDate}
            onPress={() => setCalendarOpen(true)}
            accessibilityLabel={startDate ? `Fechas: ${dateLabel}. Cambiar` : 'Elegir fechas en el calendario'}
          />
          {startDate ? <Chip label="Sin fecha" onPress={() => setDates(null, null)} /> : null}
        </View>
        {!startDate ? <Text style={styles.hint}>En el calendario tocás la llegada y, si ya la sabés, la vuelta.</Text> : null}
      </View>

      <View style={styles.dates}>
        <Text style={styles.label}>¿Cuántos días? (opcional)</Text>
        {days ? (
          <View style={styles.daysRow}>
            <DaysStepper value={days} onChange={setDays} label={startDate && endDate ? `Del ${shortDay(startDate, today)} al ${shortDay(endDate, today)}` : undefined} />
            <Chip label="Todavía no sé" onPress={() => setDays(null)} />
          </View>
        ) : (
          <View style={styles.chips}>
            <Chip label="Elegir cuántos días" onPress={() => setDays(7)} accessibilityLabel="Elegir cuántos días, arranca en 7" />
          </View>
        )}
      </View>

      <CalendarSheet
        visible={calendarOpen}
        value={{ start: startDate, end: endDate }}
        onClose={() => setCalendarOpen(false)}
        onDone={(r) => {
          setDates(r.start, r.end);
          setCalendarOpen(false);
        }}
      />

      {planError ? <InlineError message={`${planError} Probá de nuevo.`} /> : null}
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
  hint: { fontSize: font.tiny, color: colors.textMuted },
  daysRow: { gap: space.sm, alignItems: 'flex-start' },
});
