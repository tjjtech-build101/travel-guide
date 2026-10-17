// Tab Mapa (PRD 03, 2D primero): el recorrido que viene (tramos del viaje, bloques del día y paradas de tour).
// Tocar cualquier elemento → "Hablar con el Scout de esto" → useScout().startScoutCall({ focus }).
// Sin EXPO_PUBLIC_MAPBOX_TOKEN no se monta Mapbox: aviso + la misma lista de puntos (todo lo demás funciona igual).
import { SCOUT } from '@build101/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  buildMapModel,
  dayOptions,
  defaultDayId,
  focusForCoordinate,
  focusForPoint,
  type MapPoint,
  type MapScope,
} from '../../../../features/map/model';
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
import { EmptyState, ErrorState, LoadingList } from '../../../../ui/States';
import { colors, font, radius, space } from '../../../../ui/theme';
import { useScout } from '../../../../voice/useScout';

const HAS_TOKEN = !!env.mapboxToken;

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

  return (
    <View style={styles.flex}>
      <ScopeBar
        options={options}
        scope={effectiveScope}
        onChange={(s) => setScope(s)}
        todayDayId={today.kind === 'today' ? today.day.id : null}
      />

      {HAS_TOKEN ? (
        <View style={styles.mapBox}>
          <LazyMap
            model={model}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            onLongPress={(lat, lng) => talk(focusForCoordinate(lat, lng), { source: 'map', kind: 'coordinate' })}
          />
        </View>
      ) : (
        <View style={styles.tokenBanner}>
          <Text style={styles.tokenTitle}>Falta EXPO_PUBLIC_MAPBOX_TOKEN</Text>
          <Text style={styles.tokenBody}>
            El mapa aparece cuando se cargue el token en apps/mobile/.env. Mientras tanto, tocá cualquier lugar de la lista
            para hablar con {SCOUT.name}.
          </Text>
        </View>
      )}

      <PointList
        points={model.points}
        unlocatedCount={model.unlocated.length}
        selectedId={selected?.id ?? null}
        onPress={setSelected}
        toursLoading={tourIds.length > 0 && tours.isPending}
        toursError={tours.isError}
        emptyText={effectiveScope.kind === 'day' ? 'Este día no tiene lugares en el mapa' : 'Los tramos no tienen ubicación'}
      />

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
            <Pressable onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <Button label={`Hablar con ${SCOUT.name} de esto`} loading={busy} onPress={() => talkAbout(selected)} />
          {selected.kind === 'block' && selected.blockId ? (
            <Button
              label="Ver en el plan"
              variant="ghost"
              onPress={() => openBlock(tripId, selected.blockId!)}
            />
          ) : null}
          {selected.kind === 'leg' && selected.legId ? (
            <Button
              label="Ver sus días"
              variant="ghost"
              onPress={() => {
                const first = options.find((o) => o.legId === selected.legId);
                if (first) setScope({ kind: 'day', dayId: first.dayId });
              }}
            />
          ) : null}
        </View>
      ) : null}
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

function PointList({
  points,
  unlocatedCount,
  selectedId,
  onPress,
  toursLoading,
  toursError,
  emptyText,
}: {
  points: MapPoint[];
  unlocatedCount: number;
  selectedId: string | null;
  onPress: (p: MapPoint) => void;
  toursLoading: boolean;
  toursError: boolean;
  emptyText: string;
}) {
  const main = points.filter((p) => p.kind !== 'stop');
  const stops = points.filter((p) => p.kind === 'stop');
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {unlocatedCount ? <Text style={styles.chipInfo}>{unlocatedCount} sin ubicación</Text> : null}
      {points.length === 0 && !toursLoading ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {main.map((p) => (
        <Row key={p.id} point={p} selected={p.id === selectedId} onPress={() => onPress(p)} />
      ))}
      {stops.length ? <Text style={styles.sectionTitle}>Paradas del tour</Text> : null}
      {stops.map((p) => (
        <Row key={p.id} point={p} selected={p.id === selectedId} onPress={() => onPress(p)} />
      ))}
      {toursLoading ? <Text style={styles.muted}>Cargando las paradas del tour…</Text> : null}
      {toursError ? <Text style={styles.error}>No pudimos cargar las paradas del tour.</Text> : null}
    </ScrollView>
  );
}

function Row({ point, selected, onPress }: { point: MapPoint; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={`Abre la opción de hablar con ${SCOUT.name} de este lugar`}
      style={({ pressed }) => [styles.row, (selected || pressed) && styles.rowOn]}
    >
      <Badge point={point} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {point.label}
        </Text>
        {point.sublabel ? (
          <Text style={styles.muted} numberOfLines={1}>
            {point.sublabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scopeWrap: { flexGrow: 0 },
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
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: font.small, color: colors.text, fontWeight: '600' },
  chipTextOn: { color: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  mapBox: { flex: 1.3, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tokenBanner: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
    gap: 4,
  },
  tokenTitle: { color: colors.warningText, fontWeight: '700', fontSize: font.small, fontFamily: 'Menlo' },
  tokenBody: { color: colors.warningText, fontSize: font.small },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.lg, paddingBottom: 200, gap: 2 },
  sectionTitle: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginTop: space.md, marginBottom: space.xs },
  chipInfo: {
    alignSelf: 'flex-start',
    fontSize: font.tiny,
    color: colors.textMuted,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginVertical: space.xs,
  },
  empty: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', marginTop: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.sm, borderRadius: radius.md },
  rowOn: { backgroundColor: colors.surfaceMuted },
  rowTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  badgeStop: { width: 24, height: 24, borderRadius: 12 },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: font.tiny },
  action: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 18, color: colors.textMuted },
});
