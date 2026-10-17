// Cuenta regresiva del protagonista "leave": el número manda. Colores por urgencia (los de components.tsx).
// LiveCountdown tiene su propio reloj (cada 1 s con ≤ 10 min, si no cada 30 s): el resto de la pantalla no se
// re-renderiza cada segundo.
import { zonedParts } from '@build101/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { countdown } from '../model';

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

type LiveProps = {
  /** Minuto local (0–1439) en que hay que salir. */
  leaveAtMin: number;
  tz: string;
  /** Desfase del reloj de la pantalla (simulación o vista previa), en ms. */
  offsetMs: number;
  urgency: Urgency;
  /** "6 min a pie": con segundos se le antepone "Para salir · ". */
  eta: string;
};

export function LiveCountdown({ leaveAtMin, tz, offsetMs, urgency, eta }: LiveProps) {
  const read = () => {
    const p = zonedParts(Date.now() + offsetMs, tz);
    return countdown(leaveAtMin - p.minutes, p.seconds);
  };
  const [cd, setCd] = useState(read);
  useEffect(() => {
    setCd(read());
    const id = setInterval(() => setCd(read()), cd.tickMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveAtMin, tz, offsetMs, cd.tickMs]);
  const withSeconds = /^\d+:\d\d$/.test(cd.text);
  return <Countdown text={cd.text} urgency={urgency} sub={`${withSeconds ? 'Para salir · ' : ''}${eta}`} />;
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: 'flex-start' },
  big: { fontSize: 44, lineHeight: 52, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  sub: { marginTop: 0, fontSize: font.body, fontWeight: '600', opacity: 0.85 },
});
