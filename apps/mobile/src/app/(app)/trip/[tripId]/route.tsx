// "Cómo llego" embebido (docs/AHORA-V2.md): la ruta adentro de la app con Google Routes (route_eta { detail: true }).
// Arriba el mapa (ruta, yo en vivo vía LocationProvider, destino); abajo modo (A pie · Transporte · Auto), "Llegás 15:52",
// la próxima indicación (o la línea de tiempo del transporte) y "Abrir en" Apple Maps · Google Maps · Waze (CarPlay).
// Params: block_id (destino = bloque; muestra "Salí en X" como Ahora) o lat/lng/name. Se abre con features/route/nav.openRoute.
// Deep link dev (solo __DEV__): build101://trip/<id>/route?lat=..&lng=..&sim=walk[&x=5] → el GPS simulado recorre la ruta a pie.
import { synthesizeTrack, zonedParts, type RouteMode, type SimSpeed } from '@build101/shared';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNow } from '../../../../features/now/clock';
import { blockWindow, hasCoords, resolveToday, tripTimeZone } from '../../../../features/now/selectors';
import { useMe, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import {
  defaultMode,
  hasTransitTimes,
  headline,
  nextInstruction,
  transitTimeline,
} from '../../../../features/route/model';
import { openInApp } from '../../../../features/route/nav';
import { useRouteDetails } from '../../../../features/route/queries';
import { RouteMap } from '../../../../features/route/RouteMap';
import {
  ArrivedCard,
  ModeSelector,
  NextInstructionCard,
  OpenInRow,
  StepsList,
  TransitTimeline,
  type ModeEta,
} from '../../../../features/route/ui';
import { useRouteNav } from '../../../../features/route/useRouteNav';
import { showToast } from '../../../../features/plan/store';
import { useTripId } from '../../../../features/trips/TripContext';
import { useTrip } from '../../../../features/trips/queries';
import { useLocationFix, useLocationProvider } from '../../../../location/LocationContext';
import { Button } from '../../../../ui/Button';
import { BackIcon } from '../../../../ui/icons';
import { Skeleton } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../../ui/theme';

type Params = { block_id?: string; lat?: string; lng?: string; name?: string; sim?: string; x?: string };
type LatLng = { lat: number; lng: number };

/** Mientras no hay destino (los hooks corren igual). */
const NO_DEST: LatLng = { lat: 0, lng: 0 };
const SIM_X: Record<string, SimSpeed> = { '1': 1, '2': 2, '5': 5, '10': 10 };

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function num(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pantalla encendida mientras caminás (expo-keep-awake ya está en el dev build). */
function KeepAwake() {
  useKeepAwake('route-nav');
  return null;
}

export default function RouteScreen() {
  const tripId = useTripId();
  const params = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const me = useMe();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);

  // ───────── Destino: bloque (con hora) o lat/lng
  const block = params.block_id ? (blocks.data?.find((b) => b.id === params.block_id) ?? null) : null;
  const pLat = num(params.lat);
  const pLng = num(params.lng);
  const dest = useMemo<LatLng | null>(() => {
    if (block && hasCoords(block)) return { lat: block.lat, lng: block.lng };
    if (pLat != null && pLng != null) return { lat: pLat, lng: pLng };
    return null;
  }, [block, pLat, pLng]);
  const name = params.name || block?.place_name || block?.title || 'tu destino';
  const waitingBlock = !dest && !!params.block_id && blocks.isPending;

  // ───────── Ubicación (siempre vía LocationProvider: real o simulada)
  const location = useLocationProvider();
  const fix = useLocationFix();
  const [locError, setLocError] = useState<Error | null>(null);
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (location.active || tried.current === location.kind) return;
    tried.current = location.kind;
    void location.start().then(setLocError);
  }, [location]);
  const askLocation = () => void location.start().then(setLocError);

  // Origen fijo (primer fix); cambia solo al recalcular por salirte de la ruta.
  const [origin, setOrigin] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!origin && fix) setOrigin({ lat: fix.lat, lng: fix.lng });
  }, [origin, fix]);

  // ───────── Rutas (las 3) y modo
  const routes = useRouteDetails(origin, dest);
  const [picked, setPicked] = useState<RouteMode | null>(__DEV__ && params.sim === 'walk' ? 'walk' : null);
  const walkMin = routes.walk.data?.duration_min;
  const mode: RouteMode = picked ?? (routes.walk.isError ? 'transit' : defaultMode(walkMin));
  const current = routes[mode];
  const detail = current.data ?? null;
  const etas = useMemo(
    () =>
      Object.fromEntries(
        (['walk', 'transit', 'car'] as const).map((m) => [
          m,
          { min: routes[m].data?.duration_min ?? null, loading: routes[m].isPending, failed: routes[m].isError } satisfies ModeEta,
        ]),
      ) as Record<RouteMode, ModeEta>,
    [routes],
  );
  const onMode = (m: RouteMode) => {
    if (m === mode) return;
    void Haptics.selectionAsync().catch(() => {});
    setPicked(m);
  };

  const nav = useRouteNav({
    detail,
    mode,
    origin,
    dest: dest ?? NO_DEST,
    fix,
    onReroute: (here) => {
      showToast({ text: 'Recalculando la ruta…', tone: 'info' });
      setOrigin(here);
    },
  });
  const { progress, arrived } = nav;

  // ───────── Hora del viaje → "Llegás 15:52" y "Salí en X" (si el destino es un bloque de hoy con hora)
  const { now } = useNow(30_000);
  const legs = overview.data?.legs;
  const nowMin = useMemo(() => zonedParts(now, tripTimeZone(legs ?? [], me, now)).minutes, [legs, me, now]);
  const startMin = useMemo(() => {
    if (!block || !overview.data) return null;
    const today = resolveToday(overview.data.legs, me, now, trip.data);
    if (today.kind !== 'today' || block.day_id !== today.day.id) return null;
    return blockWindow(block)?.start ?? null;
  }, [block, overview.data, me, now, trip.data]);
  const etaMin = progress?.remainingMin ?? detail?.duration_min ?? null;
  const distM = progress ? progress.remainingM : (detail?.distance_m ?? 0);
  const head = detail && etaMin != null ? headline({ nowMin, etaMin, distanceM: distM, startMin }) : null;

  const next =
    detail && progress && mode !== 'transit'
      ? nextInstruction({ steps: detail.steps, stepIndex: progress.stepIndex, distanceToStepEndM: progress.distanceToStepEndM, destName: name })
      : null;
  const timeline = useMemo(() => (detail && mode === 'transit' ? transitTimeline(detail.steps) : []), [detail, mode]);

  // ───────── Dev: ?sim=walk → el GPS simulado recorre la polilínea a pie
  const simStarted = useRef(false);
  useEffect(() => {
    if (!__DEV__ || params.sim !== 'walk' || simStarted.current || mode !== 'walk' || !detail || nav.points.length < 2) return;
    simStarted.current = true;
    const [first] = nav.points;
    location.placeSimulatedAt(first.lat, first.lng, 'Ruta a pie (demo)');
    location.simulator.load(synthesizeTrack(nav.points, { speedMps: 1.4, dwellS: 0 }), 'Ruta a pie (demo)');
    location.simulator.setSpeed(SIM_X[params.x ?? ''] ?? 1);
    location.simulator.play();
  }, [params.sim, params.x, mode, detail, nav.points, location]);

  const onOpen = (app: Parameters<typeof openInApp>[0]) => {
    if (!dest) return;
    void openInApp(app, mode, dest).then((ok) => {
      if (!ok) showToast({ text: 'No pudimos abrir esa app.', tone: 'info' });
    });
  };

  const mapH = Math.round(winH * 0.55);
  const routeKey = `${mode}:${origin?.lat ?? ''},${origin?.lng ?? ''}:${detail ? 1 : 0}`;

  // ───────── Sin destino
  if (!dest) {
    return (
      <View style={[styles.flex, styles.center, { paddingTop: insets.top }]}>
        {waitingBlock ? (
          <View style={styles.full} accessibilityLabel="Cargando">
            <Skeleton height={mapH * 0.6} />
            <Skeleton width="60%" height={28} style={{ marginTop: space.lg }} />
            <Skeleton height={52} style={{ marginTop: space.md }} />
          </View>
        ) : (
          <>
            <Text style={styles.bigMsg}>No sabemos a dónde querés ir</Text>
            <Button label="Volver" onPress={goBack} style={styles.full} />
          </>
        )}
      </View>
    );
  }

  const noLocation = !fix && !!locError;
  const waitingFix = !fix && !locError;

  return (
    <View style={styles.flex}>
      {mode === 'walk' && detail && !arrived ? <KeepAwake /> : null}
      <View>
        <RouteMap
          points={nav.points}
          estimated={!detail || detail.estimated}
          fix={fix}
          dest={dest}
          mode={mode}
          routeKey={routeKey}
          height={mapH}
          topInset={insets.top}
        />
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          hitSlop={8}
          style={({ pressed }) => [styles.back, { top: insets.top + space.sm }, pressed && styles.pressed]}
        >
          <BackIcon color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + space.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.toName} numberOfLines={1}>
          Hacia {name}
        </Text>

        {arrived ? (
          <ArrivedCard name={name} onDone={goBack} />
        ) : noLocation ? (
          <View style={styles.box}>
            <Text style={styles.boxTitle}>Activá la ubicación</Text>
            <Text style={styles.boxText}>La necesitamos para armarte la ruta desde donde estás.</Text>
            <Button label="Activar ubicación" onPress={askLocation} style={styles.boxBtn} />
          </View>
        ) : waitingFix || current.isPending ? (
          <View style={styles.loading} accessibilityLabel={waitingFix ? 'Buscando tu ubicación' : 'Calculando la ruta'}>
            <Skeleton width="55%" height={34} />
            <Skeleton width="35%" height={18} />
            <Skeleton height={52} style={{ marginTop: space.sm }} />
            <Skeleton height={84} style={{ marginTop: space.sm }} />
            <Text style={styles.muted}>{waitingFix ? 'Buscando tu ubicación…' : 'Calculando la ruta…'}</Text>
          </View>
        ) : (
          <>
            {head ? (
              <View accessibilityRole="header">
                <View style={styles.headRow}>
                  <Text style={styles.arrive}>{head.arrive}</Text>
                  {head.leave ? (
                    <View style={[styles.leave, head.leave.tone === 'late' ? styles.leaveLate : head.leave.tone === 'soon' ? styles.leaveSoon : null]}>
                      <Text style={[styles.leaveText, head.leave.tone !== 'ok' && styles.leaveTextStrong]}>{head.leave.text}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.sub}>
                  {head.sub}
                  {detail?.estimated ? ' · estimado' : ''}
                </Text>
              </View>
            ) : null}

            <ModeSelector mode={mode} etas={etas} onChange={onMode} />

            {current.isError ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>No pudimos calcular la ruta</Text>
                <Text style={styles.boxText}>Probá de nuevo o abrila en otra app.</Text>
                <Button label="Reintentar" onPress={() => void current.refetch()} style={styles.boxBtn} />
              </View>
            ) : mode === 'transit' && detail ? (
              <TransitTimeline items={timeline} estimatedTimes={!hasTransitTimes(detail.steps)} />
            ) : next && detail ? (
              <>
                <NextInstructionCard next={next} />
                <StepsList steps={detail.steps} current={progress?.stepIndex ?? 0} />
              </>
            ) : null}
          </>
        )}

        <OpenInRow mode={mode} onOpen={onOpen} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  full: { alignSelf: 'stretch' },
  pressed: { opacity: 0.8 },
  bigMsg: { fontSize: font.h3, fontWeight: '600', color: colors.text, textAlign: 'center' },
  back: {
    position: 'absolute',
    left: space.md,
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sheet: {
    flex: 1,
    marginTop: -radius.lg,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetContent: { padding: space.lg, gap: space.md },
  toName: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  headRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  arrive: { fontSize: font.title, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.body, color: colors.textMuted, marginTop: 2 },
  leave: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, backgroundColor: colors.surfaceMuted },
  leaveSoon: { backgroundColor: colors.khakiLight },
  leaveLate: { backgroundColor: colors.dangerBg },
  leaveText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  leaveTextStrong: { fontWeight: '700' },
  loading: { gap: space.sm },
  muted: { fontSize: font.small, color: colors.textMuted },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  boxTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  boxText: { fontSize: font.body, color: colors.textMuted },
  boxBtn: { marginTop: space.sm },
});
