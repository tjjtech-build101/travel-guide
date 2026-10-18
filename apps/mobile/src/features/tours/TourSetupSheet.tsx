// Hoja "Tour acá, ahora" (PRD 06/18 · tour director): duración → la API (tour_brief) mira el contexto del grupo
// y devuelve 0-3 preguntas que de verdad cambian el tour, con defaults. La persona puede armarlo sin tocar nada.
// Estados: cargando (skeleton), error (se puede armar igual, sin preguntas) y listo.
import {
  defaultTourAnswers,
  SCOUT,
  tourAnswersToInput,
  type TourAnswers,
  type TourQuestion,
} from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { describeError, type AppError } from '../../lib/errors';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { Skeleton } from '../../ui/States';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';
import { fetchTourBrief, NEARBY_DURATIONS, startNearbyTour } from './nearbyTour';

const durationLabel = (m: number) => (m === 60 ? '1 hora' : m === 90 ? '1 h 30' : m === 120 ? '2 horas' : `${m} min`);

export function TourSetupSheet({
  visible,
  here,
  tripId,
  onClose,
}: {
  visible: boolean;
  here: { lat: number; lng: number } | null;
  tripId?: string;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState<number>(60);
  const [answers, setAnswers] = useState<TourAnswers>({});
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  // Las coordenadas se redondean para no repetir la consulta por cada metro que te movés.
  const key = here ? [here.lat.toFixed(3), here.lng.toFixed(3)] : null;
  const brief = useQuery({
    queryKey: ['tour_brief', key, duration, tripId ?? null],
    enabled: visible && !!here,
    staleTime: 5 * 60_000,
    queryFn: () => fetchTourBrief({ lat: here!.lat, lng: here!.lng, duration_min: duration, trip_id: tripId }),
  });

  // Defaults de las preguntas nuevas, sin pisar lo que la persona ya eligió.
  useEffect(() => {
    if (!brief.data) return;
    setAnswers((prev) => ({ ...defaultTourAnswers(brief.data.questions), ...(touched ? prev : {}) }));
  }, [brief.data, touched]);

  useEffect(() => {
    if (!visible) {
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const setAnswer = (q: TourQuestion, value: string) => {
    setTouched(true);
    setAnswers((prev) => {
      if (q.kind !== 'multi') return { ...prev, [q.id]: value };
      const cur = Array.isArray(prev[q.id]) ? (prev[q.id] as string[]) : [];
      // "No van chicos" excluye a las edades (y al revés).
      let next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      if (value === 'none') next = next.includes('none') ? ['none'] : [];
      else next = next.filter((v) => v !== 'none');
      return { ...prev, [q.id]: next };
    });
  };

  const submit = async () => {
    if (!here) return;
    setSubmitting(true);
    setError(null);
    const res = await startNearbyTour({ lat: here.lat, lng: here.lng, trip_id: tripId, duration_min: duration, ...tourAnswersToInput(answers) });
    setSubmitting(false);
    if (res.ok) onClose();
    else setError(res.error);
  };

  const questions = brief.data?.questions ?? [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.head}>
          <ScoutAvatar size={44} state={brief.isFetching ? 'thinking' : 'idle'} />
          <View style={styles.flex}>
            <Text style={styles.kicker}>TOUR ACÁ, AHORA</Text>
            <Text style={styles.title}>Te armo un recorrido</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>¿Cuánto tiempo tenés?</Text>
          <View style={styles.chips}>
            {NEARBY_DURATIONS.map((m) => (
              <Chip key={m} label={durationLabel(m)} selected={duration === m} onPress={() => setDuration(m)} />
            ))}
          </View>

          {!here ? (
            <Text style={styles.muted}>Necesito tu ubicación para armar el tour desde donde estás.</Text>
          ) : brief.isPending ? (
            <View style={styles.loading} accessibilityLabel="Cargando">
              <Skeleton height={18} width="85%" />
              <Skeleton height={16} width="60%" />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </View>
          ) : brief.isError ? (
            // No bloquea (se arma igual), pero se dice por qué: si es "sin créditos", el armado también va a fallar.
            <Text style={styles.muted}>
              No pude leer tu contexto ahora ({describeError(brief.error).title}). Te lo armo igual con tu perfil.
            </Text>
          ) : (
            <>
              <Text style={styles.summary}>{brief.data.summary}</Text>
              {brief.data.context.length ? (
                <View style={styles.context}>
                  <Text style={styles.contextTitle}>Lo que tengo en cuenta</Text>
                  {brief.data.context.map((c) => (
                    <Text key={c} style={styles.contextLine}>
                      · {c}
                    </Text>
                  ))}
                </View>
              ) : null}

              {questions.map((q) => (
                <View key={q.id} style={styles.question}>
                  <Text style={styles.section}>{q.text}</Text>
                  <Text style={styles.why}>{q.why}</Text>
                  {q.kind === 'text' ? (
                    <TextInput
                      style={styles.input}
                      placeholder="Ej.: el Mercado del Puerto"
                      placeholderTextColor={colors.textMuted}
                      value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                      onChangeText={(t) => {
                        setTouched(true);
                        setAnswers((prev) => ({ ...prev, [q.id]: t }));
                      }}
                      returnKeyType="done"
                      accessibilityLabel={q.text}
                    />
                  ) : (
                    <View style={styles.chips}>
                      {q.options.map((o) => {
                        const v = answers[q.id];
                        const selected = Array.isArray(v) ? v.includes(o.value) : v === o.value;
                        return <Chip key={o.value} label={o.label} selected={selected} onPress={() => setAnswer(q, o.value)} />;
                      })}
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
          {error ? <ErrorNotice error={error} doing="armar el tour" onRetry={() => void submit()} retrying={submitting} /> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button label={`Armar tour de ${durationLabel(duration)}`} onPress={() => void submit()} loading={submitting} disabled={!here || submitting} />
          <Button label="Cancelar" variant="ghost" onPress={onClose} />
          <Text style={styles.fine}>{SCOUT.name} investiga y verifica cada dato con su fuente: tarda un par de minutos.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingBottom: space.sm },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.scout },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  section: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  why: { fontSize: font.tiny, color: colors.textMuted, marginTop: -space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  loading: { gap: space.sm, marginTop: space.sm },
  summary: { fontSize: font.body, color: colors.text, marginTop: space.sm },
  context: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: 2, borderWidth: 1, borderColor: colors.border },
  contextTitle: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginBottom: space.xs },
  contextLine: { fontSize: font.small, color: colors.text },
  question: { gap: space.sm, marginTop: space.sm },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    fontSize: font.body,
    color: colors.text,
  },
  muted: { fontSize: font.small, color: colors.textMuted, marginTop: space.sm },
  footer: { padding: space.lg, gap: space.xs, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  fine: { fontSize: font.tiny, color: colors.textMuted, textAlign: 'center' },
});
