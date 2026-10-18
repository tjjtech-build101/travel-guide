// Paso 2 · Lo que entendí: resumen + tipo de viaje + anclas + "qué tan bien te conozco" + preguntas de
// trip_brief en rondas (1-4) con el default preseleccionado. Cada pregunta suma "Otra cosa…" (texto libre), las de
// fecha abren el calendario y las de duración, "Otra cantidad". "Seguir" → ronda siguiente (repreguntas);
// "Pasemos a las opciones con lo que ya sabés" (siempre visible) → formas. Atrás vuelve de ronda sin perder respuestas.
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
import { daysInclusive, daysLabel, decodeRange, encodeRange, shortDay, todayIso } from './calendarModel';
import { CalendarSheet } from './Calendar';
import {
  answerText,
  coverageSummary,
  daysOf,
  freeTextOf,
  isAnswered,
  isDurationQuestion,
  isSelected,
  roundLabel,
  roundQuestions,
  setDays,
  setFreeText,
  toggleAnswer,
  TRIP_KIND_LABEL,
  wantsAnotherRound,
  withDateAnswer,
  type AnswerValue,
} from './model';
import { AnchorCard, DaysStepper, ErrorBox, InlineError, StepShell, TextButton } from './parts';
import { currentBrief, useNewTripStore } from './store';

const PARTY: Record<string, string> = { solo: 'Solo', couple: 'En pareja', friends: 'Con amigos', family: 'En familia' };

