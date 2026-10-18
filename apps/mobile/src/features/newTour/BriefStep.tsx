// Paso 2 · Lo que entendí: resumen + chips + "lo que tengo en cuenta" + preguntas de tour_interview en rondas (1-4) con
// el default preseleccionado y "Otra cosa…" (texto libre). "Seguir" → repreguntas; "Mostrame recorridos" → variantes.
import type { TourInterviewQuestion, TourInterviewResult } from '@build101/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { ErrorBox, InlineError, StepShell, TextButton } from '../newTrip/parts';
import { Chip } from '../plan/components/Controls';
import { next, requestRound, requestVariants, startTour } from './flow';
import { answerText, isSelected, toggleAnswer, understoodChips, wantsAnotherRound, type AnswerValue } from './model';
import { currentRound, useNewTourStore } from './store';

export function BriefStep() {
  const round = useNewTourStore(currentRound);
  const roundIndex = useNewTourStore((s) => s.roundIndex);
  const answers = useNewTourStore((s) => s.answers);
  const free = useNewTourStore((s) => s.free);
  const setAnswer = useNewTourStore((s) => s.setAnswer);
  const setFree = useNewTourStore((s) => s.setFree);
  const back = useNewTourStore((s) => s.back);
  const loading = useNewTourStore((s) => s.loading);
  const error = useNewTourStore((s) => s.error);
  const more = round ? wantsAnotherRound(round, roundIndex + 1) : false;
  const fallback = { label: 'Armalo igual', onPress: () => void startTour(null).then((ok) => ok && router.back()), loading: loading === 'start' };

  return (
    <StepShell
      step={2}
      title={roundIndex > 0 ? 'Afinemos un poco más' : 'Lo que entendí'}
      onBack={back}
      footer={
        round ? (
          <>
            {more ? <Button label="Seguir" onPress={() => void next()} loading={loading === 'round'} disabled={!!loading} accessibilityHint="Te repregunto sobre lo que contestaste para ir más a fondo" /> : null}
            <TextButton
              label={more ? 'Mostrame recorridos con lo que ya sabés' : 'Mostrame los recorridos'}
              primary={!more}
              onPress={() => void requestVariants()}
              loading={loading === 'variants'}
              disabled={!!loading}
            />
          </>
        ) : null
      }
    >
      {loading === 'brief' && !round ? (
        <View style={styles.loading} accessibilityLabel="Leyendo lo que me contaste">
          <Text style={styles.muted}>Leyendo lo que me contaste y mirando qué hay cerca…</Text>
          <Skeleton height={20} width="90%" />
          <Skeleton height={90} />
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : error.brief && !round ? (
        <ErrorBox message={`${error.brief} Igual te lo puedo armar con lo que me contaste.`} onRetry={() => void requestRound(1)} fallback={fallback} />
      ) : round ? (
        <>
          <Understood r={round} />
          {round.questions.length ? <Text style={styles.roundLabel}>{roundIndex === 0 ? 'Unas preguntas para armarlo a tu medida' : 'Unas repreguntas'}</Text> : null}
          {round.questions.map((q) => (
            <QuestionCard key={`${roundIndex}-${q.id}`} q={q} value={answers[q.id]} free={free[q.id]} onChange={(v) => setAnswer(q.id, v)} onFree={(t) => setFree(q.id, t)} />
          ))}
          {loading === 'round' ? (
            <View style={styles.loading} accessibilityLabel="Pensando unas repreguntas">
              <Text style={styles.muted}>Pensando unas repreguntas con lo que me contestaste…</Text>
              <Skeleton height={110} />
            </View>
          ) : null}
          {error.round ? <ErrorBox message={`${error.round} Podés seguir igual con lo que ya sé.`} onRetry={() => void next()} fallback={{ label: 'Ver recorridos', onPress: () => void requestVariants() }} /> : null}
          {error.start ? <InlineError message={error.start} /> : null}
        </>
      ) : (
        <ErrorBox message="No tengo nada para mostrarte todavía." onRetry={() => void requestRound(1)} fallback={fallback} />
      )}
    </StepShell>
  );
}

function Understood({ r }: { r: TourInterviewResult }) {
  const chips = understoodChips(r.understood);
  return (
    <View style={styles.card}>
      <Text style={styles.summary}>{r.summary}</Text>
      {chips.length ? (
        <View style={styles.chips}>
          {chips.map((c) => (
            <View key={c} style={styles.tag}>
              <Text style={styles.tagText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {r.understood.wishes.length ? <Text style={styles.line}>Querés: {r.understood.wishes.join(' · ')}</Text> : null}
      {r.context.length ? (
        <View style={styles.context}>
          <Text style={styles.contextTitle}>Lo que tengo en cuenta</Text>
          {r.context.map((c) => (
            <Text key={c} style={styles.line}>
              · {c}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function QuestionCard({ q, value, free, onChange, onFree }: { q: TourInterviewQuestion; value: AnswerValue | undefined; free: string | undefined; onChange: (v: AnswerValue) => void; onFree: (t: string) => void }) {
  const [done, setDone] = useState(false);
  const [freeOpen, setFreeOpen] = useState(!!free);
  const summary = answerText(q, value, free);
  if (done && summary) {
    return (
      <Pressable onPress={() => setDone(false)} accessibilityRole="button" accessibilityLabel={`${q.text} ${summary}. Cambiar`} style={({ pressed }) => [styles.card, styles.doneCard, pressed && { opacity: 0.8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.qDone}>{q.text}</Text>
          <Text style={styles.answer}>{summary}</Text>
        </View>
        <Text style={styles.change}>Cambiar</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.q}>
        {q.text}
        {q.optional ? <Text style={styles.optional}> (opcional)</Text> : null}
      </Text>
      {q.why ? <Text style={styles.why}>{q.why}</Text> : null}
      {q.kind === 'text' ? (
        <TextInput style={styles.input} placeholder="Contalo con tus palabras…" placeholderTextColor={colors.masked} value={typeof value === 'string' ? value : ''} onChangeText={onChange} multiline maxLength={400} accessibilityLabel={q.text} />
      ) : (
        <View style={styles.chips}>
          {q.options.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={isSelected(value, o.value)}
              onPress={() => {
                onChange(toggleAnswer(q, value, o.value));
                if (q.kind === 'single' && !freeOpen) setDone(true);
              }}
            />
          ))}
          <Chip label={free?.trim() ? `Otra cosa: ${free.trim()}` : 'Otra cosa…'} selected={!!free?.trim()} onPress={() => setFreeOpen((o) => !o)} />
        </View>
      )}
      {q.kind !== 'text' && freeOpen ? (
        <TextInput style={styles.input} placeholder="Contalo con tus palabras…" placeholderTextColor={colors.masked} value={free ?? ''} onChangeText={onFree} autoFocus={!free} multiline maxLength={400} accessibilityLabel={`${q.text} Otra cosa`} />
      ) : null}
      {summary && (q.kind !== 'single' || freeOpen) ? <Button label="Listo" variant="secondary" onPress={() => setDone(true)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space.sm },
  muted: { fontSize: font.small, color: colors.textMuted },
  roundLabel: { fontSize: font.small, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5, marginTop: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  summary: { fontSize: font.body, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: { backgroundColor: colors.khakiLight, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
  tagText: { fontSize: font.tiny, fontWeight: '700', color: colors.khakiText },
  context: { gap: 2, marginTop: space.xs },
  contextTitle: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  line: { fontSize: font.small, color: colors.text },
  q: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  qDone: { fontSize: font.small, color: colors.textMuted },
  answer: { fontSize: font.body, fontWeight: '700', color: colors.text },
  change: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  optional: { fontSize: font.small, fontWeight: '400', color: colors.textMuted },
  why: { fontSize: font.tiny, color: colors.textMuted, marginTop: -space.xs },
  input: { minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg, padding: space.md, fontSize: font.body, color: colors.text, textAlignVertical: 'top' },
});
