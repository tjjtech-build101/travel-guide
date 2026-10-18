// Paso 2 · Lo que entendí: resumen + "lo que tengo en cuenta" + preguntas de trip_brief con el default
// preseleccionado (patrón de TourSetupSheet). "Seguir" → trip_shapes; "Saltar preguntas" usa los defaults.
import type { TripBriefResult, TripQuestion } from '@build101/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { formatDateRange } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { requestBrief, requestShapes, startPlan } from './flow';
import { answerText, defaultAnswers, isAnswered, toggleAnswer, type AnswerValue } from './model';
import { DateRow, ErrorBox, InlineError, StepShell } from './parts';
import { useNewTripStore } from './store';

const PARTY: Record<string, string> = { solo: 'Solo', couple: 'En pareja', friends: 'Con amigos', family: 'En familia' };

export function BriefStep() {
  const brief = useNewTripStore((s) => s.brief);
  const answers = useNewTripStore((s) => s.answers);
  const setAnswer = useNewTripStore((s) => s.setAnswer);
  const setAnswers = useNewTripStore((s) => s.setAnswers);
  const back = useNewTripStore((s) => s.back);
  const loading = useNewTripStore((s) => s.loading);
  const error = useNewTripStore((s) => s.error);

  // Volvió de un cierre de la app a mitad de la carga: se pide de nuevo.
  useEffect(() => {
    const s = useNewTripStore.getState();
    if (!s.brief && !s.loading && !s.error.brief) void requestBrief();
  }, []);

  const fallback = { label: 'Armalo igual', onPress: () => void startPlan('auto', false), loading: loading === 'plan' };
  const ready = brief?.ready !== false;

  return (
    <StepShell
      step={2}
      title="Lo que entendí"
      onBack={back}
      scout={
        loading === 'brief' && !brief
          ? { text: 'Leyendo lo que me contaste…', mode: 'thinking' }
          : error.brief && !brief
            ? { text: 'Uy, se me trabó. Probemos de nuevo.', mode: 'error' }
            : brief && !ready
              ? { text: 'Me falta saber al menos a dónde van. Contame un poco más.', pose: 'think' }
              : loading === 'shapes'
                ? { text: 'Pensando formas de armarlo…', mode: 'thinking' }
                : brief?.questions.length
                  ? { text: 'Esto es lo que entendí. Te dejo un par de preguntas: ya marqué lo que te sugiero.', pose: 'pointRight' }
                  : { text: 'Esto es lo que entendí. Si está bien, seguimos.', pose: 'thumbs' }
      }
      footer={
        brief && ready ? (
          <>
            <Button label="Seguir" onPress={() => void requestShapes()} loading={loading === 'shapes'} />
            {brief.questions.length ? (
              <Button
                label="Saltar preguntas"
                variant="ghost"
                onPress={() => {
                  setAnswers(defaultAnswers(brief.questions));
                  void requestShapes();
                }}
                accessibilityHint="Sigue con las respuestas sugeridas"
              />
            ) : null}
          </>
        ) : brief ? (
          <Button label="Contame más" onPress={back} />
        ) : null
      }
    >
      {loading === 'brief' && !brief ? (
        <View style={styles.loading} accessibilityLabel="Leyendo lo que me contaste">
          <Skeleton height={20} width="90%" />
          <Skeleton height={20} width="70%" />
          <Skeleton height={90} />
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : error.brief && !brief ? (
        <ErrorBox error={error.brief} doing="entender el viaje" onRetry={() => void requestBrief(true)} retrying={loading === 'brief'} fallback={fallback} />
      ) : brief ? (
        <>
          <Understood brief={brief} />
          {!ready ? (
            <Text style={styles.warn}>Me falta saber al menos a dónde van. Contame un poco más y seguimos.</Text>
          ) : null}
          {brief.questions.map((q) => (
            <QuestionCard key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          ))}
          {error.shapes ? <InlineError error={error.shapes} doing="pensar las formas del viaje" /> : null}
          {error.plan ? <InlineError error={error.plan} doing="arrancar a armar el viaje" /> : null}
        </>
      ) : (
        <ErrorBox message="No tengo nada para mostrarte todavía." onRetry={() => void requestBrief(true)} fallback={fallback} />
      )}
    </StepShell>
  );
}

function Understood({ brief }: { brief: TripBriefResult }) {
  const u = brief.understood;
  const chips: string[] = [
    ...u.destinations.map((d) => d.city),
    ...(u.start_date || u.end_date ? [formatDateRange(u.start_date, u.end_date)] : []),
    ...(u.days ? [`${u.days} días`] : []),
    ...(u.travelers ? [`${u.travelers} ${u.travelers === 1 ? 'viajero' : 'viajeros'}`] : u.party ? [PARTY[u.party] ?? ''] : []),
  ].filter(Boolean);
  return (
    <View style={styles.card}>
      <Text style={styles.summary}>{brief.summary}</Text>
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((c) => (
            <View key={c} style={styles.tag}>
              <Text style={styles.tagText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {brief.context.length ? (
        <View style={styles.context}>
          <Text style={styles.contextTitle}>Lo que tengo en cuenta</Text>
          {brief.context.map((c) => (
            <Text key={c} style={styles.contextLine}>
              · {c}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function QuestionCard({ q, value, onChange }: { q: TripQuestion; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  const [done, setDone] = useState(false);
  const summary = answerText(q, value);

  if (done && summary) {
    return (
      <Pressable
        onPress={() => setDone(false)}
        accessibilityRole="button"
        accessibilityLabel={`${q.text} ${summary}. Cambiar`}
        style={({ pressed }) => [styles.card, styles.doneCard, pressed && { opacity: 0.8 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.qDone}>{q.text}</Text>
          <Text style={styles.answer}>{summary}</Text>
        </View>
        <Text style={styles.change}>Cambiar</Text>
      </Pressable>
    );
  }

  const pick = (v: string) => {
    const next = toggleAnswer(q, value, v);
    onChange(next);
    if (q.kind === 'single') setDone(true);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.q}>
        {q.text}
        {q.optional ? <Text style={styles.optional}> (opcional)</Text> : null}
      </Text>
      {q.why ? <Text style={styles.why}>{q.why}</Text> : null}

      {q.kind === 'text' ? (
        <TextInput
          style={styles.input}
          placeholder="Escribí acá…"
          placeholderTextColor={colors.masked}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          multiline
          maxLength={400}
          accessibilityLabel={q.text}
        />
      ) : q.kind === 'date' ? (
        <>
          {q.options.length ? <Options q={q} value={value} onPick={pick} /> : null}
          <DateRow
            value={typeof value === 'string' && /^\d{4}-/.test(value) ? value : null}
            onChange={(d) => {
              onChange(d ?? '');
              if (d) setDone(true);
            }}
          />
        </>
      ) : (
        <Options q={q} value={value} onPick={pick} />
      )}

      {(q.kind === 'multi' || q.kind === 'text') && isAnswered(value) ? (
        <Button label="Listo" variant="secondary" onPress={() => setDone(true)} style={styles.listo} />
      ) : null}
    </View>
  );
}

function Options({ q, value, onPick }: { q: TripQuestion; value: AnswerValue | undefined; onPick: (v: string) => void }) {
  return (
    <View style={styles.chips}>
      {q.options.map((o) => {
        const selected = Array.isArray(value) ? value.includes(o.value) : value === o.value;
        return <Chip key={o.value} label={o.label} selected={selected} onPress={() => onPick(o.value)} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.sm },
  warn: { fontSize: font.small, color: colors.bronzeText, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  summary: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: { backgroundColor: colors.khakiLight, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  tagText: { fontSize: font.tiny, fontWeight: '700', color: colors.khakiText },
  context: { gap: 2, marginTop: space.xs },
  contextTitle: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginBottom: space.xs },
  contextLine: { fontSize: font.small, color: colors.text, lineHeight: 21 },
  q: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  qDone: { fontSize: font.small, color: colors.textMuted },
  answer: { fontSize: font.body, fontWeight: '700', color: colors.text },
  change: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  optional: { fontSize: font.small, fontWeight: '400', color: colors.textMuted },
  why: { fontSize: font.tiny, color: colors.textMuted, marginTop: -space.xs },
  input: {
    minHeight: MIN_TOUCH,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.text,
  },
  listo: { alignSelf: 'flex-start' },
});
