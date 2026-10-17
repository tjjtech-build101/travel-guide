// "Cómo llego" embebido (docs/AHORA-V2.md): la ruta adentro de la app con Google Routes (route_eta { detail: true }).
// Arriba el mapa (ruta, yo en vivo vía LocationProvider, destino); abajo modo (A pie · Transporte · Auto), "Llegás 15:52",
// la próxima indicación (o la línea de tiempo del transporte) y "Abrir en" Apple Maps · Google Maps · Waze (CarPlay).
// Params: block_id (destino = bloque; muestra "Salí en X" como Ahora) o lat/lng/name. Se abre con features/route/nav.openRoute.
// Deep link dev (solo __DEV__): build101://trip/<id>/route?lat=..&lng=..&sim=walk[&x=5] → el GPS simulado recorre la ruta a pie.
import { leaveInMin, synthesizeTrack, zonedParts, type RouteMode, type SimSpeed } from '@build101/shared';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appNow, useNow } from '../../../../features/now/clock';
import { blockWindow, hasCoords, resolveToday, tripTimeZone } from '../../../../features/now/selectors';
import { useMe, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import {
  defaultMode,
  EXTERNAL_LABEL,
  hasTransitTimes,
  headline,
  nextInstruction,
  transitTimeline,
} from '../../../../features/route/model';
import { openInApp } from '../../../../features/route/nav';
import { useRouteDetail, useRouteMinutes } from '../../../../features/route/queries';
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

/** departure_time del transporte: ISO al minuto. */
const isoMinute = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();

/**
 * La ruta es una tab oculta y las tabs quedan montadas: sin foco no se renderiza nada (así no queda la pantalla
 * encendida, ni GPS → recálculos → Google, ni el mapa moviéndose detrás de Ahora). Cada vez que se abre (o cambia el
 * destino) arranca de cero, así el origen es donde estás ahora y no donde estabas la vez anterior.
 */
export default function RouteScreen() {
  const params = useLocalSearchParams<Params>();
  const focused = useIsFocused();
  if (!focused) return null;
  return <RouteView key={`${params.block_id ?? ''}:${params.lat ?? ''}:${params.lng ?? ''}:${params.sim ?? ''}`} />;
}

function RouteView() {
  const tripId = useTripId();
  // Volver siempre a Ahora: la ruta es una tab oculta y el "atrás" de las tabs iría a Planificación.
  const goBack = () => router.navigate({ pathname: '/trip/[tripId]/now', params: { tripId } });
  // El atrás de Android también vuelve a Ahora (el de las tabs iría a Planificación).
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);
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
  // Si en 8 s no llega ningún fix (sin señal, GPS apagado), no dejamos el "Buscando…" para siempre.
  const [fixSlow, setFixSlow] = useState(false);
  const hasFix = !!fix;
  useEffect(() => {
    setFixSlow(false);
    if (hasFix) return;
    const t = setTimeout(() => setFixSlow(true), 8_000);
    return () => clearTimeout(t);
  }, [hasFix]);
  const askLocation = () => {
    setFixSlow(false);
    void location.start().then(setLocError);
  };

  // Origen fijo (primer fix); cambia solo al recalcular por salirte de la ruta. `startOrigin` (el de la apertura) es
  // el de los minutos de los otros modos: un recálculo no los vuelve a pedir.
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [startOrigin, setStartOrigin] = useState<LatLng | null>(null);
  useEffect(() => {
    if (origin || !fix) return;
    setOrigin({ lat: fix.lat, lng: fix.lng });
    setStartOrigin({ lat: fix.lat, lng: fix.lng });
  }, [origin, fix]);

  // Salida para los horarios del transporte, con el reloj del viaje (no el del servidor). Arranca en "ahora" y, si el
  // destino es un bloque con "Salí en X", se corre una vez a esa salida para que la línea sea la que vas a tomar.
  const [depart, setDepart] = useState(() => isoMinute(appNow()));

  // ───────── Ruta del modo elegido (con detalle) y minutos de los otros (sin detalle)
  const [picked, setPicked] = useState<RouteMode | null>(__DEV__ && params.sim === 'walk' ? 'walk' : null);
  const [known, setKnown] = useState<Partial<Record<RouteMode, number>>>({});
  const [walkFailed, setWalkFailed] = useState(false);
  const mode: RouteMode = picked ?? (walkFailed ? 'transit' : defaultMode(known.walk));
  const current = useRouteDetail(origin, dest, mode, depart);
  const detail = current.data ?? null;
  useEffect(() => {
    if (current.isError && mode === 'walk' && !picked) setWalkFailed(true);
    if (!current.data || current.isPlaceholderData) return;
    const min = current.data.duration_min;
    setKnown((k) => (k[mode] === min ? k : { ...k, [mode]: min }));
  }, [current.data, current.isPlaceholderData, current.isError, mode, picked]);
  // Los otros modos recién cuando el modo inicial está decidido (si no, se pedirían de más).
  const settled = picked != null || walkFailed || known.walk != null;
  const minutes = useRouteMinutes(startOrigin, dest, (m) => !settled || m === mode || known[m] != null, depart);
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
  // En el selector, el modo activo muestra lo mismo que el encabezado (lo que falta); los otros, su duración.
  const etas = Object.fromEntries(
    (['walk', 'transit', 'car'] as const).map((m) => [
      m,
      (m === mode
        ? { min: etaMin, loading: current.isPending, failed: current.isError }
        : { min: known[m] ?? minutes[m].data ?? null, loading: minutes[m].isPending, failed: minutes[m].isError }) satisfies ModeEta,
    ]),
  ) as Record<RouteMode, ModeEta>;

  const refined = useRef(false);
  useEffect(() => {
    if (refined.current || mode !== 'transit' || !detail || current.isPlaceholderData || startMin == null) return;
    refined.current = true;
    const leaveIn = Math.round(leaveInMin(startMin, nowMin, detail.duration_min));
    if (leaveIn >= 5) setDepart(isoMinute(now + leaveIn * 60_000));
  }, [mode, detail, current.isPlaceholderData, startMin, nowMin, now]);
  const distM = progress ? progress.remainingM : (detail?.distance_m ?? 0);
  // Ya en camino (más de 50 m recorridos), "Salí en X" deja de tener sentido: queda solo "Llegás".
  const underway = (progress?.alongM ?? 0) > 50;
  const head = detail && etaMin != null ? headline({ nowMin, etaMin, distanceM: distM, startMin: underway ? null : startMin }) : null;

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
    void openInApp(app, mode, dest).then((how) => {
      if (!how) showToast({ text: 'No pudimos abrir esa app.', tone: 'info' });
      else if (how === 'web' && app !== 'apple') showToast({ text: `${EXTERNAL_LABEL[app]} no está instalada: la abrimos en el navegador.`, tone: 'info' });
    });
  };

  const mapH = Math.round(winH * 0.46);
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

  const noLocation = !fix && (!!locError || fixSlow);
  const waitingFix = !fix && !noLocation;
  /** Se ve el contenido principal (modo, indicación…), no un estado de carga/llegada/sin ubicación. */
  const showMain = !arrived && !noLocation && !(waitingFix || current.isPending);

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
        <Text style={styles.toName} numberOfLines={2} accessibilityLabel={`Hacia ${name}`}>
          {name}
        </Text>

        {arrived ? (
          <ArrivedCard name={name} onDone={goBack} />
        ) : noLocation ? (
          <View style={styles.box}>
            <Text style={styles.boxTitle}>{locError ? 'Activá la ubicación' : 'No encontramos dónde estás'}</Text>
            <Text style={styles.boxText}>
              {locError
                ? 'La necesitamos para armarte la ruta desde donde estás.'
                : 'Probá de nuevo en un rato o abrí la ruta en otra app.'}
            </Text>
            <Button label={locError ? 'Activar ubicación' : 'Reintentar'} onPress={askLocation} style={styles.boxBtn} />
          </View>
        ) : waitingFix ? (
          // Corto a propósito: "Abrir en" queda a la vista por si el GPS tarda.
          <View style={styles.loading} accessibilityLabel="Buscando tu ubicación">
            <Skeleton width="55%" height={34} />
            <Text style={styles.muted}>Buscando tu ubicación…</Text>
          </View>
        ) : current.isPending ? (
          <View style={styles.loading} accessibilityLabel="Calculando la ruta">
            <Skeleton width="55%" height={34} />
            <Skeleton width="35%" height={18} />
            <Skeleton height={52} style={{ marginTop: space.sm }} />
            <Skeleton height={84} style={{ marginTop: space.sm }} />
            <Text style={styles.muted}>Calculando la ruta…</Text>
          </View>
        ) : (
          <>
            {head ? (
              <View accessibilityRole="header">
                <View style={styles.headRow}>
                  <Text style={styles.arrive}>{head.title}</Text>
                  {head.leave ? (
                    <View style={[styles.leave, head.leave.tone === 'late' ? styles.leaveLate : styles.leaveSoon]}>
                      <Text style={[styles.leaveText, styles.leaveTextStrong]}>{head.leave.text}</Text>
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

            {/* En auto lo primero es pasar a la app de mapas (CarPlay): arriba, a mano. */}
            {mode === 'car' ? <OpenInRow mode={mode} onOpen={onOpen} /> : null}

            {current.isError ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>No pudimos calcular la ruta</Text>
                <Text style={styles.boxText}>Probá de nuevo o abrila en otra app.</Text>
                <Button label="Reintentar" onPress={() => void current.refetch()} style={styles.boxBtn} />
              </View>
            ) : mode === 'transit' && detail?.estimated ? (
              // Sin Google no hay líneas ni horarios: mejor decirlo que inventar un "Caminá 3 km".
              <View style={styles.box}>
                <Text style={styles.boxTitle}>Sin líneas por ahora</Text>
                <Text style={styles.boxText}>No pudimos traer las líneas y horarios. Abrilo en Google Maps para verlos.</Text>
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

        {/* Ya llegaste: "Abrir en" sería ruido. */}
        {arrived || (mode === 'car' && showMain) ? null : <OpenInRow mode={mode} onOpen={onOpen} />}
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
  toName: { fontSize: font.h3, fontWeight: '700', color: colors.text },
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
