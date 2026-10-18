// Paso 2 · Lo que entendí: resumen + tipo de viaje + anclas + "qué tan bien te conozco" + preguntas de
// trip_brief en rondas (1-3) con el default preseleccionado. "Seguir" → ronda siguiente (o formas si ya está);
// "Ya está, armalo" → formas con lo que haya. Atrás vuelve de ronda sin perder respuestas.
import type { TripBriefResult, TripQuestion } from '@build101/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { formatDateRange } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { finishInterview, requestBrief, requestNextRound, startPlan } from './flow';
import { answerText, coverageSummary, isAnswered, roundLabel, toggleAnswer, TRIP_KIND_LABEL, wantsAnotherRound, type AnswerValue } from './model';
import { AnchorCard, DateRow, ErrorBox, InlineError, StepShell } from './parts';
import { currentBrief, useNewTripStore } from './store';

const PARTY: Record<string, string> = { solo: 'Solo', couple: 'En pareja', friends: 'Con amigos', family: 'En familia' };

export function BriefStep() {
  const brief = useNewTripStore(currentBrief);
  const roundIndex = useNewTripStore((s) => s.roundIndex);
  const answers = useNewTripStore((s) => s.answers);
  const setAnswer = useNewTripStore((s) => s.setAnswer);
  const back = useNewTripStore((s) => s.back);
  const loading = useNewTripStore((s) => s.loading);
  const error = useNewTripStore((s) => s.error);

  // Volvió de un cierre de la app a mitad de la carga: se pide de nuevo.
  useEffect(() => {
    const s = useNewTripStore.getState();
    if (!s.rounds.length && !s.loading && !s.error.brief) void requestBrief();
  }, []);

  const fallback = { label: 'Armalo igual', onPress: () => void startPlan('auto', false), loading: loading === 'plan' };
  const ready = brief?.ready !== false;
  const round = roundIndex + 1;
  const more = brief ? wantsAnotherRound(brief, round) : false;
  const busy = loading === 'round' || loading === 'shapes';

  return (
    <StepShell
      step={2}
      title={round > 1 ? 'Afinemos un poco más' : 'Lo que entendí'}
      onBack={back}
      footer={
        brief && ready ? (
          <>
            <Button
              label={more ? 'Seguir' : 'Ver formas del viaje'}
              onPress={() => void requestNextRound()}
              loading={more ? loading === 'round' : loading === 'shapes'}
              disabled={busy}
              accessibilityHint={more ? 'Te hago unas preguntas más para afinar' : 'Te muestro formas de armar el viaje'}
            />
            {more ? (
              <Button
                label="Ya está, armalo"
                variant="ghost"
                onPress={() => void finishInterview()}
                loading={loading === 'shapes'}
                disabled={busy}
                accessibilityHint="Sigue a las formas del viaje con lo que ya me contaste"
              />
            ) : null}
          </>
        ) : brief ? (
          <Button label="Contame más" onPress={() => useNewTripStore.getState().setPhase('tell')} />
        ) : null
      }
    >
      {loading === 'brief' && !brief ? (
        <View style={styles.loading} accessibilityLabel="Leyendo lo que me contaste">
          <Text style={styles.muted}>Leyendo lo que me contaste…</Text>
          <Skeleton height={20} width="90%" />
          <Skeleton height={20} width="70%" />
          <Skeleton height={90} />
          <Skeleton height={110} />
          <Skeleton height={110} />
        </View>
      ) : error.brief && !brief ? (
        <ErrorBox message={`${error.brief} Igual te lo puedo armar con lo que me contaste.`} onRetry={() => void requestBrief(true)} fallback={fallback} />
      ) : brief ? (
        <>
          <Understood brief={brief} />
          {!ready ? (
            <Text style={styles.warn}>Me falta saber al menos a dónde van. Contame un poco más y seguimos.</Text>
          ) : null}
          {brief.questions.length ? (
            <Text style={styles.roundLabel} accessibilityRole="text">
              {roundLabel(round, brief)}
            </Text>
          ) : null}
          {brief.questions.map((q) => (
            <QuestionCard key={`${round}-${q.id}`} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          ))}
          {loading === 'round' ? (
            <View style={styles.loading} accessibilityLabel="Pensando unas preguntas más">
              <Text style={styles.muted}>Pensando unas preguntas más con lo que me contestaste…</Text>
              <Skeleton height={110} />
              <Skeleton height={110} />
            </View>
          ) : null}
          {error.round ? (
            <ErrorBox
              message={`${error.round} Podés seguir igual con lo que ya sé.`}
              onRetry={() => void requestNextRound(true)}
              fallback={{ label: 'Ya está, armalo', onPress: () => void finishInterview(), loading: loading === 'shapes' }}
            />
          ) : null}
          {error.shapes ? <InlineError message={error.shapes} /> : null}
          {error.plan ? <InlineError message={`${error.plan} Probá de nuevo.`} /> : null}
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
    ...(u.origin ? [`Desde ${u.origin}`] : []),
  ].filter(Boolean);
  const kind = u.trip_kind ? TRIP_KIND_LABEL[u.trip_kind] : null;
  const anchors = u.anchors ?? [];
  return (
    <View style={styles.card}>
      {kind ? (
        <View style={styles.kind}>
          <Text style={styles.kindText}>{kind}</Text>
        </View>
      ) : null}
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
      {anchors.length ? (
        <View style={styles.anchors}>
          <Text style={styles.contextTitle}>Lo que manda en el viaje</Text>
          {anchors.map((a) => (
            <AnchorCard key={a.id} anchor={a} compact />
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
      <Coverage coverage={brief.coverage} />
    </View>
  );
}

/** "Qué tan bien te conozco": barrita + Sé / Supongo / Me falta. */
function Coverage({ coverage }: { coverage: TripBriefResult['coverage'] }) {
  const c = coverageSummary(coverage);
  if (!c) return null;
  const pct = Math.round(c.score * 100);
  const lines = [
    c.known.length ? `Sé: ${c.known.join(', ')}` : null,
    c.assumed.length ? `Supongo: ${c.assumed.join(', ')}` : null,
    c.missing.length ? `Me falta: ${c.missing.join(', ')}` : null,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.coverage} accessible accessibilityLabel={`Qué tan bien te conozco: ${pct} por ciento. ${lines.join('. ')}`}>
      <View style={styles.coverageHead}>
        <Text style={styles.contextTitle}>Qué tan bien te conozco</Text>
        <Text style={styles.coveragePct}>{pct}%</Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.max(4, pct)}%` }]} />
      </View>
      {lines.map((l) => (
        <Text key={l} style={styles.coverageLine}>
          {l}
        </Text>
      ))}
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
  muted: { fontSize: font.small, color: colors.textMuted },
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
  roundLabel: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.5, color: colors.textMuted, marginTop: space.xs },
  kind: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  kindText: { fontSize: font.tiny, fontWeight: '800', color: colors.primaryText },
  anchors: { gap: space.sm, marginTop: space.xs },
  coverage: { gap: 4, marginTop: space.xs, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  coverageHead: { flexDirection: 'row', alignItems: 'center' },
  coveragePct: { marginLeft: 'auto', fontSize: font.tiny, fontWeight: '800', color: colors.textMuted },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
  coverageLine: { fontSize: font.tiny, color: colors.textMuted, lineHeight: 18 },
});