export function BriefStep() {
  const brief = useNewTripStore(currentBrief);
  const roundIndex = useNewTripStore((s) => s.roundIndex);
  const answers = useNewTripStore((s) => s.answers);
  const setAnswer = useNewTripStore((s) => s.setAnswer);
  const setAnswers = useNewTripStore((s) => s.setAnswers);
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
  const SKIP = 'Pasemos a las opciones con lo que ya sabés';
  // Un rango del calendario completa solo las preguntas de duración (de esta ronda y las anteriores).
  const answerDate = (qid: string, v: string) => {
    const s = useNewTripStore.getState();
    const qs = roundQuestions(s.rounds, s.roundIndex);
    const q = qs.find((x) => x.id === qid);
    if (q) setAnswers(withDateAnswer(qs, s.answers, q, v));
  };

  return (
    <StepShell
      step={2}
      title={round > 1 ? 'Afinemos un poco más' : 'Lo que entendí'}
      onBack={back}
      scout={
        loading === 'brief' && !brief
          ? { text: 'Leyendo lo que me contaste…', mode: 'thinking' }
          : error.brief && !brief
            ? { text: 'Uy, se me trabó. Probemos de nuevo.', mode: 'error' }
            : brief && !ready
              ? { text: 'Me falta saber al menos a dónde van. Contame un poco más.', pose: 'think' }
              : loading === 'round'
                ? { text: 'Pensando unas preguntas más con lo que me contestaste…', mode: 'thinking' }
                : loading === 'shapes'
                  ? { text: 'Pensando formas de armarlo…', mode: 'thinking' }
                  : brief?.questions.length
                    ? { text: 'Esto es lo que entendí. Te dejo un par de preguntas: ya marqué lo que te sugiero.', pose: 'pointRight' }
                    : { text: 'Esto es lo que entendí. Si está bien, seguimos.', pose: 'thumbs' }
      }
      footer={
        brief && ready ? (
          <>
            {more ? (
              <Button
                label="Seguir"
                onPress={() => void requestNextRound()}
                loading={loading === 'round'}
                disabled={busy}
                accessibilityHint="Te hago unas repreguntas sobre lo que me contestaste para ir más a fondo"
              />
            ) : null}
            <TextButton
              label={SKIP}
              primary={!more}
              onPress={() => void finishInterview()}
              loading={loading === 'shapes'}
              disabled={loading === 'shapes'}
              accessibilityHint="Te muestro las formas de armar el viaje con lo que ya me contaste, sin más preguntas"
            />
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
              {roundLabel(round)}
            </Text>
          ) : null}
          {brief.questions.map((q) => (
            <QuestionCard
              key={`${round}-${q.id}`}
              q={q}
              value={answers[q.id]}
              onChange={(v) => setAnswer(q.id, v)}
              onDate={(v) => answerDate(q.id, v)}
            />
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
              fallback={{ label: 'Ver opciones', onPress: () => void finishInterview(), loading: loading === 'shapes' }}
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

function QuestionCard({
  q,
  value,
  onChange,
  onDate,
}: {
  q: TripQuestion;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  /** Respuesta del calendario (completa sola la duración si es un rango). */
  onDate: (v: string) => void;
}) {
  const [done, setDone] = useState(false);
  const free = freeTextOf(value);
  const [freeOpen, setFreeOpen] = useState(free != null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const summary = answerText(q, value);
  const duration = isDurationQuestion(q);
  const canFree = q.kind !== 'text';

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
    onChange(toggleAnswer(q, value, v));
    if (q.kind !== 'multi') {
      setFreeOpen(false);
      setDone(true);
    }
  };
  const range = q.kind === 'date' ? currentRange(value) : null;
  const today = todayIso();
  // "Otra cantidad": la elegida a mano, si no la del calendario, si no un número de la opción elegida, si no 7.
  const manualDays = daysOf(value);
  const stepperDays = manualDays ?? guessDays(q, value) ?? 7;

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
      ) : (
        <View style={styles.chips}>
          {q.options.map((o) => (
            <Chip key={o.value} label={o.label} selected={isSelected(value, o.value)} onPress={() => pick(o.value)} />
          ))}
          {q.kind === 'date' ? (
            <Chip
              label={range?.start ? rangeChip(range, today) : 'Elegir en el calendario'}
              selected={!!range?.start}
              onPress={() => setCalendarOpen(true)}
              accessibilityLabel={range?.start ? `Fechas: ${rangeChip(range, today)}. Cambiar en el calendario` : 'Elegir en el calendario'}
            />
          ) : null}
          {canFree ? (
            <Chip
              label={free?.trim() ? `Otra cosa: ${free.trim()}` : 'Otra cosa…'}
              selected={!!free?.trim()}
              onPress={() => setFreeOpen((o) => !o)}
              accessibilityLabel={free?.trim() ? `Otra cosa: ${free.trim()}. Editar` : 'Otra cosa: escribir lo que quieras'}
            />
          ) : null}
        </View>
      )}

      {duration ? (
        <DaysStepper label="Otra cantidad" value={stepperDays} selected={manualDays != null} onChange={(n) => onChange(setDays(q, value, n))} />
      ) : null}

      {canFree && freeOpen ? (
        <TextInput
          style={styles.input}
          placeholder={q.kind === 'multi' ? 'Sumá lo que quieras…' : 'Contalo con tus palabras…'}
          placeholderTextColor={colors.masked}
          value={free ?? ''}
          onChangeText={(t) => onChange(setFreeText(q, value, t))}
          autoFocus={free == null}
          multiline
          maxLength={400}
          accessibilityLabel={`${q.text} Otra cosa`}
        />
      ) : null}

      {isAnswered(value) && (q.kind !== 'single' || freeOpen || duration) ? (
        <Button label="Listo" variant="secondary" onPress={() => setDone(true)} style={styles.listo} />
      ) : null}

      {q.kind === 'date' ? (
        <CalendarSheet
          visible={calendarOpen}
          title={q.text}
          value={range ?? { start: null, end: null }}
          onClose={() => setCalendarOpen(false)}
          onDone={(r) => {
            setCalendarOpen(false);
            onDate(encodeRange(r));
            if (r.start) {
              setFreeOpen(false);
              setDone(true);
            }
          }}
        />
      ) : null}
    </View>
  );
}

function currentRange(v: AnswerValue | undefined) {
  return decodeRange(Array.isArray(v) ? v[0] : v);
}

function rangeChip(r: { start: string | null; end: string | null }, today: string): string {
  if (!r.start) return '';
  return r.end ? `${shortDay(r.start, today)} → ${shortDay(r.end, today)} · ${daysLabel(daysInclusive(r.start, r.end))}` : shortDay(r.start, today);
}

/** Un número en el label de la opción elegida ("Una semana" no, "10 días" sí) para arrancar el contador ahí. */
function guessDays(q: TripQuestion, v: AnswerValue | undefined): number | null {
  const picked = q.options.find((o) => isSelected(v, o.value));
  const n = picked ? Number(/\d+/.exec(picked.label)?.[0]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : null;
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
