// Protagonista "ahora": lo que está en curso, cuánto falta y quién está.
import type { BlockAlert } from '@build101/shared';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../../ui/Text';
import { colors, font, space } from '../../../../ui/theme';
import { AlertChips } from '../../../plan/components/BlockCard';
import { formatMinutes } from '../../selectors';
import { HeroActions, HeroCard, heroText, Kicker } from './HeroState';

type Props = {
  title: string;
  placeName?: string | null;
  /** 0..1 (null = sin hora de fin: no hay barra). */
  progress: number | null;
  remainingMin: number | null;
  /** Hora local de fin ("17:00"). */
  endLabel?: string | null;
  faces?: ReactNode;
  alerts?: BlockAlert[] | null;
  onTellMe: () => void;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function remainingLabel(remainingMin: number | null, endLabel?: string | null): string | null {
  const parts = [
    remainingMin != null ? `Quedan ${formatMinutes(remainingMin)}` : null,
    endLabel ? `hasta ${endLabel}` : null,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  const s = parts.join(' · ');
  return s[0]!.toUpperCase() + s.slice(1);
}

export function HeroCurrent({ title, placeName, progress, remainingMin, endLabel, faces, alerts, onTellMe, onPress, onLongPress }: Props) {
  const left = remainingLabel(remainingMin, endLabel);
  const pct = progress == null ? null : Math.min(1, Math.max(0, progress));
  return (
    <HeroCard onPress={onPress} onLongPress={onLongPress} accessibilityLabel={`Ahora: ${title}${left ? `. ${left}` : ''}`}>
      <Kicker>AHORA</Kicker>
      <View style={styles.text}>
        <Text style={heroText.title} numberOfLines={2}>
          {title}
        </Text>
        {placeName ? (
          <Text style={heroText.place} numberOfLines={1}>
            {placeName}
          </Text>
        ) : null}
      </View>
      {pct != null ? (
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
        >
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        </View>
      ) : null}
      {left ? <Text style={styles.left}>{left}</Text> : null}
      {faces ? <View>{faces}</View> : null}
      <AlertChips alerts={alerts ?? null} max={2} />
      <HeroActions primary={{ label: 'Contame de esto', onPress: onTellMe, hint: 'El Scout te cuenta de este lugar' }} />
    </HeroCard>
  );
}

const styles = StyleSheet.create({
  text: { gap: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  left: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
