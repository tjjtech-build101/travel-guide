// Vista Ahora v2 (PRD 19 + docs/AHORA-V2.md): responde "¿qué hago ya?" con UN protagonista.
// Encabezado + clima · frase de Scout · riel del día · un aviso · protagonista (pickHero) · "Después" · dock.
// Deep links de prueba (build101://trip/<id>/now?...):
//   ?at=2026-10-18T10:30 | real  · hora simulada (Montevideo)      ?preview=day1 · vista previa del día 1 (local, sin escrituras)
//   ?loc=simulated|real|near     · near: GPS simulado a ~8 min a pie del próximo bloque
//   ?scout=listening|speaking|thinking|idle · estado del avatar
//   ?tour=start|<tour_id>|end|close|skip|more|scout|clock:-30|nearby:<min>|nearby-start (solo __DEV__)
//   ?sim=play|pause|x1|x10|stop<N>|t<seg> (simulador de GPS, solo __DEV__)
//   ?watch=run|reset|later|notif-reset (vigilante de horarios, solo __DEV__) · ?do=late|planday|offline|outdoor-on|outdoor-off (solo __DEV__)
//   &n=<algo> repite el mismo link
import { SCOUT, zonedParts, zonedUtc } from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AgentJobProgress } from '../../../../features/jobs/AgentJobProgress';
import { isStale, useLatestPlanJob } from '../../../../features/jobs/queries';
import { useClockStore, useNow } from '../../../../features/now/clock';
import { openDirections } from '../../../../features/now/components';
import {
  buildNowPlan,
  clock,
  formatMinutes,
  hasCoords,
  isFarAway,
  isMineForNow,
  resolveToday,
  tripTimeZone,
} from '../../../../features/now/selectors';
import { useEta } from '../../../../features/now/useEta';
import { useNowDemo } from '../../../../features/now/v2/demo';
import {
  planDayErrorText,
  useGapSuggestions,
  useGroupPositions,
  useNowCache,
  useOutdoorMode,
  usePlanDay,
  useRainPlanB,
  useScoutLine,
  useShareMyLocation,
  useTourPreview,
  useWeatherNow,
} from '../../../../features/now/v2/hooks';
import { gapStartTime } from '../../../../features/now/v2/hooks/pure';
import { dayRail, nearPoint, nextRowLabel, pickHero, pickNotice, showNextRow, toBriefSnapshot } from '../../../../features/now/v2/model';
import type { GapSuggestion } from '../../../../features/now/v2/types';
import { LiveCountdown } from '../../../../features/now/v2/ui/Countdown';
import { DayRail } from '../../../../features/now/v2/ui/DayRail';
import { DockV2 } from '../../../../features/now/v2/ui/DockV2';
import { GroupFaces, type GroupFacesPerson } from '../../../../features/now/v2/ui/GroupFaces';
import { HeroCurrent } from '../../../../features/now/v2/ui/HeroCurrent';
import { HeroFree } from '../../../../features/now/v2/ui/HeroFree';
import { HeroLeave } from '../../../../features/now/v2/ui/HeroLeave';
import { HeroState, PreviewChip } from '../../../../features/now/v2/ui/HeroState';
import { HeroTour } from '../../../../features/now/v2/ui/HeroTour';
import { InlineNotice } from '../../../../features/now/v2/ui/InlineNotice';
import { LateSheet } from '../../../../features/now/v2/ui/LateSheet';
import { NextRow } from '../../../../features/now/v2/ui/NextRow';
import { ScoutLine } from '../../../../features/now/v2/ui/ScoutLine';
import { WeatherChip } from '../../../../features/now/v2/ui/WeatherChip';
import { ActionToast } from '../../../../features/plan/components/ActionToast';
import { useMoveBlock } from '../../../../features/plan/mutations';
import { openBlock, openProposals } from '../../../../features/plan/nav';
import { useMe, usePendingProposals, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import type { PlanBlock } from '../../../../features/plan/selectors';
import { showToast } from '../../../../features/plan/store';
import { LiveTourView } from '../../../../features/tour/LiveTourView';
import { NearbyTourCard } from '../../../../features/tours/NearbyTourCard';
import { NEARBY_DURATIONS, startNearbyTour, useNearbyTourAvailable, useNearbyTourJob } from '../../../../features/tours/nearbyTour';
import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail, useTrip } from '../../../../features/trips/queries';
import { callTool } from '../../../../lib/api';
import { formatDay } from '../../../../lib/format';
import { useLocationFix, useLocationProvider } from '../../../../location/LocationContext';
import { resetNotificationAsk } from '../../../../schedule/notifications';
import { useScheduleStore } from '../../../../schedule/store';
import { useTourStore } from '../../../../tour/store';
import type { AvatarPerson } from '../../../../ui/Avatar';
import { ErrorState, SkeletonCard } from '../../../../ui/States';
import { Text, TextBoost } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { showToScout } from '../../../../voice/camera/showToScout';
import { previewScoutState, useScout, type ScoutState } from '../../../../voice/useScout';

