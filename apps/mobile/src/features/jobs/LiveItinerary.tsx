// Vista previa del itinerario que se va llenando en vivo mientras corre plan_trip (pantalla "Nuevo viaje").
// Lee legs/days/blocks_visible (Realtime los invalida) y anima cada bloque nuevo al entrar.
import type { BlockVisibleRow } from '@build101/shared';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { formatDateRange, formatDay } from '../../lib/format';
import { colors, font, radius, space } from '../../ui/theme';
import { useTripBlocks, useTripLegs } from '../trips/queries';

const TYPE_LABEL: Record<string, string> = {
  activity: 'Paseo',
  meal: 'Comida',
  tour: 'Tour',
  transfer: 'Traslado',
  lodging: 'Alojamiento',
  free: 'Libre',
  meetup: 'Encuentro',
};
const TYPE_COLOR: Record<string, string> = {
  activity: '#1F6FEB',
  meal: '#D9822B',
  tour: '#7C4DFF',
  transfer: '#5F5D57',
  lodging: '#2E9E6A',
  free: '#8A877F',
  meetup: '#C2362B',
};
const FLEX_LABEL: Record<string, string> = { morning: 'mañana', afternoon: 'tarde', evening: 'noche', any: '' };

const FLEX_RANK: Record<string, number> = { morning: 9 * 60, afternoon: 13 * 60, evening: 20 * 60, any: 15 * 60, fixed: 12 * 60 };
function rank(b: BlockVisibleRow): number {
  if (b.type === 'transfer') return 0;
  if (b.start_time) {
    const [h, m] = b.start_time.split(':').map(Number);
    return h * 60 + m;
  }
  return (FLEX_RANK[b.time_flex] ?? 15 * 60) + (b.type === 'lodging' ? 6 * 60 : 0);
}

function when(b: BlockVisibleRow): string {
  if (b.start_time) return b.start_time.slice(0, 5);
  return FLEX_LABEL[b.time_flex] ?? '';
}

export function LiveItinerary({ tripId }: { tripId: string }) {
  const legs = useTripLegs(tripId);
  const blocks = useTripBlocks(tripId);
  const byDay = new Map<string, BlockVisibleRow[]>();
  for (const b of blocks.data ?? []) {
    if (!b.day_id) continue;
    byDay.set(b.day_id, [...(byDay.get(b.day_id) ?? []), b]);
  }
  // Orden del día: hora fija si hay, si no por franja (mañana → tarde → noche), después sort_order.
  for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);

  return (
    <View style={styles.wrap}>
      {(legs.data ?? []).map((leg) => (
        <Animated.View key={leg.id} entering={FadeInDown.duration(300)} layout={LinearTransition} style={styles.leg}>
          <Text style={styles.legTitle}>{leg.city}</Text>
          <Text style={styles.legDates}>{formatDateRange(leg.start_date, leg.end_date)}</Text>
          {leg.days.map((day) => {
            const list = byDay.get(day.id) ?? [];
            return (
              <View key={day.id} style={styles.day}>
                <Text style={styles.dayLabel}>{formatDay(day.date)}</Text>
                {list.length === 0 ? <Text style={styles.pending}>Armando…</Text> : null}
                {list.map((b) => (
                  <Animated.View key={b.id} entering={FadeInDown.duration(250)} layout={LinearTransition} style={styles.block}>
                    <View style={[styles.dot, { backgroundColor: TYPE_COLOR[b.type] ?? colors.primary }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.blockTitle} numberOfLines={1}>
                        {b.title}
                      </Text>
                      <Text style={styles.blockMeta} numberOfLines={1}>
                        {[TYPE_LABEL[b.type], when(b), b.place_name].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </Animated.View>
                ))}
              </View>
            );
          })}
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg, marginTop: space.lg },
  leg: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  legTitle: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  legDates: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  day: { marginTop: space.md },
  dayLabel: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, textTransform: 'capitalize', marginBottom: space.xs },
  pending: { fontSize: font.small, color: colors.masked, fontStyle: 'italic' },
  block: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  blockTitle: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  blockMeta: { fontSize: font.tiny, color: colors.textMuted },
});
