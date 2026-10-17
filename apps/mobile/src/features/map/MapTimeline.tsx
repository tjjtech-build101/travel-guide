// Lista del Mapa como sendero: la hora grande a la izquierda y los números unidos por la misma línea
// punteada que el recorrido del mapa. "Ahora" y "Próximo" a la vista; las paradas de un tour van
// adentro de su tour.
import { SCOUT } from '@build101/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import type { MapPoint, PointStatus } from './model';

type Props = {
  points: MapPoint[];
  selectedId: string | null;
  status: Map<string, PointStatus>;
  onPress: (p: MapPoint) => void;
};

type Row = { point: MapPoint; nested: boolean };

export function MapTimeline({ points, selectedId, status, onPress }: Props) {
  const stopsByTour = new Map<string, MapPoint[]>();
  for (const p of points) {
    if (p.kind === 'stop' && p.tourId) stopsByTour.set(p.tourId, [...(stopsByTour.get(p.tourId) ?? []), p]);
  }
  const main = points.filter((p) => p.kind !== 'stop');
  const rows: Row[] = [];
  const placed = new Set<string>();
  for (const p of main) {
    rows.push({ point: p, nested: false });
    if (p.tourId && !placed.has(p.tourId)) {
      placed.add(p.tourId);
      for (const s of stopsByTour.get(p.tourId) ?? []) rows.push({ point: s, nested: true });
    }
  }
  // Paradas de un tour cuyo bloque no está en el mapa (sin ubicación): al final.
  for (const [tourId, stops] of stopsByTour) {
    if (!placed.has(tourId)) for (const s of stops) rows.push({ point: s, nested: true });
  }

  return (
    <View>
      {rows.map((r, i) => (
        <TimelineRow
          key={r.point.id}
          point={r.point}
          nested={r.nested}
          status={status.get(r.point.id)}
          selected={r.point.id === selectedId}
          first={i === 0}
          last={i === rows.length - 1}
          onPress={() => onPress(r.point)}
        />
      ))}
    </View>
  );
}

const DOT_Y = { main: 24, stop: 14 };

function TimelineRow({
  point,
  nested,
  status,
  selected,
  first,
  last,
  onPress,
}: {
  point: MapPoint;
  nested: boolean;
  status: PointStatus | undefined;
  selected: boolean;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  const done = status === 'done';
  const dotY = nested ? DOT_Y.stop : DOT_Y.main;
  const duration = durationLabel(point.start, point.end);
  const meta = point.kind === 'block' ? point.place : point.sublabel;
  const a11y = [point.start, point.label, status === 'now' ? 'ahora' : status === 'next' ? 'próximo' : null].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      accessibilityHint={`Lo muestra en el mapa y te deja hablar con ${SCOUT.name} de esto`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.timeCol}>
        {!nested && point.start ? (
          <>
            <Text style={[styles.time, done && styles.dim]}>{point.start}</Text>
            {duration ? <Text style={styles.duration}>{duration}</Text> : null}
          </>
        ) : null}
      </View>

      <View style={styles.rail}>
        <Svg style={StyleSheet.absoluteFill}>
          <Line
            x1="50%"
            x2="50%"
            y1={first ? dotY : 0}
            y2={last ? dotY : '100%'}
            stroke={colors.khaki}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        </Svg>
        <View
          style={[
            nested ? styles.stopDot : styles.dot,
            { marginTop: dotY - (nested ? 8 : 12), backgroundColor: done ? colors.khaki : point.color },
            selected && styles.dotSelected,
          ]}
        >
          <Text style={nested ? styles.stopDotText : styles.dotText}>{point.order ?? '•'}</Text>
        </View>
      </View>

      {nested ? (
        <View style={styles.stopBody}>
          <Text style={[styles.stopTitle, selected && styles.stopTitleOn]} numberOfLines={1}>
            {point.label}
          </Text>
        </View>
      ) : (
        <View style={[styles.card, status === 'now' && styles.cardNow, selected && styles.cardSelected]}>
          {status === 'now' ? <Text style={[styles.pill, styles.pillNow]}>Ahora</Text> : null}
          {status === 'next' ? <Text style={[styles.pill, styles.pillNext]}>Próximo</Text> : null}
          <Text style={[styles.title, done && styles.dim]} numberOfLines={2}>
            {point.label}
          </Text>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {point.typeLabel ? <Text style={[styles.pill, styles.pillType]}>{point.typeLabel}</Text> : null}
        </View>
      )}
    </Pressable>
  );
}

function durationLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const min = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)));
  if (min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m}` : ''}` : `${m} min`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  pressed: { opacity: 0.7 },
  timeCol: { width: 52, alignItems: 'flex-end', paddingTop: 12 },
  time: { fontSize: font.h3, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  duration: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  dim: { color: colors.masked },
  rail: { width: 26, alignItems: 'center' },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  dotSelected: { transform: [{ scale: 1.2 }] },
  dotText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  stopDot: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stopDotText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    marginBottom: space.sm,
    gap: 3,
  },
  cardNow: { borderColor: colors.primary, borderLeftWidth: 4 },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  title: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.tiny, color: colors.textMuted },
  pill: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  pillNow: { backgroundColor: colors.primary, color: colors.primaryText },
  pillNext: { backgroundColor: colors.khakiLight, color: colors.khakiText },
  pillType: { backgroundColor: colors.surfaceMuted, color: colors.textMuted, fontWeight: '600', marginTop: 2 },
  stopBody: { flex: 1, paddingTop: 5, paddingBottom: space.sm },
  stopTitle: { fontSize: font.small, color: colors.text },
  stopTitleOn: { fontWeight: '700', color: colors.primary },
});
