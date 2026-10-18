// Tab Mapa (PRD 03, 2D primero): el recorrido que viene (tramos del viaje, bloques del día y paradas de tour).
// Mapa casi a pantalla completa + hoja deslizable que arranca chica ("peek") con Ahora / Próximo; arriba de todo
// la lista del día como sendero (MapTimeline). Tocar cualquier elemento → tarjeta compacta con el Scout
// ("Hablar") → useScout().startScoutCall({ focus }). Un solo Scout a la vista: el flotante se esconde.
// ▶ "Ver el día": el Scout camina de parada en parada contando un gancho de cada una (guion en model.previewSteps).
// Sin EXPO_PUBLIC_MAPBOX_TOKEN no se monta Mapbox: aviso + la misma lista de puntos (todo lo demás funciona igual).
import { SCOUT } from '@build101/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import {
  buildMapModel,
  chipDay,
  citySeparators,
  dayOptions,
  defaultDayId,
  focusForCoordinate,
  focusForPoint,
  previewSteps,
  sameish,
  timelineStatus,
  walkMinutes,
  type MapPoint,
  type MapScope,
  type PreviewStep,
} from '../../../../features/map/model';
import { MapTimeline } from '../../../../features/map/MapTimeline';
import { useMapTours } from '../../../../features/map/queries';
import { useNow } from '../../../../features/now/clock';
import { localParts, resolveToday, tzOffsetMin } from '../../../../features/now/selectors';
import { openBlock } from '../../../../features/plan/nav';
import { useMe, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import { shortDay } from '../../../../features/plan/selectors';
import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail } from '../../../../features/trips/queries';
import { env } from '../../../../lib/env';
import { useLocationFix, useLocationProvider } from '../../../../location/LocationContext';
import { Button } from '../../../../ui/Button';
import { ErrorNotice } from '../../../../ui/ErrorNotice';
import { useGuide } from '../../../../features/guide/useGuide';
import { ScoutAvatar } from '../../../../ui/ScoutAvatar';
import { EmptyState, ErrorState, LoadingList } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { useScout } from '../../../../voice/useScout';
import { useFloatingScout } from '../../../../voice/ui/FloatingVoiceButton';

const HAS_TOKEN = !!env.mapboxToken;
// Alturas de la hoja: chica (título + ahora/próximo o el lugar elegido), a la mitad y casi completa.
// Arranca chica: si entraste al Mapa es para ver el mapa.
const SNAP_FRACTIONS = [0.27, 0.55, 0.9] as const;
const SNAP_POINTS = SNAP_FRACTIONS.map((f) => `${f * 100}%`);
// ▶ Ver el día: cuánto se queda en cada escena (el vuelo dura ~1,8 s).
const STEP_MS = { intro: 3200, stop: 3600 } as const;

