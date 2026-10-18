// Una sola fila con lo que sigue: "18:00 · Llamada de laburo · Salí en 1 h 10".
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { ChevronIcon } from '../../../plan/components/TypeIcon';

type Props = { time: string | null; title: string; trailing?: string | null; onPress: () => void };

export function NextRow({ time, title, trailing, onPress }: Props) {
  const a11y = ['Después', time, title, trailing].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {time ? <Text style={styles.time}>{time}</Text> : null}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {trailing ? (
        <Text style={styles.trailing} numberOfLines={1}>
          {trailing}
        </Text>
      ) : null}
      <ChevronIcon color={colors.textMuted} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.8 },
  time: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  title: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  trailing: { fontSize: font.small, fontWeight: '600', color: colors.primary, maxWidth: '40%' },
});
