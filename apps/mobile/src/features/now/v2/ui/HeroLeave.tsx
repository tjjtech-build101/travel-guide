// Protagonista "salí para": cuenta regresiva grande, destino, minirruta y quién va.
// Countdown, mapa y caras llegan como slots (los arma otro carril).
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../../ui/Text';
import { space } from '../../../../ui/theme';
import { HeroActions, HeroCard, heroText, Kicker } from './HeroState';

type Props = {
  countdown: ReactNode;
  map?: ReactNode;
  faces?: ReactNode;
  title: string;
  placeName?: string | null;
  /** Hora de inicio local ("18:00"). */
  startLabel?: string | null;
  onDirections: () => void;
  /** Solo con urgencia soon/late: abre LateSheet. */
  onLate?: () => void;
  onPress?: () => void;
};

export function HeroLeave({ countdown, map, faces, title, placeName, startLabel, onDirections, onLate, onPress }: Props) {
  const where = [placeName, startLabel].filter(Boolean).join(' · ');
  return (
    <HeroCard onPress={onPress} accessibilityLabel={`Salí para ${title}${where ? `, ${where}` : ''}`}>
      <Kicker>SALÍ PARA</Kicker>
      {countdown}
      <View style={styles.text}>
        <Text style={heroText.title} numberOfLines={2}>
          {title}
        </Text>
        {where ? (
          <Text style={heroText.place} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </View>
      {map ? <View style={styles.slot}>{map}</View> : null}
      {faces ? <View>{faces}</View> : null}
      <HeroActions
        primary={{ label: 'Cómo llego', onPress: onDirections, hint: 'Abre el mapa con indicaciones' }}
        secondary={onLate ? { label: 'Voy tarde', onPress: onLate, hint: 'Avisá al grupo o mové el bloque' } : null}
      />
    </HeroCard>
  );
}

const styles = StyleSheet.create({
  text: { gap: 2 },
  slot: { marginTop: space.xs },
});