export default function MapTab() {
  const tripId = useTripId();
  const me = useMe();
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const { now } = useNow(60_000);
  const scout = useScout();
  const location = useLocationProvider();
  const fix = useLocationFix();
  const setFloatingHidden = useFloatingScout((s) => s.setHidden);
  useGuide('map');

  // Mi posición en el mapa: se pide al abrir el Mapa (momento justo). Si la niegan, el mapa funciona igual.
  const { start, active } = location;
  useFocusEffect(
    useCallback(() => {
      if (!active) void start();
    }, [active, start]),
  );

  const legs = overview.data?.legs ?? [];
  const options = useMemo(() => dayOptions(legs), [legs]);
  const today = useMemo(() => resolveToday(legs, me, now), [legs, me, now]);
  const todayDate = today.kind === 'noLegs' ? localParts(now, tzOffsetMin('UY')).date : today.date;
  const initialDay = defaultDayId(options, todayDate, today.kind === 'today' ? today.day.id : null);

  const [scope, setScope] = useState<MapScope | null>(null);
  // Deep link (pruebas y demo): ?day=2026-10-18 abre ese día · ?day=trip el viaje entero · &play=1 arranca el ▶.
  const link = useLocalSearchParams<{ day?: string; play?: string }>();
  useEffect(() => {
    if (!link.day) return;
    if (link.day === 'trip') setScope({ kind: 'trip' });
    else {
      const o = options.find((x) => x.date === link.day);
      if (o) setScope({ kind: 'day', dayId: o.dayId });
    }
  }, [link.day, options]);
  const effectiveScope: MapScope = scope ?? (initialDay ? { kind: 'day', dayId: initialDay } : { kind: 'trip' });

  const tourIds = useMemo(
    () =>
      effectiveScope.kind === 'day'
        ? (blocks.data ?? []).filter((b) => b.day_id === effectiveScope.dayId && b.tour_id && !b.masked).map((b) => b.tour_id!)
        : [],
    [blocks.data, effectiveScope],
  );
  const tours = useMapTours(tourIds);

  const model = useMemo(
    () => buildMapModel({ legs, blocks: blocks.data ?? [], tours: tours.data ?? [], scope: effectiveScope }),
    [legs, blocks.data, tours.data, effectiveScope],
  );

  const [selected, setSelected] = useState<MapPoint | null>(null);
  const sheet = useRef<BottomSheet>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [areaHeight, setAreaHeight] = useState(0);
  const [recenterTick, setRecenterTick] = useState(0);
  const [preview, setPreview] = useState<{ steps: PreviewStep[]; index: number } | null>(null);
  const scopeKey = effectiveScope.kind === 'day' ? effectiveScope.dayId : 'trip';
  useEffect(() => {
    setSelected(null);
    setPreview(null);
  }, [scopeKey]);

  // Un solo Scout a la vista: con un lugar elegido o en el ▶, el flotante se esconde (solo mientras el Mapa está enfocado).
  const ownScout = !!selected || !!preview;
  useFocusEffect(
    useCallback(() => {
      setFloatingHidden(ownScout);
      return () => setFloatingHidden(false);
    }, [ownScout, setFloatingHidden]),
  );

  // ▶: avanzar solo, escena por escena (se corta con un toque).
  useEffect(() => {
    if (!preview) return;
    const step = preview.steps[preview.index];
    if (!step || step.kind === 'outro') return;
    if (step.kind === 'stop') void Haptics.selectionAsync().catch(() => {});
    const t = setTimeout(
      () => setPreview((p) => (p ? { ...p, index: Math.min(p.index + 1, p.steps.length - 1) } : p)),
      step.kind === 'intro' ? STEP_MS.intro : STEP_MS.stop,
    );
    return () => clearTimeout(t);
  }, [preview]);

  const talk = (focus: ReturnType<typeof focusForPoint>, context?: Record<string, unknown>) => {
    void scout.startScoutCall({ focus, tripId, mode: 'chat', context });
  };

  const talkAbout = (p: MapPoint) => {
    const block = p.blockId ? blocks.data?.find((b) => b.id === p.blockId) : undefined;
    talk(focusForPoint(p), {
      source: 'map',
      kind: p.kind,
      title: p.label,
      detail: p.sublabel,
      ...(block
        ? {
            block: {
              id: block.id,
              type: block.type,
              title: block.title,
              start_time: block.start_time,
              end_time: block.end_time,
              place_name: block.place_name,
              description: block.description,
            },
          }
        : {}),
    });
  };

  // &play=1 en el deep link: arrancar el ▶ apenas haya puntos (para la demo).
  const autoPlayed = useRef(false);

  if (overview.isPending || blocks.isPending) return <LoadingList count={3} />;
  if (overview.isError || blocks.isError) {
    return (
      <ErrorState
        message="No pudimos cargar el mapa del viaje"
        detail={errorDetail(overview.error ?? blocks.error)}
        error={overview.error ?? blocks.error}
        doing="cargar el plan del viaje"
        onRetry={() => {
          void overview.refetch();
          void blocks.refetch();
        }}
      />
    );
  }
  if (!legs.length) {
    return (
      <EmptyState
        title="Todavía no hay lugares"
        subtitle={`Contale a ${SCOUT.name} tu viaje y acá vas a ver el recorrido.`}
      />
    );
  }

  const busy = scout.state === 'connecting' || scout.state === 'thinking';
  const isToday = effectiveScope.kind === 'day' && today.kind === 'today' && today.day.id === effectiveScope.dayId;
  const status = isToday && today.kind === 'today' ? timelineStatus(model.points, today.minutes) : new Map();
  const dayOption = effectiveScope.kind === 'day' ? options.find((o) => o.dayId === (effectiveScope as { dayId: string }).dayId) : null;
  const parallel = !!dayOption && options.filter((o) => o.date === dayOption.date).length > 1;
  const dayTitle = dayOption ? `${isToday ? 'Hoy · ' : ''}${shortDay(dayOption.date)}${parallel ? ` · ${dayOption.label.split(' · ')[1] ?? ''}` : ''}` : '';
  const sheetTitle = effectiveScope.kind === 'trip' ? 'Todo el viaje' : dayTitle;
  const places = model.points.filter((p) => p.kind !== 'stop');
  const stopCount = model.points.length - places.length;
  const sheetCount =
    effectiveScope.kind === 'trip'
      ? `${places.length} ${places.length === 1 ? 'ciudad' : 'ciudades'}`
      : `${places.length} ${places.length === 1 ? 'lugar' : 'lugares'}${stopCount ? ` · ${stopCount} paradas` : ''}`;
  const bottomInset = areaHeight * SNAP_FRACTIONS[Math.min(sheetIndex, 1)];
  const nowPoint = places.find((p) => status.get(p.id) === 'now') ?? null;
  const nextPoint = places.find((p) => status.get(p.id) === 'next') ?? null;
  const steps = effectiveScope.kind === 'day' ? previewSteps(model.points, tours.data ?? [], dayTitle) : [];
  const canPlay = HAS_TOKEN && steps.length > 0;
  const step = preview ? preview.steps[preview.index] : null;

  const select = (p: MapPoint) => {
    setSelected(p);
    // La tarjeta vive en la hoja chica: solo bajarla si estaba casi completa (que el punto quede a la vista).
    if (sheetIndex === 2) sheet.current?.snapToIndex(0);
  };

  const play = () => {
    if (!steps.length) return;
    setSelected(null);
    sheet.current?.snapToIndex(0);
    setPreview({ steps, index: 0 });
  };
  const stopPreview = () => setPreview(null);
  if (link.play === '1' && !autoPlayed.current && canPlay && !preview) {
    autoPlayed.current = true;
    setTimeout(play, 800);
  }

  const minutesTo = (p: MapPoint) => (fix ? walkMinutes(fix, p) : null);

  return (
    <View style={styles.flex}>
      <ScopeBar
        options={options}
        scope={effectiveScope}
        onChange={(s) => setScope(s)}
        todayDayId={today.kind === 'today' ? today.day.id : null}
        legCity={(id) => legs.find((l) => l.id === id)?.city ?? ''}
      />

      <View style={styles.flex} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
        {HAS_TOKEN ? (
          <LazyMap
            model={model}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onDeselect={() => setSelected(null)}
            onLongPress={(lat, lng) => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              talk(focusForCoordinate(lat, lng), { source: 'map', kind: 'coordinate' });
            }}
            bottomInset={bottomInset}
            status={status}
            next={nextPoint}
            recenterTick={recenterTick}
            preview={preview ? { target: step?.kind === 'stop' ? step.point : null } : null}
          />
        ) : (
          <View style={styles.tokenBanner}>
            <Text style={styles.tokenTitle}>Falta EXPO_PUBLIC_MAPBOX_TOKEN</Text>
            <Text style={styles.tokenBody}>
              El mapa aparece cuando se cargue el token en apps/mobile/.env. Mientras tanto, tocá cualquier lugar de la lista
              para hablar con {SCOUT.name}.
            </Text>
          </View>
        )}

        {HAS_TOKEN && !preview ? (
          <View style={[styles.mapButtons, { bottom: bottomInset + space.md }]} pointerEvents="box-none">
            {canPlay ? (
              <Pressable
                onPress={play}
                accessibilityRole="button"
                accessibilityLabel={`Ver el día con ${SCOUT.name}`}
                style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}
              >
                <PlayIcon />
                <Text style={styles.playText}>Ver el día</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setRecenterTick((n) => n + 1)}
              accessibilityRole="button"
              accessibilityLabel="Centrar en mi ubicación"
              style={({ pressed }) => [styles.roundBtn, pressed && styles.pressed]}
            >
              <LocateIcon />
            </Pressable>
          </View>
        ) : null}

        <BottomSheet
          ref={sheet}
          index={0}
          snapPoints={SNAP_POINTS}
          onChange={setSheetIndex}
          backgroundStyle={styles.sheetBg}
          handleIndicatorStyle={styles.sheetHandle}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {sheetTitle}
            </Text>
            <Text style={styles.muted}>{sheetCount}</Text>
          </View>

          <View style={styles.peek}>
            {selected ? (
              <SelectedCard
                point={selected}
                minutes={minutesTo(selected)}
                busy={busy}
                scoutState={scout.state}
                onTalk={() => talkAbout(selected)}
                onClose={() => setSelected(null)}
                onOpen={
                  selected.kind === 'block' && selected.blockId
                    ? { label: 'Ver en el plan', run: () => openBlock(tripId, selected.blockId!) }
                    : selected.kind === 'leg' && selected.legId
                      ? {
                          label: 'Ver sus días',
                          run: () => {
                            const first = options.find((o) => o.legId === selected.legId);
                            if (first) setScope({ kind: 'day', dayId: first.dayId });
                          },
                        }
                      : null
                }
              />
            ) : (
              <Summary
                scope={effectiveScope}
                isToday={isToday}
                places={places}
                nowPoint={nowPoint}
                nextPoint={nextPoint}
                minutesTo={minutesTo}
                canPlay={canPlay}
                onPress={select}
              />
            )}
          </View>

          <BottomSheetScrollView contentContainerStyle={styles.listContent}>
            {model.unlocated.length ? <Text style={styles.chipInfo}>{model.unlocated.length} sin ubicación</Text> : null}
            {model.points.length === 0 && !(tourIds.length > 0 && tours.isPending) ? (
              <EmptyState
                pose="map"
                title={effectiveScope.kind === 'day' ? 'Este día no tiene lugares en el mapa' : 'Los tramos no tienen ubicación'}
                subtitle={`Pedile a ${SCOUT.name} un tour y te armo el recorrido.`}
              />
            ) : null}
            <MapTimeline points={model.points} selectedId={selected?.id ?? null} status={status} onPress={select} />
            {tourIds.length > 0 && tours.isPending ? <Text style={styles.muted}>Cargando las paradas del tour…</Text> : null}
            {tours.isError ? (
              <ErrorNotice error={tours.error} doing="cargar las paradas del tour" onRetry={() => void tours.refetch()} retrying={tours.isFetching} />
            ) : null}
          </BottomSheetScrollView>
        </BottomSheet>

        {preview && step ? (
          <>
            {/* Un toque en el mapa corta el recorrido. */}
            <Pressable
              style={[StyleSheet.absoluteFill, { bottom: bottomInset }]}
              onPress={stopPreview}
              accessibilityRole="button"
              accessibilityLabel="Cortar el recorrido"
            />
            <PreviewCard
              step={step}
              index={preview.index}
              total={preview.steps.length}
              height={areaHeight * SNAP_FRACTIONS[0]}
              onStop={stopPreview}
              onTalk={() => {
                stopPreview();
                talk({ label: `El día ${sheetTitle}` }, { source: 'map_preview', day: sheetTitle, places: places.map((p) => p.label) });
              }}
              onReplay={play}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

/** El lugar elegido, compacto: número, título, hora · a pie · "Ver en el plan ›", el Scout y ✕. */
function SelectedCard({
  point,
  minutes,
  busy,
  scoutState,
  onTalk,
  onClose,
  onOpen,
}: {
  point: MapPoint;
  minutes: number | null;
  busy: boolean;
  scoutState: ReturnType<typeof useScout>['state'];
  onTalk: () => void;
  onClose: () => void;
  onOpen: { label: string; run: () => void } | null;
}) {
  // Sin repetir: el lugar solo si no está ya en el título ("Visita guiada al Teatro Solís" · "Teatro Solís").
  const meta =
    point.kind === 'block'
      ? [point.start, point.place && !sameish(point.place, point.label) ? point.place : null, minutes ? `${minutes} min a pie` : null]
      : [point.sublabel, minutes ? `${minutes} min a pie` : null];
  const metaText = meta.filter(Boolean).join(' · ');
  return (
    <View style={styles.card}>
      <Badge point={point} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {point.label}
        </Text>
        <View style={styles.cardMetaRow}>
          {metaText ? (
            <Text style={[styles.muted, { flexShrink: 1 }]} numberOfLines={1}>
              {metaText}
            </Text>
          ) : null}
          {onOpen ? (
            <Pressable onPress={onOpen.run} accessibilityRole="link" hitSlop={8}>
              <Text style={styles.link}>{onOpen.label} ›</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Pressable
        onPress={onTalk}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Hablar con ${SCOUT.name} de esto`}
        accessibilityState={{ busy }}
        hitSlop={8}
        style={({ pressed }) => [styles.talk, pressed && styles.pressed]}
      >
        <ScoutAvatar size={36} state={scoutState} />
        <Text style={styles.talkText}>Hablar</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} style={styles.close}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Lo que importa sin abrir la hoja: ahora y próximo (hoy), por dónde arranca (otro día) o las ciudades (viaje). */
function Summary({
  scope,
  isToday,
  places,
  nowPoint,
  nextPoint,
  minutesTo,
  canPlay,
  onPress,
}: {
  scope: MapScope;
  isToday: boolean;
  places: MapPoint[];
  nowPoint: MapPoint | null;
  nextPoint: MapPoint | null;
  minutesTo: (p: MapPoint) => number | null;
  canPlay: boolean;
  onPress: (p: MapPoint) => void;
}) {
  if (scope.kind === 'trip') {
    return <Text style={styles.hint}>Tocá una ciudad para ver sus días.</Text>;
  }
  if (!places.length) return null;
  const rows: { tag: string; point: MapPoint; strong: boolean }[] = [];
  if (isToday) {
    if (nowPoint) rows.push({ tag: 'Ahora', point: nowPoint, strong: true });
    if (nextPoint) rows.push({ tag: `Próximo${nextPoint.start ? ` ${nextPoint.start}` : ''}`, point: nextPoint, strong: !nowPoint });
    if (!rows.length) return <Text style={styles.hint}>Terminaste el día. ¡Bien ahí!</Text>;
  } else {
    const first = places[0];
    rows.push({ tag: `Arranca${first.start ? ` ${first.start}` : ''}`, point: first, strong: true });
  }
  return (
    <View style={{ gap: 2 }}>
      {rows.map((r) => {
        const min = minutesTo(r.point);
        return (
          <Pressable
            key={r.tag}
            onPress={() => onPress(r.point)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}
          >
            <Text style={[styles.summaryTag, r.strong && styles.summaryTagOn]}>{r.tag}</Text>
            <Text style={styles.summaryLabel} numberOfLines={1}>
              {r.point.label}
            </Text>
            {min && r.tag !== 'Ahora' ? <Text style={styles.muted}>{min} min</Text> : null}
          </Pressable>
        );
      })}
      {!isToday && canPlay ? <Text style={styles.hint}>Tocá «Ver el día» y {SCOUT.name} te lo recorre.</Text> : null}
    </View>
  );
}

/** Globito del Scout durante el ▶: escena actual, progreso y, al final, "Hablar" / "Otra vez" / "Listo". */
function PreviewCard({
  step,
  index,
  total,
  height,
  onStop,
  onTalk,
  onReplay,
}: {
  step: PreviewStep;
  index: number;
  total: number;
  height: number;
  onStop: () => void;
  onTalk: () => void;
  onReplay: () => void;
}) {
  const last = step.kind === 'outro';
  return (
    <View style={[styles.preview, { minHeight: height }]} accessibilityLiveRegion="polite">
      <View style={styles.previewRow}>
        <ScoutAvatar size={52} state={last ? 'idle' : 'speaking'} pose={last ? 'thumbs' : null} />
        <View style={styles.bubble}>
          <Text style={styles.previewTitle} numberOfLines={2}>
            {step.kind === 'stop' && step.point.order ? `${step.point.order}. ` : ''}
            {step.title}
          </Text>
          {step.body ? (
            <Text style={styles.previewBody} numberOfLines={3}>
              {step.body}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.previewFooter}>
        <View style={styles.dots}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.progressDot, i <= index && styles.progressDotOn]} />
          ))}
        </View>
        {last ? (
          <View style={styles.previewActions}>
            <Pressable onPress={onReplay} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Otra vez</Text>
            </Pressable>
            <Pressable onPress={onStop} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.link}>Listo</Text>
            </Pressable>
            <Button label={`Hablar con ${SCOUT.name}`} onPress={onTalk} style={styles.previewTalk} />
          </View>
        ) : (
          <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="Cortar el recorrido" hitSlop={10}>
            <Text style={styles.link}>Cortar ✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PlayIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14">
      <Path d="M3 1.5v11l9.5-5.5z" fill={colors.primaryText} />
    </Svg>
  );
}

function LocateIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={11} r={6} stroke={colors.primary} strokeWidth={2} fill="none" />
      <Circle cx={11} cy={11} r={2.4} fill={colors.primary} />
      <Line x1={11} y1={1} x2={11} y2={4.5} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
      <Line x1={11} y1={17.5} x2={11} y2={21} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
      <Line x1={1} y1={11} x2={4.5} y2={11} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
      <Line x1={17.5} y1={11} x2={21} y2={11} stroke={colors.primary} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Mapbox se carga solo si hay token (sin token ni se importa el módulo nativo). */
function LazyMap(props: React.ComponentProps<typeof import('../../../../features/map/TripMapView').TripMapView>) {
  const Comp = useRef<typeof import('../../../../features/map/TripMapView').TripMapView | null>(null);
  if (!Comp.current) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Comp.current = (require('../../../../features/map/TripMapView') as typeof import('../../../../features/map/TripMapView')).TripMapView;
  }
  const C = Comp.current;
  return <C {...props} />;
}

function ScopeBar({
  options,
  scope,
  onChange,
  todayDayId,
  legCity,
}: {
  options: ReturnType<typeof dayOptions>;
  scope: MapScope;
  onChange: (s: MapScope) => void;
  todayDayId: string | null;
  legCity: (legId: string) => string;
}) {
  // Que el chip elegido quede a la vista (al abrir en "hoy" o por deep link).
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const xs = useRef(new Map<string, number>());
  const selectedKey = scope.kind === 'trip' ? 'trip' : scope.dayId;
  const [laidOut, setLaidOut] = useState(0);
  useEffect(() => {
    const x = selectedKey === 'trip' ? 0 : xs.current.get(selectedKey);
    if (x != null) scroll.current?.scrollTo({ x: Math.max(0, x - space.lg), animated: true });
  }, [selectedKey, laidOut]);
  // Chips cortos ("Hoy", "Lun 19"); la ciudad va como separador solo cuando cambia.
  const seps = citySeparators(options, legCity);
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeBar} style={styles.scopeWrap}>
      <Chip label="Viaje" on={scope.kind === 'trip'} onPress={() => onChange({ kind: 'trip' })} />
      {options.map((o, i) => (
        <View key={o.dayId} style={styles.chipGroup}>
          {seps[i] ? <Text style={styles.citySep}>{seps[i]}</Text> : null}
          <Chip
            onLayout={(x) => {
              xs.current.set(o.dayId, x);
              if (o.dayId === selectedKey) setLaidOut((n) => n + 1);
            }}
            label={o.dayId === todayDayId ? 'Hoy' : chipDay(o.date)}
            color={o.color}
            on={scope.kind === 'day' && scope.dayId === o.dayId}
            onPress={() => onChange({ kind: 'day', dayId: o.dayId })}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  on,
  onPress,
  color,
  onLayout,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  color?: string;
  onLayout?: (x: number) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.x) : undefined}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[styles.chip, on && styles.chipOn]}
    >
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Badge({ point }: { point: MapPoint }) {
  return (
    <View style={[styles.badge, point.kind === 'stop' && styles.badgeStop, { backgroundColor: point.color }]}>
      <Text style={styles.badgeText}>{point.order ?? '•'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scopeWrap: { flexGrow: 0, backgroundColor: colors.bg },
  scopeBar: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.small, color: colors.text, fontWeight: '700' },
  chipTextOn: { color: colors.primaryText },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tokenBanner: {
    margin: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    gap: 4,
  },
  tokenTitle: { color: colors.warningText, fontWeight: '700', fontSize: font.small, fontFamily: 'Menlo' },
  tokenBody: { color: colors.warningText, fontSize: font.small },
  sheetBg: { backgroundColor: colors.bg, borderRadius: 24 },
  sheetHandle: { backgroundColor: colors.khaki, width: 40 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
  },
  peek: { paddingHorizontal: space.md, paddingBottom: space.sm },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  citySep: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted, marginLeft: space.xs },
  mapButtons: { position: 'absolute', right: space.md, alignItems: 'flex-end', gap: space.sm },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.scout,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  playText: { color: colors.scoutText, fontWeight: '800', fontSize: font.small },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
  },
  cardTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { fontSize: font.small, fontWeight: '800', color: colors.primary },
  hint: { fontSize: font.small, color: colors.textMuted, paddingHorizontal: space.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, paddingHorizontal: space.xs },
  summaryTag: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.khakiText,
    backgroundColor: colors.khakiLight,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  summaryTagOn: { backgroundColor: colors.primary, color: colors.primaryText },
  summaryLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  preview: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: space.lg,
    gap: space.md,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  bubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderTopLeftRadius: 4,
    padding: space.md,
    gap: 4,
  },
  previewTitle: { fontSize: font.h3, fontWeight: '600', color: colors.text },
  previewBody: { fontSize: font.small, color: colors.text },
  previewFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  dots: { flexDirection: 'row', gap: 5, flexShrink: 1, flexWrap: 'wrap' },
  progressDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  progressDotOn: { backgroundColor: colors.scout },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  previewTalk: { paddingHorizontal: space.md },
  sheetTitle: { flex: 1, fontSize: font.h2, fontWeight: '600', color: colors.text },
  listContent: { paddingHorizontal: space.md, paddingTop: space.xs, paddingBottom: space.xxl * 3 },
  chipInfo: {
    alignSelf: 'flex-start',
    fontSize: font.tiny,
    color: colors.khakiText,
    backgroundColor: colors.khakiLight,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  muted: { fontSize: font.small, color: colors.textMuted },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  badgeStop: { width: 24, height: 24, borderRadius: 12 },
  badgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: font.tiny },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  talk: { alignItems: 'center' },
  talkText: { fontSize: font.tiny, fontWeight: '800', color: colors.scout },
  pressed: { opacity: 0.7 },
  closeText: { fontSize: 18, color: colors.textMuted },
});
