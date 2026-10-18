// Paso 1 · Contame: texto libre + ejemplos + cuánto tiempo. "Seguir" → entrevista; "Armalo ya" → tour directo.
import { router } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { Bubble, InlineError, StepShell } from '../newTrip/parts';
import { Chip } from '../plan/components/Controls';
import { requestRound, startTour } from './flow';
import { durationLabel, TELL_EXAMPLES, TELL_PROMPT, TOUR_DURATIONS } from './model';
import { useNewTourStore } from './store';

export function TellStep() {
  const story = useNewTourStore((s) => s.story);
  const setStory = useNewTourStore((s) => s.setStory);
  const durationMin = useNewTourStore((s) => s.durationMin);
  const setDuration = useNewTourStore((s) => s.setDuration);
  const loading = useNewTourStore((s) => s.loading);
  const error = useNewTourStore((s) => s.error);
  const here = useNewTourStore((s) => s.here);
  const empty = !story.trim();

  return (
    <StepShell
      step={1}
      title="Contame"
      footer={
        <>
          <Button label="Seguir" onPress={() => void requestRound(1)} disabled={!here} loading={loading === 'brief'} accessibilityHint="Te hago unas preguntas para armar el tour a tu medida" />
          <Button
            label="Armalo ya"
            variant="ghost"
            onPress={() => void startTour(null).then((ok) => ok && router.back())}
            disabled={!here}
            loading={loading === 'start'}
            accessibilityHint="Arma el tour directo con lo que contaste, sin preguntas"
          />
        </>
      }
    >
      <Bubble text={TELL_PROMPT} />
      <TextInput
        value={story}
        onChangeText={setStory}
        placeholder="Ej.: historias del barrio y no me quiero perder…"
        placeholderTextColor={colors.masked}
        style={styles.input}
        multiline
        maxLength={1500}
        textAlignVertical="top"
        accessibilityLabel="Contame qué tour querés"
      />
      {empty ? (
        <View style={styles.examples}>
          <Text style={styles.label}>Por ejemplo</Text>
          {TELL_EXAMPLES.map((e) => (
            <Pressable key={e} onPress={() => setStory(e)} accessibilityRole="button" accessibilityLabel={`Usar ejemplo: ${e}`} style={({ pressed }) => [styles.example, pressed && { opacity: 0.75 }]}>
              <Text style={styles.exampleText}>“{e}”</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.block}>
        <Text style={styles.label}>¿Cuánto tiempo tenés?</Text>
        <View style={styles.chips}>
          {TOUR_DURATIONS.map((m) => (
            <Chip key={m} label={durationLabel(m)} selected={durationMin === m} onPress={() => setDuration(m)} />
          ))}
          <Chip label="Todavía no sé" selected={durationMin == null} onPress={() => setDuration(null)} />
        </View>
      </View>
      {!here ? <InlineError message="Necesito tu ubicación para armar el tour desde donde estás. Activala y volvé a entrar." /> : null}
      {error.brief ? <InlineError message={error.brief} /> : null}
      {error.start ? <InlineError message={error.start} /> : null}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: space.md, fontSize: font.body, color: colors.text },
  examples: { gap: space.xs },
  label: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  example: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md },
  exampleText: { fontSize: font.small, color: colors.text },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
