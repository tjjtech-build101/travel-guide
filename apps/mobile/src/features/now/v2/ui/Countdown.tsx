// Cuenta regresiva del protagonista "leave": el número manda. Colores por urgencia (los de components.tsx).
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';

export type Urgency = 'ok' | 'soon' | 'late';

// Copia de URGENCY_COLORS de features/now/components.tsx (no exportado allá).
export const URGENCY_COLORS = {
  ok: { bg: colors.successBg, fg: colors.primary },
  soon: { bg: '#F7E9C6', fg: colors.bronzeText },
  late: { bg: colors.dangerBg, fg: colors.danger },
} as const;

type Props = { text: string; urgency: Urgency; sub?: string };

export function Countdown({ text, urgency, sub }: Props) {
  const c = URGENCY_COLORS[urgency];
  return (
    <View
      style={[styles.box, { backgroundColor: c.bg }]}
      accessible
      accessibilityRole="timer"
      accessibilityLiveRegion={urgency === 'ok' ? 'none' : 'polite'}
      accessibilityLabel={sub ? `${text}. ${sub}` : text}
    >
      <Text style={[styles.big, { color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {text}
      </Text>
      {sub ? <Text style={[styles.sub, { color: c.fg }]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, paddingVertical: space.lg, paddingHorizontal: space.xl, alignItems: 'flex-start' },
  big: { fontSize: 48, lineHeight: 56, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  sub: { marginTop: space.xs, fontSize: font.body, fontWeight: '600', opacity: 0.85 },
});
