// Vista Planificación (decisiones del sábado): pestañas internas Itinerario · Eventos · Tours · Gastos.
// Itinerario = Plan del PRD 02: línea de tiempo por tramo y día, filtros, tramos paralelos, ideas, propuestas y alertas.
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AgentJobProgress } from '../../../../features/jobs/AgentJobProgress';
import { BlockCard, GhostCard } from '../../../../features/plan/components/BlockCard';
import { ActionToast } from '../../../../features/plan/components/ActionToast';
import { Segmented } from '../../../../features/plan/components/Controls';
import {
  DayEmpty,
  DayHeader,
  FILTER_OPTIONS,
  GroupHeader,
  IconButton,
  IdeasHeader,
  LegStrip,
  ParallelDay,
  PlanSkeleton,
  ProposalBanner,
  StaleBanner,
} from '../../../../features/plan/components/PlanRows';
import { DotsIcon, PlusIcon } from '../../../../features/plan/components/TypeIcon';
import { legColorMap } from '../../../../features/plan/labels';
import { showMenu } from '../../../../features/plan/menu';
import { openBank, openBlock, openNewBlock, openProposals } from '../../../../features/plan/nav';
import {
  useMe,
  usePendingProposals,
  usePermissions,
  usePlanBlocks,
  usePlanOverview,
} from '../../../../features/plan/queries';
import { buildPlanSections, selectBranch, type PlanBlock, type PlanRow } from '../../../../features/plan/selectors';
import { exportIcs, shareDay } from '../../../../features/plan/share';
import { usePlanMapStore } from '../../../../features/plan/store';
import {
  EventsPlaceholder,
  ExpensesPlaceholder,
  parseSection,
  PlanningSectionBar,
  type PlanningSection,
} from '../../../../features/planning/sections';
import { ToursTab } from '../../../../features/planning/ToursTab';
import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail, useTrip } from '../../../../features/trips/queries';
import type { AvatarPerson } from '../../../../ui/Avatar';
import { Button } from '../../../../ui/Button';
import { EmptyState, ErrorState } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';

export default function PlanningTab() {
  // Deep link: /trip/<id>?section=itinerary|events|tours|expenses
  const tripId = useTripId();
  const { section: linkSection } = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<PlanningSection>(() => parseSection(linkSection));
  useEffect(() => {
    if (linkSection) setSection(parseSection(linkSection));
  }, [linkSection]);

  return (
    <View style={styles.flex}>
      <PlanningSectionBar
        value={section}
        onChange={(s) => {
          void Haptics.selectionAsync().catch(() => {});
          setSection(s);
        }}
      />
      {section === 'itinerary' ? <ItineraryView /> : null}
      {section === 'events' ? <EventsPlaceholder /> : null}
      {section === 'tours' ? <ToursTab tripId={tripId} /> : null}
      {section === 'expenses' ? <ExpensesPlaceholder /> : null}
    </View>
  );
}

/** Grupo salió de las tabs principales (multiplayer fuera del MVP): queda como acceso secundario. */
function openGroup(tripId: string) {
  router.push({ pathname: '/group/[tripId]', params: { tripId } });
}

