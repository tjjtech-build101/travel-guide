// Filas y piezas del encabezado del Plan.
import { SCOUT, type DayRow } from '@build101/shared';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { formatDateRange, formatDay } from '../../../lib/format';
import { AvatarStack, type AvatarPerson } from '../../../ui/Avatar';
import { Skeleton } from '../../../ui/States';
import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';
import type { LegGroup, ParallelColumn, PlanBlock, PlanFilter, PlanLeg } from '../selectors';
import { CompactBlockCard } from './BlockCard';
import { cap } from './BlockForm';
import { Chip } from './Controls';
import { ChevronIcon, DotsIcon, PlusIcon, SparkIcon } from './TypeIcon';

// ───────────────────────── Franja de tramos

export function LegStrip({
  groups,
  legColors,
  activeLegIds,
  onPress,
}: {
  groups: LegGroup[];
  legColors: Map<string, string>;
  activeLegIds: Set<string>;
  onPress: (leg: PlanLeg, group: LegGroup) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {groups.map((g) => (
        <View key={g.id} style={g.parallel ? styles.stack : undefined}>
          {g.legs.map((l) => {
            const c = legColors.get(l.id) ?? colors.primary;
            const dim = g.parallel && !activeLegIds.has(l.id);
            return (
              <Pressable
                key={l.id}
                onPress={() => onPress(l, g)}
                accessibilityRole="button"
                accessibilityLabel={`Ir a ${l.city}, ${formatDateRange(l.start_date, l.end_date)}`}
                style={({ pressed }) => [
                  styles.legChip,
                  g.parallel && styles.legChipStacked,
                  { borderColor: c, opacity: pressed ? 0.7 : dim ? 0.55 : 1 },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: c }]} />
                <View>
                  <Text style={styles.legCity} numberOfLines={1}>
                    {l.city}
                  </Text>
                  <Text style={styles.legDates}>{shortRange(l.start_date, l.end_date)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

function shortRange(a: string, b: string): string {
  const [, am, ad] = a.split('-').map(Number);
  const [, bm, bd] = b.split('-').map(Number);
  if (a === b) return `${ad}/${am}`;
  return am === bm ? `${ad}–${bd}/${am}` : `${ad}/${am}–${bd}/${bm}`;
}

// ───────────────────────── Barra (filtros + menú)

export const FILTER_OPTIONS: { value: PlanFilter; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'group', label: 'Del grupo' },
  { value: 'mine', label: 'Lo mío' },
];

export function IconButton({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={styles.iconBtn}>
      {children}
    </Pressable>
  );
}

// ───────────────────────── Propuestas y progreso del agente

export function ProposalBanner({ count, onPress }: { count: number; onPress: () => void }) {
  if (!count) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}
    >
      <SparkIcon color={colors.ghost} />
      <Text style={styles.bannerText}>
        {SCOUT.name} propone {count} {count === 1 ? 'cambio' : 'cambios'}
      </Text>
      <Text style={styles.bannerLink}>Ver</Text>
    </Pressable>
  );
}

export function StaleBanner() {
  return (
    <View style={styles.stale} accessibilityRole="alert">
      <Text style={styles.staleText}>Mostrando lo último</Text>
    </View>
  );
}

// ───────────────────────── Filas de la lista

export function GroupHeader({
  group,
  activeLegIds,
  parallelView,
  legColors,
  people,
  onSelectBranch,
  onToggleParallel,
}: {
  group: LegGroup;
  activeLegIds: string[];
  parallelView: boolean;
  legColors: Map<string, string>;
  people: Map<string, AvatarPerson>;
  onSelectBranch: (legId: string) => void;
  onToggleParallel: (v: boolean) => void;
}) {
  if (!group.parallel) {
    const leg = group.legs[0];
    const c = legColors.get(leg.id) ?? colors.primary;
    return (
      <View style={styles.groupHeader}>
        <View style={[styles.groupBar, { backgroundColor: c }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.groupTitle}>
            {leg.city}
            <Text style={styles.groupCountry}> · {leg.country}</Text>
          </Text>
          <Text style={styles.groupDates}>{formatDateRange(leg.start_date, leg.end_date)}</Text>
        </View>
        <AvatarStack people={leg.member_ids.map((id) => people.get(id) ?? { id, display_name: null, avatar_url: null })} size={26} max={4} />
      </View>
    );
  }
  const first = group.dates[0];
  const last = group.dates[group.dates.length - 1];
  return (
    <View style={styles.groupHeader}>
      <View style={{ flex: 1, gap: space.sm }}>
        <Text style={styles.groupTitle}>El grupo se separa</Text>
        <Text style={styles.groupDates}>{formatDateRange(first ?? null, last ?? null)}</Text>
        {!parallelView ? (
          <View style={styles.branchRow}>
            {group.legs.map((l) => {
              const names = l.member_ids.map((id) => people.get(id)?.display_name?.split(' ')[0] ?? '?').join(', ');
              return (
                <Chip
                  key={l.id}
                  label={`${l.city} · ${names}`}
                  color={legColors.get(l.id)}
                  selected={activeLegIds.includes(l.id)}
                  onPress={() => onSelectBranch(l.id)}
                  accessibilityLabel={`Ver la rama ${l.city}, con ${names}`}
                />
              );
            })}
          </View>
        ) : null}
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Ver en paralelo</Text>
          <Switch value={parallelView} onValueChange={onToggleParallel} accessibilityLabel="Ver en paralelo" />
        </View>
      </View>
    </View>
  );
}

export function weatherLabel(w: DayRow['weather']): string {
  if (!w) return '';
  const o = w as Record<string, unknown>;
  if (typeof o.summary === 'string') return o.summary;
  const max = o.temp_max ?? o.max ?? o.tmax;
  const min = o.temp_min ?? o.min ?? o.tmin;
  if (typeof max === 'number' && typeof min === 'number') return `${Math.round(min)}°–${Math.round(max)}°`;
  if (typeof max === 'number') return `${Math.round(max)}°`;
  return '';
}

export function dayTitle(date: string): string {
  return cap(formatDay(date));
}

export function DayHeader({
  leg,
  day,
  legColor,
  showCity,
  canEdit,
  onAdd,
  onMenu,
}: {
  leg: PlanLeg;
  day: DayRow;
  legColor: string;
  showCity: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onMenu: () => void;
}) {
  const weather = weatherLabel(day.weather);
  return (
    <View style={styles.dayHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.dayTitle} accessibilityRole="header">
          {dayTitle(day.date)}
          <Text style={[styles.dayCity, showCity && { color: legColor }]}> · {leg.city}</Text>
        </Text>
        {weather ? <Text style={styles.weather}>{weather}</Text> : null}
      </View>
      {canEdit ? (
        <IconButton onPress={onAdd} label={`Agregar algo el ${dayTitle(day.date)}`}>
          <PlusIcon color={colors.primary} size={22} />
        </IconButton>
      ) : null}
      <IconButton onPress={onMenu} label={`Opciones del ${dayTitle(day.date)}`}>
        <DotsIcon color={colors.textMuted} />
      </IconButton>
    </View>
  );
}

export function DayEmpty({
  reason,
  filter,
  canEdit,
  onAdd,
  onBank,
}: {
  reason: 'empty' | 'filtered';
  filter: PlanFilter;
  canEdit: boolean;
  onAdd: () => void;
  onBank: () => void;
}) {
  if (reason === 'filtered') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{filter === 'mine' ? 'No tenés nada propio este día' : 'Nada del grupo este día'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>Día libre. ¿Le sumamos algo?</Text>
      {canEdit ? (
        <View style={styles.emptyActions}>
          <Chip label="+ Bloque" onPress={onAdd} />
          <Chip label="Traer del banco" onPress={onBank} />
        </View>
      ) : null}
    </View>
  );
}

export function IdeasHeader({
  leg,
  count,
  expanded,
  canEdit,
  onToggle,
  onNew,
}: {
  leg: PlanLeg;
  count: number;
  expanded: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onNew: () => void;
}) {
  return (
    <View style={styles.ideas}>
      <Pressable
        onPress={onToggle}
        style={styles.ideasToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Banco de ideas de ${leg.city}, ${count}`}
      >
        <ChevronIcon color={colors.textMuted} open={expanded} />
        <Text style={styles.ideasTitle}>Banco de ideas ({count})</Text>
        <Text style={styles.ideasCity}>{leg.city}</Text>
      </Pressable>
      {canEdit ? (
        <Pressable onPress={onNew} style={styles.ideasNew} accessibilityRole="button" accessibilityLabel={`Nueva idea en ${leg.city}`}>
          <Text style={styles.ideasNewText}>+ Idea</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ParallelDay({
  date,
  columns,
  legColors,
  onPress,
}: {
  date: string;
  columns: ParallelColumn[];
  legColors: Map<string, string>;
  onPress: (b: PlanBlock) => void;
}) {
  return (
    <View style={styles.pday}>
      <Text style={styles.dayTitle}>{dayTitle(date)}</Text>
      <View style={styles.pcols}>
        {columns.map((c) => {
          const color = legColors.get(c.leg.id) ?? colors.primary;
          return (
            <View key={c.leg.id} style={styles.pcol}>
              <Text style={[styles.pcolTitle, { color }]} numberOfLines={1}>
                {c.leg.city}
              </Text>
              {c.blocks.map((b) => (
                <CompactBlockCard key={b.id} block={b} legColor={color} onPress={onPress} />
              ))}
              {c.ghosts.map((g, i) => (
                <View key={`g${i}`} style={styles.pghost}>
                  <Text style={styles.pghostText} numberOfLines={2}>
                    + {g.title}
                  </Text>
                </View>
              ))}
              {!c.blocks.length && !c.ghosts.length ? <Text style={styles.emptyText}>Libre</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function PlanSkeleton() {
  return (
    <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Cargando el plan">
      {[0, 1].map((d) => (
        <View key={d} style={{ gap: space.sm }}>
          <Skeleton width="45%" height={22} />
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skelCard}>
              <Skeleton width={44} height={16} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="40%" height={14} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center', paddingVertical: space.xs },
  stack: { gap: 4 },
  legChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: MIN_TOUCH,
    backgroundColor: colors.surface,
  },
  legChipStacked: { minHeight: 36, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legCity: { fontSize: font.small, fontWeight: '700', color: colors.text, maxWidth: 150 },
  legDates: { fontSize: font.tiny - 1, color: colors.textMuted },
  iconBtn: { minWidth: MIN_TOUCH - 4, minHeight: MIN_TOUCH - 4, alignItems: 'center', justifyContent: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: '#BFE0C6',
  },
  bannerText: { flex: 1, fontSize: font.small, fontWeight: '700', color: colors.ghost },
  bannerLink: { fontSize: font.small, fontWeight: '800', color: colors.ghost },
  stale: {
    alignSelf: 'center',
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.warningBg,
  },
  staleText: { color: colors.warningText, fontSize: font.tiny, fontWeight: '700' },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, marginBottom: space.xs },
  groupBar: { width: 5, alignSelf: 'stretch', borderRadius: 3 },
  groupTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  groupCountry: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  groupDates: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  branchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: font.small, fontWeight: '600', color: colors.text },
  dayHeader: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg, marginBottom: space.xs, minHeight: MIN_TOUCH },
  dayTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  dayCity: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
  weather: { fontSize: font.tiny, color: colors.textMuted, marginTop: 2 },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    marginBottom: space.sm,
  },
  emptyText: { fontSize: font.small, color: colors.textMuted },
  emptyActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  ideas: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    marginBottom: space.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingRight: space.xs,
  },
  ideasToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, paddingHorizontal: space.md },
  ideasTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  ideasCity: { fontSize: font.tiny, color: colors.textMuted },
  ideasNew: { minHeight: MIN_TOUCH - 8, paddingHorizontal: space.md, justifyContent: 'center' },
  ideasNewText: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  pday: { marginTop: space.lg, gap: space.sm },
  pcols: { flexDirection: 'row', gap: space.sm },
  pcol: { flex: 1, gap: 0 },
  pcolTitle: { fontSize: font.tiny, fontWeight: '800', marginBottom: space.xs, textTransform: 'uppercase' },
  pghost: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.ghost, borderRadius: radius.md, padding: space.sm, marginBottom: space.sm },
  pghostText: { fontSize: font.tiny, color: colors.ghost, fontWeight: '700' },
  skelCard: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