/** Lugar que deja el dock abajo (botón + íconos). */
const DOCK_SPACE = 150;
const PREVIEW_STATES: ScoutState[] = ['idle', 'listening', 'speaking', 'thinking'];
const NORMAL = { scale: 1, contrast: false };
const OUTDOOR = { scale: 1.15, contrast: true };

type Link = {
  at?: string;
  preview?: string;
  scout?: string;
  loc?: string;
  tour?: string;
  sim?: string;
  watch?: string;
  do?: string;
  n?: string;
};

export default function NowTab() {
  const tripId = useTripId();
  const me = useMe();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const proposals = usePendingProposals(tripId);
  const scout = useScout();
  const { outdoor, setOutdoor } = useOutdoorMode();
  const tourAvailable = useNearbyTourAvailable().data === true;
  const tourPhase = useTourStore((s) => s.phase);
  const tourError = useTourStore((s) => s.error);
  const nearbyJob = useNearbyTourJob((s) => s.job);
  const planJob = useLatestPlanJob(tripId);
  const cache = useNowCache(tripId);
  useShareMyLocation(tripId);
  const moveBlock = useMoveBlock(tripId);
  const planDay = usePlanDay();
  const goToPlan = () => router.navigate({ pathname: '/trip/[tripId]', params: { tripId } });

  const link = useLocalSearchParams<Link>();

  // Reloj: cada 30 s (la cuenta regresiva con segundos tiene su propio reloj: LiveCountdown).
  // "Ver mi día 1" es local a esta pantalla: no toca el reloj global (ni avisos, ni ubicación compartida, ni otros
  // viajes) y mientras dura no se escribe nada.
  const { offsetMs: clockOffset, simulated } = useNow(30_000);
  const [previewOffset, setPreviewOffset] = useState<number | null>(null);
  const preview = previewOffset != null;
  const offsetMs = previewOffset ?? clockOffset;
  const now = Date.now() + offsetMs;

  useEffect(() => {
    void useNearbyTourJob.getState().hydrate();
  }, []);

  // ───────── Ubicación (ETA, grupo, "Tour acá, ahora")
  const location = useLocationProvider();
  const fix = useLocationFix();
  const triedStart = useRef<string | null>(null);
  useEffect(() => {
    // Un intento por provider: si niega el permiso no insistimos.
    if (location.active || triedStart.current === location.kind) return;
    triedStart.current = location.kind;
    void location.start();
  }, [location]);
  const fixLat = fix?.lat;
  const fixLng = fix?.lng;
  const here = useMemo(() => (fixLat != null && fixLng != null ? { lat: fixLat, lng: fixLng } : null), [fixLat, fixLng]);
  const group = useGroupPositions(tripId, here);

  // ───────── Hoy
  const legs = overview.data?.legs;
  const tz = useMemo(() => tripTimeZone(legs ?? [], me, now), [legs, me, now]);
  const today = useMemo(() => (overview.data ? resolveToday(overview.data.legs, me, now, trip.data) : null), [overview.data, me, now, trip.data]);
  const dayId = today?.kind === 'today' ? today.day.id : null;
  const nowMin = today && (today.kind === 'today' || today.kind === 'noDay') ? today.minutes : 0;
  const myDayBlocks = useMemo(
    () => (dayId && blocks.data ? blocks.data.filter((b) => b.day_id === dayId && isMineForNow(b, me)) : []),
    [dayId, blocks.data, me],
  );
  const plan = useMemo(() => (today?.kind === 'today' && blocks.data ? buildNowPlan(myDayBlocks, me, today.minutes) : null), [today, blocks.data, myDayBlocks, me]);
  const next = plan?.next ?? null;
  const nextTarget = next && hasCoords(next.block) ? { id: next.block.id, lat: next.block.lat, lng: next.block.lng } : null;
  const far = !!here && !!nextTarget && isFarAway(here, nextTarget);
  const eta = useEta(far ? null : here, nextTarget);
  const etaData = far ? null : (eta.data ?? null);

  const hero = useMemo(
    () => pickHero({ today, plan, eta: etaData, nowMin, far, tourBlocks: myDayBlocks }),
    [today, plan, etaData, nowMin, far, myDayBlocks],
  );
  const rail = useMemo(() => dayRail(myDayBlocks, nowMin), [myDayBlocks, nowMin]);

  // Haptic al pasar a "justo" o "tarde".
  const urgency = hero.kind === 'leave' ? hero.urgency : null;
  const prevUrgency = useRef(urgency);
  useEffect(() => {
    const prev = prevUrgency.current;
    prevUrgency.current = urgency;
    if (urgency && urgency !== 'ok' && prev !== urgency && prev !== null) {
      void Haptics.notificationAsync(
        urgency === 'late' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
    }
  }, [urgency]);

  // ───────── Clima, lluvia, ideas, frase de Scout
  const leg = today?.kind === 'today' ? today.leg : (legs?.[0] ?? null);
  const date = today && 'date' in today ? today.date : null;
  const weather = useWeatherNow({ lat: leg?.lat, lng: leg?.lng, date: today?.kind === 'today' ? date : null, dayId, tz });
  const rain = useRainPlanB({ weather, dayBlocks: myDayBlocks, allBlocks: blocks.data ?? [], dayId });
  const gap = useGapSuggestions({
    tripId,
    legId: today?.kind === 'today' ? today.leg.id : null,
    dayId,
    here,
    minutes: hero.kind === 'free' ? (hero.gapMin ?? 180) : 0,
    date: date ?? '',
    localTime: clock(nowMin),
    enabled: hero.kind === 'free' && !nearbyJob,
  });
  const [addingId, setAddingId] = useState<string | null>(null);
  useEffect(() => {
    if (!gap.adding) setAddingId(null);
  }, [gap.adding]);

  const city = leg?.city ?? null;
  // Sin frase en "salí para" (el protagonista ya lo dice todo) ni en los estados.
  const showLine = hero.kind !== 'leave' && hero.kind !== 'state';
  const snapshot = useMemo(
    () =>
      today && showLine
        ? toBriefSnapshot({ hero, nowMin, city, plan, eta: etaData, weather, suggestions: gap.items, group })
        : null,
    [today, showLine, hero, nowMin, city, plan, etaData, weather, gap.items, group],
  );
  const line = useScoutLine(snapshot, tripId);

  // ───────── Personas
  const members = useMemo(
    () => new Map<string, AvatarPerson>((overview.data?.members ?? []).map((m) => [m.id, m])),
    [overview.data?.members],
  );
  const facesFor = (b: PlanBlock): GroupFacesPerson[] =>
    b.participant_ids
      .filter((id) => id !== me)
      .map((id) => ({
        ...(members.get(id) ?? { id, display_name: null, avatar_url: null }),
        distance_m: group.find((g) => g.user_id === id)?.distance_m ?? null,
      }));
  const faces = (b: PlanBlock) => {
    const people = facesFor(b);
    return people.length ? <GroupFaces people={people} /> : null;
  };

  // Vista previa: nada de escrituras (agregar, armar, avisar, mover, empezar tour).
  const blockedByPreview = () => {
    if (!preview) return false;
    showToast({ text: 'Es una vista previa. Volvé a hoy para hacer cambios.', tone: 'info' });
    return true;
  };

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
  // Pulsación larga en el protagonista: atajo a "hablar de esto".
  const talkShortcut = (b: PlanBlock) => () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    void talkAbout(b);
  };

  const onTalk = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (scout.inCall) void scout.endScoutCall();
    else void scout.startScoutCall({ tripId });
  };

  const heroBlock =
    hero.kind === 'leave' ? hero.next.block : hero.kind === 'tour' ? hero.block : hero.kind === 'current' ? hero.current.block : null;
  const onScoutLine = () => {
    if (scout.inCall) return;
    if (heroBlock) void talkAbout(heroBlock);
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
      Alert.alert('Tour acá, ahora', `${SCOUT.name} ya te está armando un tour.`);
      return;
    }
    // PRD 18: duración 30 / 60 / 90.
    const go = async (duration_min: number) => {
      const res = await startNearbyTour({ lat: here.lat, lng: here.lng, trip_id: tripId, duration_min });
      if (!res.ok) Alert.alert('No pude armar el tour', res.message);
    };
    Alert.alert('Tour acá, ahora', '¿Cuánto tiempo tenés?', [
      ...NEARBY_DURATIONS.map((m) => ({ text: m === 60 ? '1 hora' : m === 90 ? '1 h 30' : `${m} min`, onPress: () => void go(m) })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  };

  // Tour del día (en curso o próximo) con su tour ya generado.
  const tourBlock =
    hero.kind === 'tour'
      ? hero.block
      : ([plan?.current?.block, next?.block].find((b): b is PlanBlock => !!b && b.type === 'tour' && !!b.tour_id) ?? null);
  const tourPreview = useTourPreview(hero.kind === 'tour' ? hero.block.tour_id : null);
  const onStartTour = async (b: PlanBlock) => {
    if (blockedByPreview()) return;
    const names = b.participant_ids.map((id) => members.get(id)?.display_name).filter((n): n is string => !!n);
    const ok = await useTourStore.getState().start({ tourId: b.tour_id!, tripId, participants: names });
    if (!ok) Alert.alert('No pude empezar el tour', useTourStore.getState().error ?? 'Probá de nuevo.');
  };

  // PRD 08: cámara; si no hay llamada, el Scout se conecta de fondo para narrar la foto.
  const onCamera = () => void showToScout({ tripId });

  // Cómo llego: al próximo bloque; si no hay, al actual.
  const directionsTarget = [next?.block, plan?.current?.block].find((b): b is PlanBlock => !!b && hasCoords(b)) ?? null;
  const onDirections = directionsTarget && hasCoords(directionsTarget) ? () => openDirections(directionsTarget) : null;

  // ───────── Voy tarde
  const [lateOpen, setLateOpen] = useState(false);
  const [notify, setNotify] = useState<'idle' | 'notifying' | 'notified'>('idle');
  const lateBlockId = hero.kind === 'leave' ? hero.next.block.id : null;
  useEffect(() => setNotify('idle'), [lateBlockId]);
  const lateBy = hero.kind === 'leave' ? Math.max(0, -hero.leaveIn) : 0;

  const onNotifyLate = async () => {
    if (hero.kind !== 'leave' || blockedByPreview()) return;
    setNotify('notifying');
    const res = await callTool<'report_late', { feed_id: string; summary: string }>('report_late', {
      trip_id: tripId,
      block_id: hero.next.block.id,
      late_by_min: Math.max(5, lateBy),
    });
    if (!res.ok) {
      setNotify('idle');
      setLateOpen(false);
      showToast({ text: res.error.code === 'network_error' ? 'Sin conexión: no pude avisar.' : 'No pude avisar al grupo.', tone: 'error' });
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNotify('notified');
    setTimeout(() => {
      setLateOpen(false);
      showToast({ text: 'Le avisé al grupo', tone: 'success', undoToken: res.undo_token, tripId });
    }, 700);
  };

  const onShiftLate = (min: number) => {
    if (hero.kind !== 'leave' || !dayId) return;
    if (blockedByPreview()) {
      setLateOpen(false);
      return;
    }
    const to = clock(hero.next.start + min);
    setLateOpen(false);
    moveBlock.mutate({ blockId: hero.next.block.id, dayId, startTime: to, title: hero.next.block.title, toLabel: `a las ${to}` });
  };

  // ───────── Armame la mañana/tarde/noche / Agregar idea
  const onPlanDay = () => {
    if (blockedByPreview()) return;
    if (!dayId) {
      showToast({ text: 'Hoy no hay un día del viaje para armar.', tone: 'error' });
      return;
    }
    planDay.mutate(
      {
        tripId,
        dayId,
        fromTime: gapStartTime(clock(nowMin)),
        ...(hero.kind === 'free' && hero.until ? { toTime: clock(hero.until.start) } : {}),
        here,
      },
      {
        onSuccess: () => openProposals(tripId),
        onError: (e) => showToast({ text: planDayErrorText(e), tone: 'error' }, 4000),
      },
    );
  };
  // ?do=late|planday (solo dev): abre "Voy tarde" o corre "Armame la tarde" sin tocar la pantalla.
  useEffect(() => {
    if (!__DEV__ || !link.do) return;
    const t = setTimeout(() => {
      if (link.do === 'late') setLateOpen(true);
      else if (link.do === 'planday') onPlanDay();
      else if (link.do === 'outdoor-on' || link.do === 'outdoor-off') setOutdoor(link.do === 'outdoor-on');
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.do, link.n]);

  const onAddSuggestion = (s: GapSuggestion) => {
    if (blockedByPreview()) return;
    setAddingId(s.id);
    gap.add(s);
  };

  // ───────── Deep links de prueba
  useEffect(() => {
    if (!link.at) return;
    setPreviewOffset(null);
    if (link.at === 'real') useClockStore.getState().reset();
    else useClockStore.getState().simulate(link.at);
  }, [link.at, link.n]);
  useEffect(() => {
    if (link.scout && (PREVIEW_STATES as string[]).includes(link.scout)) previewScoutState(link.scout as ScoutState);
  }, [link.scout]);
  const startDate = trip.data?.start_date ?? legs?.[0]?.start_date ?? null;
  const startPreview = () => {
    const date = startDate?.slice(0, 10);
    const t = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? zonedUtc(`${date}T10:00`, tz) : null;
    if (t != null) setPreviewOffset(t - Date.now());
  };
  useEffect(() => {
    if (link.preview === 'day1' && startDate) startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.preview, link.n, startDate]);

  const { setKind, placeSimulatedAt } = location;
  useEffect(() => {
    if (link.loc === 'simulated' || link.loc === 'real') setKind(link.loc);
  }, [link.loc, setKind]);

  // ?loc=near (o "Ubicación cerca" del menú dev): GPS simulado a ~8 min a pie del próximo bloque con lugar.
  const nearTarget = useRef<{ lat: number; lng: number } | null>(null);
  nearTarget.current = (() => {
    const b = [next?.block, ...(plan?.later ?? [])].find((x): x is PlanBlock => !!x && hasCoords(x));
    return b && hasCoords(b) ? { lat: b.lat, lng: b.lng } : null;
  })();
  const nearReq = useNowDemo((s) => s.nearReq);
  const nearKey = link.loc === 'near' ? `link:${link.n ?? ''}` : nearReq ? `menu:${nearReq}` : null;
  useEffect(() => {
    if (!nearKey) return;
    // Un respiro para que el ?at= del mismo link ya haya movido el reloj (y el "próximo" sea el de esa hora).
    const t = setTimeout(() => {
      const target = nearTarget.current;
      if (!target) {
        showToast({ text: 'No hay un próximo bloque con lugar.', tone: 'info' });
        return;
      }
      const p = nearPoint(target, 8);
      placeSimulatedAt(p.lat, p.lng, 'Cerca del próximo bloque');
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearKey]);

  // Tour en vivo y simulador (solo dev).
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

  useEffect(() => {
    if (!__DEV__ || !link.watch) return;
    const w = useScheduleStore.getState();
    if (link.watch === 'later') {
      // Probar la notificación desde otra pantalla: olvida y corre de nuevo en 8 s.
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

  useEffect(() => {
    if (!__DEV__ || !link.tour) return;
    const t = useTourStore.getState();
    const cmd = link.tour;
    if (cmd === 'end') void t.finish();
    else if (cmd === 'close') t.close();
    else if (cmd === 'skip') {
      const live = t.live;
      const pending = live
        ? [...live.tour.stops].sort((a, b) => a.sort_order - b.sort_order).find((x) => !live.engine.visited[x.stop_id] && !live.engine.skipped.includes(x.stop_id))
        : null;
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
    } else if (cmd === 'start') {
      if (tourBlock) void onStartTour(tourBlock);
    } else void t.start({ tourId: cmd, tripId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.tour, link.n, !!tourBlock]);

  // ───────── Estados
  const loading = overview.isPending || blocks.isPending || trip.isPending;
  const hardError = (overview.isError && !overview.data) || (blocks.isError && !blocks.data);
  const retry = () => {
    void overview.refetch();
    void blocks.refetch();
    void proposals.refetch();
  };

  const dock = (
    <DockV2
      scoutState={scout.state}
      onTalk={onTalk}
      onNearbyTour={() => void onNearbyTour()}
      tourAvailable={tourAvailable}
      onCamera={onCamera}
      // "Salí para" ya tiene "Cómo llego" como botón principal: no se repite en el dock.
      onDirections={hero.kind === 'leave' ? null : onDirections}
    />
  );

  // PRD 07: con un tour activo, Ahora se convierte en el tour.
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

  // Un solo aviso (sin conexión > lluvia > propuestas).
  const notice = pickNotice({
    // ?do=offline (solo dev): muestra el aviso como si se hubiera caído la red.
    offlineMinutesAgo: cache.offline || (__DEV__ && link.do === 'offline') ? cache.minutesAgo : null,
    rain,
    proposalsCount: proposals.data?.length ?? 0,
  });
  const onNotice = () => {
    if (!notice) return;
    if (notice.kind === 'offline') retry();
    else if (notice.kind === 'rain') goToPlan();
    else openProposals(tripId);
  };

  const job = planJob.data;
  const jobActive = !!job && (job.status === 'running' || job.status === 'queued') && !isStale(job);

  // ───────── Protagonista
  let protagonist: ReactNode;
  if (nearbyJob && hero.kind !== 'leave') {
    // "Tour acá, ahora" en marcha: su progreso ocupa el lugar del protagonista.
    protagonist = <NearbyTourCard here={here} />;
  } else if (hero.kind === 'leave') {
    const b = hero.next.block;
    protagonist = (
      <HeroLeave
        countdown={
          <LiveCountdown
            leaveAtMin={nowMin + hero.leaveIn}
            tz={tz}
            offsetMs={offsetMs}
            urgency={hero.urgency}
            eta={`${formatMinutes(hero.eta.minutes)} ${hero.eta.mode === 'walk' ? 'a pie' : 'en transporte'}`}
          />
        }
        faces={faces(b)}
        title={b.title}
        placeName={b.place_name}
        startLabel={clock(hero.next.start)}
        onDirections={() => (hasCoords(b) ? openDirections(b) : undefined)}
        onLate={hero.urgency !== 'ok' ? () => setLateOpen(true) : undefined}
        onPress={() => openBlock(tripId, b.id)}
        onLongPress={talkShortcut(b)}
      />
    );
  } else if (hero.kind === 'tour') {
    const b = hero.block;
    protagonist = (
      <HeroTour
        title={b.title}
        when={hero.when}
        startLabel={b.start_time ? b.start_time.slice(0, 5) : null}
        stopsCount={tourPreview?.stopsCount ?? 0}
        durationMin={tourPreview?.durationMin ?? null}
        distanceKm={tourPreview?.distanceKm ?? null}
        stopNames={tourPreview?.stopNames}
        loading={!tourPreview}
        onStart={() => void onStartTour(b)}
        starting={tourPhase === 'starting'}
        error={tourError && tourPhase === 'idle' ? `No pude empezar: ${tourError}` : null}
        onPress={() => openBlock(tripId, b.id)}
        onLongPress={talkShortcut(b)}
      />
    );
  } else if (hero.kind === 'current') {
    const c = hero.current;
    protagonist = (
      <HeroCurrent
        title={c.block.title}
        placeName={c.block.place_name}
        progress={c.progress}
        remainingMin={c.remainingMin}
        endLabel={clock(c.end)}
        faces={faces(c.block)}
        alerts={c.block.alerts}
        onTellMe={() => void talkAbout(c.block)}
        onPress={() => openBlock(tripId, c.block.id)}
        onLongPress={talkShortcut(c.block)}
      />
    );
  } else if (hero.kind === 'free') {
    const addState = addingId ? { [addingId]: 'adding' as const } : undefined;
    protagonist = (
      <HeroFree
        gapMin={hero.gapMin}
        untilLabel={hero.until ? clock(hero.until.start) : null}
        suggestions={gap.items}
        loading={gap.isLoading}
        addState={addState}
        onAdd={onAddSuggestion}
        onPlanDay={onPlanDay}
        planning={planDay.isPending}
        nowMin={nowMin}
      />
    );
  } else {
    protagonist = (
      <HeroState
        state={hero.state}
        daysUntil={hero.daysUntil}
        onPreviewDay1={startDate ? startPreview : undefined}
        onOpenPlan={goToPlan}
        onAddLeg={goToPlan}
      />
    );
  }

  const nextRow =
    next && showNextRow(hero, plan)
      ? (() => {
          const head = `${clock(next.start)} · ${next.block.title}`;
          const trailing = nextRowLabel(next, nextTarget && etaData ? etaData.minutes : null).slice(head.length + 3);
          return (
            <NextRow time={clock(next.start)} title={next.block.title} trailing={trailing} onPress={() => openBlock(tripId, next.block.id)} />
          );
        })()
      : null;

  const localNow = zonedParts(now, tz);

  return (
    <TextBoost.Provider value={outdoor ? OUTDOOR : NORMAL}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: DOCK_SPACE + space.xl }]}
          refreshControl={<RefreshControl refreshing={overview.isRefetching || blocks.isRefetching} onRefresh={retry} />}
        >
          <View style={styles.header}>
            <Text style={styles.headerText} numberOfLines={1}>
              {[date ? formatDay(date) : 'Hoy', city].filter(Boolean).join(' · ')}
            </Text>
            {__DEV__ && simulated && !preview ? (
              <Text style={styles.sim} accessibilityLabel="Hora simulada">
                {clock(localNow.minutes)}
              </Text>
            ) : null}
            <WeatherChip weather={weather} />
          </View>

          {preview ? <PreviewChip onExit={() => setPreviewOffset(null)} /> : null}
          {/* Sin conexión va arriba (cambia cómo leer todo lo demás); lluvia y propuestas, abajo. */}
          {notice?.kind === 'offline' ? <InlineNotice notice={notice} onPress={onNotice} /> : null}

          {showLine && (line.text || line.loading) ? <ScoutLine text={line.text ?? ''} loading={line.loading} onPress={onScoutLine} /> : null}

          {rail.length ? (
            <View style={styles.rail}>
              <DayRail items={rail} onPress={(id) => openBlock(tripId, id)} />
            </View>
          ) : null}

          {/* Lluvia o propuestas: fila compacta arriba del protagonista (no queda tapada por el dock). */}
          {notice && notice.kind !== 'offline' ? <InlineNotice notice={notice} onPress={onNotice} /> : null}

          {jobActive ? <AgentJobProgress tripId={tripId} showSkeleton={false} /> : null}

          {protagonist}
          {nextRow}
        </ScrollView>
        <ActionToast bottom={DOCK_SPACE + space.sm} />
        {dock}
        {hero.kind === 'leave' ? (
          <LateSheet
            visible={lateOpen}
            blockTitle={hero.next.block.title}
            lateByMin={lateBy}
            onNotify={() => void onNotifyLate()}
            onShift={onShiftLate}
            onDirections={() => {
              setLateOpen(false);
              const b = hero.next.block;
              if (hasCoords(b)) openDirections(b);
            }}
            onClose={() => setLateOpen(false)}
            notifying={notify === 'notifying'}
            notified={notify === 'notified'}
          />
        ) : null}
      </View>
    </TextBoost.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  headerText: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  sim: {
    fontSize: font.tiny,
    fontWeight: '700',
    color: '#8A5A00',
    backgroundColor: '#FFF3D6',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  // El riel va de borde a borde (su propio padding lateral).
  rail: { marginHorizontal: -space.lg },
});
