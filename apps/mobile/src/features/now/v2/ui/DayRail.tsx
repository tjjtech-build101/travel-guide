// Tira del día (Ahora v2): bloques en fila, hechos atenuados, el actual resaltado y un marcador "ahora".
// Reemplaza "Más tarde hoy". Arranca centrada en lo de ahora. Alto total ≤ 56 px.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';

import { Text } from '../../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../../ui/theme';
import { TypeIcon } from '../../../plan/components/TypeIcon';
import { clock } from '../../selectors';
import type { DayRailItem } from '../types';

type Props = { items: DayRailItem[]; onPress: (id: string) => void };

const STATUS_LABEL: Record<DayRailItem['status'], string> = {
  done: 'hecho',
  now: 'ahora',
  next: 'lo próximo',
  later: 'más tarde',
};

export function DayRail({ items, onPress }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const layouts = useRef(new Map<string, { x: number; w: number }>());
  const [width, setWidth] = useState(0);
  const centered = useRef<string | null>(null);

  const hasNow = items.some((i) => i.status === 'now');
  // Ancla: el bloque en curso o, si no hay, el primero que falta.
  const anchor = items.find((i) => i.status === 'now') ?? items.find((i) => i.status !== 'done') ?? items[items.length - 1];
  // Sin bloque en curso, la rayita "ahora" va justo antes del próximo.
  const markerBefore = hasNow ? null : (items.find((i) => i.status !== 'done')?.id ?? null);

  const center = useCallback(() => {
    if (!anchor || !width) return;
    const l = layouts.current.get(anchor.id);
    if (!l) return;
    const key = `${anchor.id}:${width}`;
    if (centered.current === key) return;
    centered.current = key;
    scroll.current?.scrollTo({ x: Math.max(0, l.x + l.w / 2 - width / 2), animated: false });
  }, [anchor, width]);

  useEffect(center, [center]);

  if (!items.length) return null;

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.content}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="list"
      accessibilityLabel="Tu día"
    >
      {items.map((it) => (
        <View key={it.id} style={styles.slot}>
          {markerBefore === it.id ? <NowMarker /> : null}
          <Pressable
            onLayout={(e) => {
              layouts.current.set(it.id, { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width });
              if (it.id === anchor?.id) center();
            }}
            onPress={() => onPress(it.id)}
            accessibilityRole="button"
            accessibilityLabel={`${it.start !== null ? `${clock(it.start)}, ` : ''}${it.title}, ${STATUS_LABEL[it.status]}`}
            accessibilityState={{ selected: it.status === 'now' }}
            style={({ pressed }) => [
              styles.chip,
              it.status === 'now' && styles.chipNow,
              it.status === 'next' && styles.chipNext,
              it.status === 'done' && styles.chipDone,
              pressed && styles.pressed,
            ]}
          >
            <TypeIcon type={it.type} size={16} color={it.status === 'now' ? colors.primaryText : colors.textMuted} />
            <View style={styles.texts}>
              <Text style={[styles.time, it.status === 'now' && styles.onNow]} numberOfLines={1}>
                {it.status === 'now' ? 'Ahora' : it.start !== null ? clock(it.start) : 'Sin hora'}
              </Text>
              <Text style={[styles.title, it.status === 'now' && styles.onNow]} numberOfLines={1}>
                {it.title}
              </Text>
            </View>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function NowMarker() {
  return (
    <View style={styles.marker} accessible accessibilityLabel="Ahora">
      <View style={styles.markerDot} />
      <View style={styles.markerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { maxHeight: 56, flexGrow: 0 },
  content: { alignItems: 'center', paddingHorizontal: space.lg, gap: space.sm },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    height: MIN_TOUCH,
    maxWidth: 168,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipNow: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipNext: { borderColor: colors.primary },
  chipDone: { opacity: 0.45, backgroundColor: 'transparent' },
  pressed: { opacity: 0.7 },
  texts: { flexShrink: 1 },
  time: { fontSize: font.tiny, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  title: { fontSize: font.small, color: colors.text, fontWeight: '600' },
  onNow: { color: colors.primaryText },
  marker: { alignItems: 'center', height: 40 },
  markerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  markerLine: { width: 2, flex: 1, backgroundColor: colors.primary, borderRadius: 1 },
});