function ItineraryView() {
  const tripId = useTripId();
  const me = useMe();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const proposals = usePendingProposals(tripId);
  const perms = usePermissions(tripId);

  const ensureTrip = usePlanMapStore((s) => s.ensureTrip);
  const filter = usePlanMapStore((s) => s.filter);
  const setFilter = usePlanMapStore((s) => s.setFilter);
  const branchByDate = usePlanMapStore((s) => s.branchByDate);
  const setBranchByDate = usePlanMapStore((s) => s.setBranchByDate);
  const parallelView = usePlanMapStore((s) => s.parallelView);
  const setParallelView = usePlanMapStore((s) => s.setParallelView);
  const expandedIdeas = usePlanMapStore((s) => s.expandedIdeas);
  const toggleIdeas = usePlanMapStore((s) => s.toggleIdeas);
  const select = usePlanMapStore((s) => s.select);

  useEffect(() => ensureTrip(tripId), [ensureTrip, tripId]);

  // Deep link: /trip/<id>?filter=mine|group|all&view=parallel|branch&leg=<legId>&day=<dayId>&ideas=<legId>
  // (notificaciones, voz y pruebas en simulador).
  const link = useLocalSearchParams<{ filter?: string; view?: string; leg?: string; day?: string; ideas?: string; t?: string }>();
  useEffect(() => {
    if (link.filter === 'all' || link.filter === 'group' || link.filter === 'mine') setFilter(link.filter);
    if (link.view === 'parallel') setParallelView(true);
    if (link.view === 'branch') setParallelView(false);
    if (link.ideas) toggleIdeas(link.ideas, true);
  }, [link.filter, link.view, link.ideas, link.t, setFilter, setParallelView, toggleIdeas]);

  const listRef = useRef<FlashListRef<PlanRow>>(null);
  const visibleDay = useRef<{ legId: string; dayId: string } | null>(null);

  const legs = overview.data?.legs;
  const legColors = useMemo(() => legColorMap(legs ?? []), [legs]);
  const people = useMemo(
    () => new Map<string, AvatarPerson>((overview.data?.members ?? []).map((m) => [m.id, m])),
    [overview.data?.members],
  );

  const sections = useMemo(() => {
    if (!legs || !blocks.data) return null;
    return buildPlanSections({
      legs,
      blocks: blocks.data,
      filter,
      branchByDate,
      me,
      parallelView,
      expandedIdeas,
      proposals: proposals.data ?? [],
    });
  }, [legs, blocks.data, filter, branchByDate, me, parallelView, expandedIdeas, proposals.data]);

  const activeLegIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of sections?.rows ?? []) if (r.kind === 'group') r.activeLegIds.forEach((id) => set.add(id));
    return set;
  }, [sections]);

  const blocksByDay = useMemo(() => {
    const m = new Map<string, PlanBlock[]>();
    for (const b of blocks.data ?? []) if (b.day_id) m.set(b.day_id, [...(m.get(b.day_id) ?? []), b]);
    return m;
  }, [blocks.data]);

  const onPressBlock = useCallback(
    (b: PlanBlock) => {
      if (b.masked) return;
      select({ blockId: b.id, legId: b.leg_id, dayId: b.day_id });
      openBlock(tripId, b.id);
    },
    [select, tripId],
  );

  const addAt = useCallback(
    (legId?: string, dayId?: string | null) => {
      const target = legId ? { legId, dayId } : visibleDay.current;
      openNewBlock(tripId, { legId: target?.legId, dayId: target?.dayId ?? null });
    },
    [tripId],
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<PlanRow>[] }) => {
    for (const v of viewableItems) {
      const r = v.item;
      if (r && (r.kind === 'day' || r.kind === 'block' || r.kind === 'dayEmpty')) {
        const dayId = r.kind === 'block' ? r.block.day_id : r.day.id;
        if (dayId) {
          visibleDay.current = { legId: r.leg.id, dayId };
          return;
        }
      }
    }
  }).current;

  // Deep link leg/day: elegir la rama y hacer scroll una vez que hay filas.
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!sections || (!link.leg && !link.day && !link.ideas)) return;
    const key = `${link.leg ?? ''}|${link.day ?? ''}|${link.ideas ?? ''}|${link.t ?? ''}`;
    if (linked.current === key) return;
    linked.current = key;
    if (link.leg) {
      const group = sections.groups.find((g) => g.legs.some((l) => l.id === link.leg));
      if (group?.parallel) setBranchByDate(selectBranch(branchByDate, group, link.leg));
    }
    setTimeout(() => {
      const ideasIdx = link.ideas ? sections.rows.findIndex((r) => r.kind === 'ideas' && r.leg.id === link.ideas) : -1;
      const idx = link.day
        ? sections.dayRowIndex[link.day]
        : ideasIdx >= 0
          ? ideasIdx
          : link.leg
            ? sections.legRowIndex[link.leg]
            : undefined;
      if (idx !== undefined) void listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
    }, 300);
  }, [sections, link.leg, link.day, link.ideas, link.t, branchByDate, setBranchByDate]);

  const scrollToLeg = (legId: string) => {
    const idx = sections?.legRowIndex[legId];
    if (idx === undefined) return;
    void listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
  };

  const tripMenu = () =>
    showMenu(trip.data?.title, [
      { label: 'Grupo y actividad', onPress: () => openGroup(tripId) },
      { label: 'Tu perfil', onPress: () => router.push('/profile') },
      {
        label: 'Exportar viaje a calendario',
        onPress: () =>
          exportIcs(
            trip.data?.title ?? 'Viaje',
            blocks.data ?? [],
            (legs ?? []).flatMap((l) => l.days),
          ),
      },
      ...(sections?.groups.some((g) => g.parallel)
        ? [{ label: parallelView ? 'Ver una rama' : 'Ver tramos en paralelo', onPress: () => setParallelView(!parallelView) }]
        : []),
    ]);

  const dayMenu = (row: Extract<PlanRow, { kind: 'day' }>) =>
    showMenu(undefined, [
      { label: 'Compartir este día', onPress: () => shareDay(row.leg, row.day, blocksByDay.get(row.day.id) ?? []) },
      {
        label: 'Exportar este día a calendario',
        onPress: () => exportIcs(`${trip.data?.title ?? 'Viaje'} ${row.day.date}`, blocksByDay.get(row.day.id) ?? [], [row.day]),
      },
    ]);

  // ───────── Estados
  const loading = overview.isPending || blocks.isPending;
  const hardError = (overview.isError && !overview.data) || (blocks.isError && !blocks.data);
  const stale = (overview.isError && !!overview.data) || (blocks.isError && !!blocks.data);
  const retry = () => {
    void overview.refetch();
    void blocks.refetch();
    void proposals.refetch();
  };

  if (loading) return <PlanSkeleton />;
  if (hardError || !sections || !legs) {
    return <ErrorState message="No pudimos cargar el plan" detail={errorDetail(overview.error ?? blocks.error)} onRetry={retry} />;
  }

  if (legs.length === 0) {
    return (
      <View style={styles.flex}>
        <View style={styles.job}>
          <AgentJobProgress tripId={tripId} showSkeleton={false} />
        </View>
        <EmptyState title="Este viaje está en blanco" subtitle="Contale al compañero a dónde van y arma el plan con ustedes.">
          {perms.canPropose ? (
            <Button label="Contale al compañero" onPress={() => router.push({ pathname: '/trips/new', params: { trip_id: tripId } })} />
          ) : null}
        </EmptyState>
      </View>
    );
  }

  const canEditAny = legs.some((l) => perms.canEditLeg(l.id));
  const pendingCount = proposals.data?.length ?? 0;

  const renderItem = ({ item }: { item: PlanRow }) => {
    switch (item.kind) {
      case 'group':
        return (
          <GroupHeader
            group={item.group}
            activeLegIds={item.activeLegIds}
            parallelView={item.parallelView}
            legColors={legColors}
            people={people}
            onSelectBranch={(legId) => {
              void Haptics.selectionAsync().catch(() => {});
              setBranchByDate(selectBranch(branchByDate, item.group, legId));
            }}
            onToggleParallel={setParallelView}
          />
        );
      case 'day':
        return (
          <DayHeader
            leg={item.leg}
            day={item.day}
            legColor={legColors.get(item.leg.id) ?? colors.primary}
            showCity={item.parallel}
            canEdit={perms.canEditLeg(item.leg.id)}
            onAdd={() => addAt(item.leg.id, item.day.id)}
            onMenu={() => dayMenu(item)}
          />
        );
      case 'block':
        return (
          <BlockCard
            block={item.block}
            me={me}
            legColor={legColors.get(item.leg.id) ?? colors.primary}
            people={people}
            onPress={onPressBlock}
          />
        );
      case 'ghost':
        return <GhostCard ghost={item.ghost} onPress={() => openProposals(tripId)} />;
      case 'dayEmpty':
        return (
          <DayEmpty
            reason={item.reason}
            filter={filter}
            canEdit={perms.canEditLeg(item.leg.id)}
            onAdd={() => addAt(item.leg.id, item.day.id)}
            onBank={() => openBank(tripId, item.leg.id, item.day.id)}
          />
        );
      case 'parallelDay':
        return <ParallelDay date={item.date} columns={item.columns} legColors={legColors} onPress={onPressBlock} />;
      case 'ideas':
        return (
          <IdeasHeader
            leg={item.leg}
            count={item.count}
            expanded={item.expanded}
            canEdit={perms.canEditLeg(item.leg.id)}
            onToggle={() => toggleIdeas(item.leg.id)}
            onNew={() => openNewBlock(tripId, { legId: item.leg.id, idea: true })}
          />
        );
      case 'idea':
        return (
          <View style={styles.idea}>
            <View style={{ flex: 1 }}>
              <BlockCard
                block={item.block}
                me={me}
                legColor={legColors.get(item.leg.id) ?? colors.primary}
                people={people}
                onPress={onPressBlock}
              />
            </View>
            {perms.canEditBlock(item.block) ? (
              <Pressable
                style={styles.schedule}
                accessibilityRole="button"
                accessibilityLabel={`Agendar ${item.block.title}`}
                onPress={() => openBlock(tripId, item.block.id, { schedule: true })}
              >
                <Text style={styles.scheduleText}>Agendar</Text>
              </Pressable>
            ) : null}
          </View>
        );
    }
  };

  return (
    <View style={styles.flex}>
      {/* Progreso del plan_trip (PRD 01): no renderiza nada si no hay job reciente. */}
      <View style={styles.job}>
        <AgentJobProgress tripId={tripId} showSkeleton={false} />
      </View>
      <View style={styles.top}>
        <LegStrip
          groups={sections.groups}
          legColors={legColors}
          activeLegIds={activeLegIds}
          onPress={(leg, group) => {
            if (group.parallel && !parallelView) setBranchByDate(selectBranch(branchByDate, group, leg.id));
            select({ legId: leg.id });
            // Esperar a que se recalculen las filas si cambió la rama.
            requestAnimationFrame(() => scrollToLeg(leg.id));
          }}
        />
        <View style={styles.bar}>
          <Segmented
            options={FILTER_OPTIONS}
            value={filter}
            onChange={(f) => {
              void Haptics.selectionAsync().catch(() => {});
              setFilter(f);
            }}
          />
          <IconButton onPress={tripMenu} label="Más opciones del viaje">
            <DotsIcon color={colors.text} />
          </IconButton>
        </View>
      </View>
      <ProposalBanner count={pendingCount} onPress={() => openProposals(tripId)} />
      {stale ? <StaleBanner /> : null}

      <FlashList
        ref={listRef}
        data={sections.rows}
        keyExtractor={(r) => r.key}
        getItemType={(r) => r.kind}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshing={overview.isRefetching || blocks.isRefetching}
        onRefresh={retry}
      />

      {canEditAny ? (
        <Pressable
          onPress={() => addAt()}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Agregar al plan"
        >
          <PlusIcon color="#fff" size={28} />
        </Pressable>
      ) : null}
      <ActionToast bottom={space.lg + FAB_SIZE + space.md} />
    </View>
  );
}

const FAB_SIZE = 60;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  job: { paddingHorizontal: space.lg },
  top: { paddingTop: space.xs, gap: space.sm, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.lg, paddingRight: space.sm },
  // Espacio abajo para el FAB y el botón flotante de voz (PRD 05).
  list: { paddingHorizontal: space.lg, paddingBottom: FAB_SIZE + space.xxl * 2 },
  idea: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  schedule: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  scheduleText: { color: colors.primary, fontWeight: '700', fontSize: font.small },
  // FAB a la derecha; el slot de voz (PRD 05) va a la izquierda/centro y no se tapan.
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
