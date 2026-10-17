// "Nuevo viaje" (PRD 01): chat de texto guiado → plan_trip → progreso en vivo → viaje armado.
import type { PlanTripStart } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgentJobProgress } from '../../../features/jobs/AgentJobProgress';
import { LiveItinerary } from '../../../features/jobs/LiveItinerary';
import { conversationFor, STEPS, useNewTripStore, type ChatMessage } from '../../../features/newTrip/store';
import { tripKeys } from '../../../features/trips/keys';
import { useTrip, useTripLegs } from '../../../features/trips/queries';
import { callTool } from '../../../lib/api';
import { formatDay } from '../../../lib/format';
import { useTripRealtime } from '../../../realtime/useTripRealtime';
import { Button } from '../../../ui/Button';
import { Text } from '../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';

let demoConsumed = false;

/** Respuestas del viaje de prueba (deep link de dev build101:///trips/new?demo=1). */
const DEMO_ANSWERS = [
  'Montevideo y Colonia del Sacramento',
  '4 días',
  'Con amigos, somos 3, nadie se separa',
  'Comida, Historia, Caminar',
  'Sí o sí el Mercado del Puerto, ni loco boliche',
];

export default function NewTripScreen() {
  const job = useNewTripStore((s) => s.job);
  const setJob = useNewTripStore((s) => s.setJob);
  // build101:///trips/new?job_id=…&trip_id=… → retomar el progreso de un job (ej. desde una notificación).
  const params = useLocalSearchParams<{ job_id?: string; trip_id?: string }>();
  useEffect(() => {
    if (params.job_id && params.trip_id && job?.job_id !== params.job_id) setJob({ job_id: params.job_id, trip_id: params.trip_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.job_id, params.trip_id]);
  return (
    <>
      <Stack.Screen options={{ title: 'Nuevo viaje', headerBackButtonDisplayMode: 'minimal' }} />
      {job ? <Building job={job} /> : <Chat />}
    </>
  );
}

// ───────────────────────── Chat guiado

function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Chat() {
  const qc = useQueryClient();
  const { messages, step, startDate, interests, answer, setStartDate, toggleInterest, startError, clearError, setJob } = useNewTripStore();
  const [text, setText] = useState('');
  const [starting, setStarting] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const current = STEPS[step];
  const hasError = messages.some((m) => m.error);
  const canBuild = step >= 1; // el mínimo es un destino

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, step]);

  const send = useCallback(
    (raw: string) => {
      let value = raw.trim();
      if (current?.multi) value = [...interests, ...(value ? [value] : [])].join(', ');
      if (current?.datePicker && startDate) value = `Desde el ${formatDay(startDate)}${value ? `, ${value}` : ''}`;
      if (!value) return;
      answer(value);
      setText('');
      setShowDates(false);
    },
    [answer, current, interests, startDate],
  );

  const build = useCallback(async () => {
    // Si hay texto escrito sin mandar, cuenta como respuesta.
    let msgs = useNewTripStore.getState().messages;
    if (text.trim() && current) {
      send(text);
      msgs = useNewTripStore.getState().messages;
    }
    clearError();
    setStarting(true);
    const res = await callTool<'plan_trip', PlanTripStart>('plan_trip', {
      conversation: conversationFor(msgs, startDate),
      ...(startDate ? { start_date: startDate } : {}),
    });
    setStarting(false);
    if (!res.ok) {
      startError();
      return;
    }
    void qc.invalidateQueries({ queryKey: tripKeys.mine() });
    setJob(res.data);
  }, [text, current, send, clearError, startDate, startError, qc, setJob]);

  const dates = useMemo(() => Array.from({ length: 21 }, (_, i) => isoIn(i)), []);

  // Solo dev: ?demo=1 contesta el chat de prueba (como si se tipeara) y, con &go=1, toca "Armar el viaje".
  const { demo, go } = useLocalSearchParams<{ demo?: string; go?: string }>();
  const demoRan = useRef(false);
  useEffect(() => {
    if (!__DEV__ || demo !== '1' || demoRan.current || demoConsumed) return;
    demoRan.current = true;
    demoConsumed = true; // una sola vez por sesión de JS (no re-disparar al volver a montar el chat)
    router.setParams({ demo: undefined, go: undefined });
    (async () => {
      const store = useNewTripStore.getState();
      store.reset();
      store.setStartDate(isoIn(7));
      for (const a of DEMO_ANSWERS) {
        await new Promise((r) => setTimeout(r, 700));
        const st = useNewTripStore.getState();
        st.answer(st.step === 1 && st.startDate ? `Desde el ${formatDay(st.startDate)}, ${a}` : a);
      }
      if (go === '1') {
        await new Promise((r) => setTimeout(r, 1200));
        void buildRef.current();
      }
    })();
  }, [demo, go]);
  const buildRef = useRef(build);
  buildRef.current = build;

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
        <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.chat} keyboardShouldPersistTaps="handled">
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {hasError ? <Button label="Reintentar" variant="danger" onPress={() => void build()} loading={starting} style={styles.retry} /> : null}

          {current && !hasError ? (
            <View style={styles.chips}>
              {current.chips.map((c) => {
                const selected = current.multi && interests.includes(c);
                return (
                  <Chip
                    key={c}
                    label={c}
                    selected={!!selected}
                    onPress={() => (current.multi ? toggleInterest(c) : send(c))}
                  />
                );
              })}
              {current.datePicker ? (
                <Chip label={startDate ? `Desde ${formatDay(startDate)}` : 'Elegir fecha'} selected={!!startDate} onPress={() => setShowDates((v) => !v)} />
              ) : null}
            </View>
          ) : null}
          {current?.datePicker && showDates ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
              {dates.map((d) => (
                <Chip key={d} label={formatDay(d)} selected={startDate === d} onPress={() => setStartDate(startDate === d ? null : d)} />
              ))}
            </ScrollView>
          ) : null}
          {current?.multi && interests.length ? (
            <Button label={`Listo (${interests.length})`} variant="secondary" onPress={() => send(text)} style={styles.retry} />
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          {current ? (
            <View style={styles.inputRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Escribí acá…"
                placeholderTextColor={colors.masked}
                style={styles.input}
                multiline
                maxLength={2000}
                accessibilityLabel="Tu respuesta"
              />
              <Pressable
                onPress={() => send(text)}
                disabled={!text.trim() && !(current.multi && interests.length)}
                accessibilityRole="button"
                accessibilityLabel="Mandar"
                style={({ pressed }) => [styles.sendBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.sendText}>Mandar</Text>
              </Pressable>
            </View>
          ) : null}
          {step >= STEPS.length - 1 ? (
            <Button label="Armar el viaje" onPress={() => void build()} loading={starting} style={styles.buildBig} />
          ) : canBuild ? (
            <Button label="Armalo ya" variant="secondary" onPress={() => void build()} loading={starting} style={styles.buildSmall} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === 'user';
  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, m.error && styles.bubbleError]}
      accessibilityRole={m.error ? 'alert' : undefined}
    >
      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine, m.error && styles.bubbleTextError]}>{m.text}</Text>
    </Animated.View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// ───────────────────────── Armando (progreso en vivo)

function Building({ job }: { job: PlanTripStart }) {
  const reset = useNewTripStore((s) => s.reset);
  const trip = useTrip(job.trip_id);
  const legs = useTripLegs(job.trip_id);
  useTripRealtime(job.trip_id); // legs/blocks llegan en vivo
  const [finished, setFinished] = useState(false);

  // El viaje ya no existe (se borró o no tengo acceso): volvemos al chat en vez de quedar en blanco.
  useEffect(() => {
    if (trip.isSuccess && trip.data === null) reset();
  }, [trip.isSuccess, trip.data, reset]);

  const openTrip = useCallback(() => {
    reset();
    router.replace({ pathname: '/trip/[tripId]', params: { tripId: job.trip_id } });
  }, [job.trip_id, reset]);

  // Al terminar bien: un momento para ver el "Listo" y vamos al viaje.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(openTrip, 1500);
    return () => clearTimeout(t);
  }, [finished, openTrip]);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.building}>
        <Text style={styles.tripTitle}>{trip.data?.title ?? 'Tu viaje'}</Text>
        <View style={{ marginTop: space.md }}>
          <AgentJobProgress tripId={job.trip_id} jobId={job.job_id} onDone={() => setFinished(true)} showSkeleton />
        </View>
        <LiveItinerary tripId={job.trip_id} />
      </ScrollView>
      <View style={styles.composer}>
        <Button label="Ver el viaje" onPress={openTrip} disabled={!legs.data?.length} />
        <Button
          label="Empezar otro viaje"
          variant="ghost"
          onPress={reset}
          accessibilityHint="El viaje que se está armando sigue en Mis viajes"
          style={{ marginTop: space.xs }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  chat: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.md },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleError: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  bubbleText: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  bubbleTextMine: { color: colors.primaryText },
  bubbleTextError: { color: colors.danger, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  dateRow: { gap: space.sm, paddingVertical: space.xs },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { fontSize: font.small, color: colors.primary, fontWeight: '600' },
  chipTextSelected: { color: colors.primaryText },
  retry: { alignSelf: 'flex-start', marginTop: space.xs },
  composer: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH,
    maxHeight: 120,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingTop: 12,
    paddingBottom: 12,
  },
  sendBtn: { minHeight: MIN_TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.primary, justifyContent: 'center' },
  sendText: { color: colors.primaryText, fontWeight: '700', fontSize: font.small },
  buildBig: { marginTop: space.sm, minHeight: 56 },
  buildSmall: { marginTop: space.sm },
  building: { padding: space.lg, paddingBottom: space.xxl },
  tripTitle: { fontSize: font.title, fontWeight: '700', color: colors.text },
});
