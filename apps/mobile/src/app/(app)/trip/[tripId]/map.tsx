// Tab Mapa (PRD 03, 2D primero): el recorrido que viene (tramos del viaje, bloques del día y paradas de tour).
// Mapa a pantalla completa + hoja deslizable con la lista del día como sendero (MapTimeline).
// Tocar cualquier elemento → el avatar redondo del Scout ("Hablar") → useScout().startScoutCall({ focus }).
// Sin EXPO_PUBLIC_MAPBOX_TOKEN no se monta Mapbox: aviso + la misma lista de puntos (todo lo demás funciona igual).
import { SCOUT } from '@build101/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  buildMapModel,
  dayOptions,
  defaultDayId,
  focusForCoordinate,
  focusForPoint,
  timelineStatus,
  type MapPoint,
  type MapScope,
} from '../../../../features/map/model';
import { MapTimeline } from '../../../../features/map/MapTimeline';
import { useMapTours } from '../../../../features/map/queries';
import { useNow } from '../../../../features/now/clock';
import { localParts, resolveToday, tzOffsetMin } from '../../../../features/now/selectors';
import { openBlock } from '../../../../features/plan/nav';
import { useMe, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail } from '../../../../features/trips/queries';
import { env } from '../../../../lib/env';
import { useLocationProvider } from '../../../../location/LocationContext';
import { Button } from '../../../../ui/Button';
import { ScoutAvatar } from '../../../../ui/ScoutAvatar';
import { EmptyState, ErrorState, LoadingList } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { useScout } from '../../../../voice/useScout';

const HAS_TOKEN = !!env.mapboxToken;
// Alturas de la hoja: solo el título, a la mitad y casi completa.
const SNAP_FRACTIONS = [0.2, 0.5, 0.9] as const;
const SNAP_POINTS = SNAP_FRACTIONS.map((f) => `${f * 100}%`);

export default function MapTab() {
  const tripId = useTripId();
  const me = useMe();
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const { now } = useNow(60_000);
  const scout = useScout();
  const location = useLocationProvider();

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
  // Deep link (pruebas y demo): ?day=2026-10-18 abre ese día · ?day=trip el viaje entero.
  const link = useLocalSearchParams<{ day?: string }>();
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
  const [sheetIndex, setSheetIndex] = useState(1);
  const [areaHeight, setAreaHeight] = useState(0);
  useEffect(() => setSelected(null), [effectiveScope.kind, effectiveScope.kind === 'day' ? effectiveScope.dayId : '']);

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

  if (overview.isPending || blocks.isPending) return <LoadingList count={3} />;
  if (overview.isError || blocks.isError) {
    return (
      <ErrorState
        message="No pudimos cargar el mapa del viaje"
        detail={errorDetail(overview.error ?? blocks.error)}
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
  const sheetTitle = effectiveScope.kind === 'trip' ? 'Todo el viaje' : `${isToday ? 'Hoy · ' : ''}${dayOption?.label ?? ''}`;
  const placesCount = model.points.filter((p) => p.kind !== 'stop').length;
  const sheetCount =
    effectiveScope.kind === 'trip'
      ? `${placesCount} ${placesCount === 1 ? 'ciudad' : 'ciudades'}`
      : `${placesCount} ${placesCount === 1 ? 'lugar' : 'lugares'}`;
  const bottomInset = areaHeight * SNAP_FRACTIONS[Math.min(sheetIndex, 1)];

  const select = (p: MapPoint) => {
    setSelected(p);
    // Que el punto quede a la vista: la hoja a la mitad.
    if (sheetIndex !== 1) sheet.current?.snapToIndex(1);
  };

  return (
    <View style={styles.flex}>
      <ScopeBar
        options={options}
        scope={effectiveScope}
        onChange={(s) => setScope(s)}
        todayDayId={today.kind === 'today' ? today.day.id : null}
      />

      <View style={styles.flex} onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}>
        {HAS_TOKEN ? (
          <LazyMap
            model={model}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onLongPress={(lat, lng) => talk(focusForCoordinate(lat, lng), { source: 'map', kind: 'coordinate' })}
            bottomInset={bottomInset}
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

        <BottomSheet
          ref={sheet}
          index={1}
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

          {selected ? (
            <View style={styles.action}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Badge point={selected} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitle} numberOfLines={2}>
                    {selected.label}
                  </Text>
                  {selected.sublabel ? (
                    <Text style={styles.muted} numberOfLines={2}>
                      {selected.sublabel}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => talkAbout(selected)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Hablar con ${SCOUT.name} de esto`}
                  accessibilityState={{ busy }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.talk, pressed && styles.pressed]}
                >
                  <ScoutAvatar size={44} state={scout.state} />
                  <Text style={styles.talkText}>Hablar</Text>
                </Pressable>
                <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} style={styles.close}>
                  <Text style={styles.closeText}>✕</Text>
                </Pressable>
              </View>
              {selected.kind === 'block' && selected.blockId ? (
                <Button
                  label="Ver en el plan"
                  variant="secondary"
                  onPress={() => openBlock(tripId, selected.blockId!)}
                />
              ) : null}
              {selected.kind === 'leg' && selected.legId ? (
                <Button
                  label="Ver sus días"
                  variant="secondary"
                  onPress={() => {
                    const first = options.find((o) => o.legId === selected.legId);
                    if (first) setScope({ kind: 'day', dayId: first.dayId });
                  }}
                />
              ) : null}
            </View>
          ) : null}

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
            {tours.isError ? <Text style={styles.error}>No pudimos cargar las paradas del tour.</Text> : null}
          </BottomSheetScrollView>
        </BottomSheet>
      </View>
    </View>
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
}: {
  options: ReturnType<typeof dayOptions>;
  scope: MapScope;
  onChange: (s: MapScope) => void;
  todayDayId: string | null;
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
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopeBar} style={styles.scopeWrap}>
      <Chip label="Todo el viaje" on={scope.kind === 'trip'} onPress={() => onChange({ kind: 'trip' })} />
      {options.map((o) => (
        <Chip
          key={o.dayId}
          onLayout={(x) => {
            xs.current.set(o.dayId, x);
            if (o.dayId === selectedKey) setLaidOut((n) => n + 1);
          }}
          label={o.dayId === todayDayId ? `Hoy · ${o.label.split(' · ')[1] ?? ''}` : o.label}
          color={o.color}
          on={scope.kind === 'day' && scope.dayId === o.dayId}
          onPress={() => onChange({ kind: 'day', dayId: o.dayId })}
        />
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
    paddingBottom: space.sm,
  },
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
  error: { fontSize: font.small, color: colors.danger },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  badgeStop: { width: 24, height: 24, borderRadius: 12 },
  badgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: font.tiny },
  action: {
    marginHorizontal: space.md,
    marginBottom: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primary,
    padding: space.md,
    gap: space.sm,
  },
  actionTitle: { fontSize: font.h3, fontWeight: '600', color: colors.text },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  talk: { alignItems: 'center' },
  talkText: { fontSize: font.tiny, fontWeight: '800', color: colors.scout },
  pressed: { opacity: 0.7 },
  closeText: { fontSize: 18, color: colors.textMuted },
});
