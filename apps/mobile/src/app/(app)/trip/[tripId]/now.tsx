// Vista Ahora (PRD 19): la principal en la calle. Qué toca ahora, qué sigue y cuándo salir, más acceso
// grande y rápido a lo del Scout (hablar, "Tour acá, ahora", cámara, cómo llego).
// Fecha/hora simulables para probar con el seed: menú dev o `build101://trip/<id>/now?at=2026-10-18T10:30`
// (`at=real` vuelve al reloj real). Previsualizar el avatar: `?scout=listening|speaking|thinking|idle`.
// Tour en vivo (solo __DEV__, para probar sin tocar la pantalla): `?tour=start|<tour_id>|end|close|skip|more|scout|clock:-30`
// y simulador `?sim=play|pause|x1|x10|stop<N>|t<segundos>` (stop: salta a ~15 s de la parada N; t: a ese segundo del
// track). `&n=<algo>` para repetir el mismo.
// Vigilante de horarios (solo dev): `?watch=run` (una pasada ya), `reset` (olvidar los avisos de hoy),
// `later` (olvidar y pasar en 8 s, para ver el aviso desde otra pantalla), `notif-reset` (volver a pedir permiso).
import { SCOUT, scheduleAlertText } from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AgentJobProgress } from '../../../../features/jobs/AgentJobProgress';
import { useClockStore, useNow } from '../../../../features/now/clock';
import {
  CurrentCard,
  LaterList,
  NextCard,
  openDirections,
  ScoutDock,
  StateCard,
  Suggestions,
} from '../../../../features/now/components';
import {
  buildNowPlan,
  clock,
  hasCoords,
  isFarAway,
  leaveInMin,
  leaveUrgency,
  localParts,
  nearbyIdeas,
  needsSuggestions,
  resolveToday,
} from '../../../../features/now/selectors';
import { useEta } from '../../../../features/now/useEta';
import { ProposalBanner, StaleBanner } from '../../../../features/plan/components/PlanRows';
import { showMenu } from '../../../../features/plan/menu';
import { openBlock, openProposals } from '../../../../features/plan/nav';
import { useMe, usePendingProposals, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import type { PlanBlock } from '../../../../features/plan/selectors';
import { LiveTourView } from '../../../../features/tour/LiveTourView';
import { NearbyTourCard } from '../../../../features/tours/NearbyTourCard';
import { NEARBY_DURATIONS, startNearbyTour, useNearbyTourAvailable, useNearbyTourJob } from '../../../../features/tours/nearbyTour';
import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail, useTrip } from '../../../../features/trips/queries';
import { formatDay } from '../../../../lib/format';
import { useLocationFix, useLocationProvider } from '../../../../location/LocationContext';
import type { AvatarPerson } from '../../../../ui/Avatar';
import { Button } from '../../../../ui/Button';
import { ErrorState, SkeletonCard } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { useTourStore } from '../../../../tour/store';
import { resetNotificationAsk } from '../../../../schedule/notifications';
import { useScheduleStore } from '../../../../schedule/store';
import { showToScout } from '../../../../voice/camera/showToScout';
import { previewScoutState, useScout, type ScoutState } from '../../../../voice/useScout';

const DOCK_HEIGHT = 190;
const PREVIEW_STATES: ScoutState[] = ['idle', 'listening', 'speaking', 'thinking'];


export default function NowTab() {
  const tripId = useTripId();
  const me = useMe();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const proposals = usePendingProposals(tripId);
  const { now, simulated } = useNow();
  const scout = useScout();
  const goToPlan = () => router.navigate({ pathname: '/trip/[tripId]', params: { tripId } });
  const tourAvailable = useNearbyTourAvailable().data === true;
  // PRD 07: con un tour activo, Ahora se convierte en el tour.
  const tourPhase = useTourStore((s) => s.phase);
  const tourError = useTourStore((s) => s.error);
  const nearbyJob = useNearbyTourJob((s) => s.job);

  // Deep link de pruebas: ?at=2026-10-18T10:30 | real · ?scout=listening
  const link = useLocalSearchParams<{ at?: string; scout?: string; loc?: string; tour?: string; sim?: string; watch?: string; n?: string }>();
  useEffect(() => {
    if (!link.at) return;
    if (link.at === 'real') useClockStore.getState().reset();
    else useClockStore.getState().simulate(link.at);
  }, [link.at]);
  useEffect(() => {
    if (link.scout && (PREVIEW_STATES as string[]).includes(link.scout)) previewScoutState(link.scout as ScoutState);
  }, [link.scout]);

  // Ubicación: la vista Ahora es el momento justo para pedirla (ETA y "Tour acá, ahora").
  const location = useLocationProvider();
  const fix = useLocationFix();
  const triedStart = useRef<string | null>(null);
  useEffect(() => {
    // Un intento por provider (si el usuario niega el permiso, no insistimos: queda el link "Activar ubicación").
    if (location.active || triedStart.current === location.kind) return;
    triedStart.current = location.kind;
    void location.start();
  }, [location]);
  const here = fix ? { lat: fix.lat, lng: fix.lng } : null;
  // Deep link de pruebas: ?loc=simulated|real elige el LocationProvider.
  const { setKind } = location;
  useEffect(() => {
    if (link.loc === 'simulated' || link.loc === 'real') setKind(link.loc);
  }, [link.loc, setKind]);

  // Deep links de pruebas del tour en vivo (solo dev).
  const { simulator, simStops } = location;
  useEffect(() => {
    if (!__DEV__ || !link.sim) return;
    const cmd = link.sim;
    if (cmd === 'play') simulator.play();
    else if (cmd === 'pause') simulator.pause();
    else if (cmd === 'x1') simulator.setSpeed(1);
    else if (cmd === 'x10') simulator.setSpeed(10);
    else if (/^t\d+$/.test(cmd)) simulator.seek(Number(cmd.slice(1)));
    else if (/^stop\d+$/.test(cmd)) {
      const live = useTourStore.getState().live;
      const i = Number(cmd.slice(4));
      const st = live ? [...live.tour.stops].sort((a, b) => a.sort_order - b.sort_order)[i - 1] : simStops[i - 1];
      if (st) simulator.seekToPoint(st.lat, st.lng, 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.sim, link.n]);

  // Deep links de pruebas del vigilante de horarios (solo dev).
  useEffect(() => {
    if (!__DEV__ || !link.watch) return;
    const w = useScheduleStore.getState();
    if (link.watch === 'later') {
      // Probar la notificación con la app en otra pantalla: olvida y corre de nuevo en 8 s.
      setTimeout(() => {
        useScheduleStore.getState().reset();
        void useScheduleStore.getState().run({ source: 'deep link (8 s)' });
      }, 8000);
      return;
    }
    if (link.watch === 'reset') w.reset();
    else if (link.watch === 'notif-reset') void resetNotificationAsk();
    // Un respiro para que el simulador / el reloj del mismo link se apliquen antes de la pasada.
    setTimeout(() => void useScheduleStore.getState().run({ source: 'deep link' }), 600);
  }, [link.watch, link.n]);

  const members = useMemo(
    () => new Map<string, AvatarPerson>((overview.data?.members ?? []).map((m) => [m.id, m])),
    [overview.data?.members],
  );

  const today = useMemo(
    () => (overview.data ? resolveToday(overview.data.legs, me, now, trip.data) : null),
    [overview.data, me, now, trip.data],
  );

  const plan = useMemo(() => {
    if (!today || today.kind !== 'today' || !blocks.data) return null;
    return buildNowPlan(
      blocks.data.filter((b) => b.day_id === today.day.id),
      me,
      today.minutes,
    );
  }, [today, blocks.data, me]);

  const nowMin = today && (today.kind === 'today' || today.kind === 'noDay') ? today.minutes : 0;
  const next = plan?.next ?? null;
  const nextTarget = next && hasCoords(next.block) ? { id: next.block.id, lat: next.block.lat, lng: next.block.lng } : null;
  // Muy lejos (otra ciudad, o el GPS por defecto del simulador): no calculamos "salí en X".
  const far = !!here && !!nextTarget && isFarAway(here, nextTarget);
  const eta = useEta(far ? null : here, nextTarget);

  // Último aviso del vigilante de horarios para el próximo bloque.
  const lastAlert = useScheduleStore((s) => (next ? s.last[next.block.id] : undefined));
  const alertNote = lastAlert
    ? `Te avisé a las ${clock(localParts(lastAlert.at, -180).minutes)}${lastAlert.channel === 'notification' ? '' : ` por ${SCOUT.name}`}: ${scheduleAlertText(lastAlert.payload, next?.block.place_name).title}`
    : null;

  // Haptic suave cuando "Salí en X" pasa a naranja.
  const urgency = next && eta.data ? leaveUrgency(leaveInMin(next.start, nowMin, eta.data.minutes)) : null;
  const prevUrgency = useRef(urgency);
  useEffect(() => {
    if (urgency === 'soon' && prevUrgency.current === 'ok') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    prevUrgency.current = urgency;
  }, [urgency]);

  const legId = today?.kind === 'today' ? today.leg.id : overview.data?.legs[0]?.id;
  const ideas = useMemo(
    () => (legId && blocks.data ? nearbyIdeas(blocks.data, legId, here, 1, 3) : []),
    // here cambia con cada fix: recalcular por celda alcanza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legId, blocks.data, here ? `${here.lat.toFixed(3)}:${here.lng.toFixed(3)}` : ''],
  );

  // ───────── Acciones del Scout
  const talkAbout = (b: PlanBlock) =>
    scout.startScoutCall({
      tripId,
      focus: { block_id: b.id, label: b.title, ...(hasCoords(b) ? { lat: b.lat, lng: b.lng } : {}) },
      context: {
        kind: 'block',
        title: b.title,
        type: b.type,
        start_time: b.start_time,
        end_time: b.end_time,
        place_name: b.place_name,
        participants: b.participant_ids.map((id) => members.get(id)?.display_name ?? id),
        alerts: b.alerts,
      },
    });

  const onLongPress = (b: PlanBlock) =>
    showMenu(b.title, [
      { label: `Hablar de esto con ${SCOUT.name}`, onPress: () => void talkAbout(b) },
      { label: 'Ver detalle', onPress: () => openBlock(tripId, b.id) },
    ]);

  const onPressBlock = (b: PlanBlock) => openBlock(tripId, b.id);

  const onTalk = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (scout.inCall) void scout.endScoutCall();
    else void scout.startScoutCall({ tripId });
  };

  const onNearbyTour = async () => {
    if (!tourAvailable) {
      Alert.alert('Tour acá, ahora', `Muy pronto: ${SCOUT.name} te va a armar un recorrido con paradas verificadas desde donde estés.`);
      return;
    }
    if (!here) {
      Alert.alert('Necesito tu ubicación', 'Activá la ubicación para armarte un tour desde donde estás.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Activar', onPress: () => void location.start() },
      ]);
      return;
    }
    if (nearbyJob) {
      Alert.alert('Tour acá, ahora', `${SCOUT.name} ya te está armando un tour: mirá la tarjeta de arriba.`);
      return;
    }
    // PRD 18: duración 30 / 60 / 90 (temas y modo explorador: fuera por ahora).
    const go = async (duration_min: number) => {
      const res = await startNearbyTour({ lat: here.lat, lng: here.lng, trip_id: tripId, duration_min });
      if (!res.ok) Alert.alert('No pude armar el tour', res.message);
    };
    Alert.alert('Tour acá, ahora', '¿Cuánto tiempo tenés?', [
      ...NEARBY_DURATIONS.map((m) => ({ text: m === 60 ? '1 hora' : m === 90 ? '1 h 30' : `${m} min`, onPress: () => void go(m) })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  // "Empezar tour" desde el bloque tour del día (actual o próximo) con su tour ya generado.
  const tourBlock = [plan?.current?.block, next?.block].find((b): b is PlanBlock => !!b && b.type === 'tour' && !!b.tour_id) ?? null;
  const onStartTour = async (b: PlanBlock) => {
    const names = b.participant_ids.map((id) => members.get(id)?.display_name).filter((n): n is string => !!n);
    const ok = await useTourStore.getState().start({ tourId: b.tour_id!, tripId, participants: names });
    if (!ok) Alert.alert('No pude empezar el tour', useTourStore.getState().error ?? 'Probá de nuevo.');
  };

  useEffect(() => {
    if (!__DEV__ || !link.tour) return;
    const t = useTourStore.getState();
    const cmd = link.tour;
    if (cmd === 'end') void t.finish();
    else if (cmd === 'close') t.close();
    else if (cmd === 'skip') {
      const live = t.live;
      const pending = live ? [...live.tour.stops].sort((a, b) => a.sort_order - b.sort_order).find((x) => !live.engine.visited[x.stop_id] && !live.engine.skipped.includes(x.stop_id)) : null;
      if (pending) t.skip(pending.stop_id);
    } else if (cmd === 'more') {
      const c = t.card;
      if (c && 'stopId' in c) void t.showLayer(c.stopId, c.kind === 'dwell' ? c.offer : 'more');
    } else if (cmd === 'scout') void t.askScout(t.live?.engine.insideStopId ?? null);
    else if (cmd.startsWith('clock:')) t.devShiftClock(Number(cmd.slice(6)) || 0);
    else if (cmd.startsWith('nearby:')) {
      // "Tour acá, ahora" sin el diálogo de duración (gasta una corrida real de generate_tour).
      if (here) void startNearbyTour({ lat: here.lat, lng: here.lng, trip_id: tripId, duration_min: Number(cmd.slice(7)) || 30 });
    } else if (cmd === 'nearby-start') {
      const j = useNearbyTourJob.getState().job;
      if (j) void t.start({ tourId: j.tourId, tripId: j.tripId }).then((ok) => ok && useNearbyTourJob.getState().clear());
    }
    else if (cmd === 'start') {
      if (tourBlock) void onStartTour(tourBlock);
    } else void t.start({ tourId: cmd, tripId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.tour, link.n, !!tourBlock]);

  // PRD 08: abre la cámara y, si no hay llamada, el scout se conecta de fondo para narrar la foto.
  const onCamera = () => void showToScout({ tripId });

  // Cómo llego: al próximo bloque; si no hay, al actual.
  const directionsTarget = [next?.block, plan?.current?.block].find((b): b is PlanBlock => !!b && hasCoords(b)) ?? null;
  const onDirections =
    directionsTarget && hasCoords(directionsTarget) ? () => openDirections(directionsTarget) : null;

  // ───────── Estados
  const loading = overview.isPending || blocks.isPending || trip.isPending;
  const hardError = (overview.isError && !overview.data) || (blocks.isError && !blocks.data);
  const stale = (overview.isError && !!overview.data) || (blocks.isError && !!blocks.data);
  const retry = () => {
    void overview.refetch();
    void blocks.refetch();
    void proposals.refetch();
  };

  const dock = (
    <ScoutDock
      scoutState={scout.state}
      onTalk={onTalk}
      onNearbyTour={() => void onNearbyTour()}
      tourAvailable={tourAvailable}
      onCamera={onCamera}
      onDirections={onDirections}
      directionsLabel={directionsTarget ? `Indicaciones a pie hasta ${directionsTarget.place_name ?? directionsTarget.title}` : undefined}
    />
  );

  if (tourPhase === 'live' || tourPhase === 'done') return <LiveTourView />;

  if (loading) {
    return (
      <View style={styles.flex}>
        <View style={styles.content}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
        {dock}
      </View>
    );
  }

  if (hardError || !today) {
    return (
      <View style={styles.flex}>
        <ErrorState message="No pude cargar tu día" detail={errorDetail(overview.error ?? blocks.error)} onRetry={retry} />
        {dock}
      </View>
    );
  }

  const city = today.kind === 'today' ? today.leg.city : overview.data?.legs[0]?.city;
  const date = 'date' in today ? today.date : null;
  const pendingCount = proposals.data?.length ?? 0;
  const showSuggestions = (plan && needsSuggestions(plan)) || today.kind === 'noDay';

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: DOCK_HEIGHT + space.xl }]}
        refreshControl={<RefreshControl refreshing={overview.isRefetching || blocks.isRefetching} onRefresh={retry} />}
      >
        <View style={styles.header}>
          <Text style={styles.headerDate}>{date ? `Hoy · ${formatDay(date)}` : 'Hoy'}</Text>
          {city ? <Text style={styles.headerCity}>{city}</Text> : null}
          {simulated ? (
            <Text style={styles.sim} accessibilityLabel="Hora simulada">
              Hora simulada · {clock(localParts(now, -180).minutes)}
            </Text>
          ) : null}
        </View>

        <AgentJobProgress tripId={tripId} showSkeleton={false} />
        <NearbyTourCard here={here} />
        <ProposalBanner count={pendingCount} onPress={() => openProposals(tripId)} />
        {stale ? <StaleBanner /> : null}

        {today.kind === 'noLegs' ? (
          <StateCard title="Este viaje está en blanco" body={`Armá el plan y ${SCOUT.name} te va diciendo qué toca en cada momento.`}>
            <Button label="Ir a Planificación" onPress={goToPlan} />
          </StateCard>
        ) : null}
        {today.kind === 'before' ? (
          <StateCard
            title={today.daysUntil === 1 ? 'Tu viaje empieza mañana' : `Tu viaje empieza en ${today.daysUntil} días`}
            body="Cuando arranque, acá vas a ver qué toca ahora, qué sigue y cuándo salir."
          >
            <Button label="Ver el plan" onPress={goToPlan} />
          </StateCard>
        ) : null}
        {today.kind === 'after' ? (
          <StateCard title="Tu viaje terminó" body="Esperamos que la hayas pasado bárbaro.">
            <Button label="Ver el plan" variant="secondary" onPress={goToPlan} />
          </StateCard>
        ) : null}
        {today.kind === 'noDay' ? (
          <StateCard title="Hoy no tenés nada en el plan" body={`Pedile a ${SCOUT.name} un tour o agregá algo desde Planificación.`} />
        ) : null}

        {showSuggestions ? (
          <Suggestions ideas={ideas} onIdea={onPressBlock} onNearbyTour={() => void onNearbyTour()} tourAvailable={tourAvailable} />
        ) : null}
        {tourBlock ? (
          <View style={styles.startTour}>
            <Text style={styles.startTourKicker}>TOUR DE HOY</Text>
            <Text style={styles.startTourTitle}>{tourBlock.title}</Text>
            <Button
              label="Empezar tour"
              loading={tourPhase === 'starting'}
              onPress={() => void onStartTour(tourBlock)}
              accessibilityHint={`${SCOUT.name} te avisa al llegar a cada parada`}
            />
            {tourError && tourPhase === 'idle' ? <Text style={styles.hint}>No pude empezar: {tourError}</Text> : null}
          </View>
        ) : null}
        {plan?.current ? (
          <CurrentCard current={plan.current} members={members} onPress={onPressBlock} onLongPress={onLongPress} />
        ) : null}
        {next ? (
          <NextCard
            next={next}
            nowMin={nowMin}
            eta={far ? null : (eta.data ?? null)}
            locationOff={!here}
            farAway={far}
            onEnableLocation={() => void location.start()}
            members={members}
            alertNote={alertNote}
            onPress={onPressBlock}
            onLongPress={onLongPress}
          />
        ) : null}
        {plan && !plan.current && !next && plan.total > 0 && !showSuggestions ? (
          <StateCard title="Terminaste lo de hoy" body="No queda nada más en el plan de hoy." />
        ) : null}
        {plan ? <LaterList blocks={plan.later} onPress={onPressBlock} onLongPress={onLongPress} /> : null}
        {plan && (plan.current || next) ? <Text style={styles.hint}>Mantené apretada una tarjeta para hablar de eso con {SCOUT.name}.</Text> : null}
      </ScrollView>
      {dock}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  header: { gap: 2, marginBottom: space.xs },
  headerDate: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  headerCity: { fontSize: font.title, fontWeight: '800', color: colors.text },
  sim: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    fontSize: font.tiny,
    fontWeight: '700',
    color: '#8A5A00',
    backgroundColor: '#FFF3D6',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  hint: { fontSize: font.tiny, color: colors.textMuted, textAlign: 'center' },
  startTour: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.scout, padding: space.lg, gap: space.sm },
  startTourKicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.scout },
  startTourTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
});
