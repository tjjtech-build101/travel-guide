// Protagonista "salí para": cuenta regresiva grande (sin kicker: el número ya lo dice), destino, quién va y acciones.
// Sin mapa ni notas: que la tarjeta entera, con los botones, entre arriba del dock. Countdown y caras llegan como slots.
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '../../../../ui/Text';
import { HeroActions, HeroCard, HeroHead, heroText } from './HeroState';

type Props = {
  countdown: ReactNode;
  faces?: ReactNode;
  title: string;
  placeName?: string | null;
  /** Hora de inicio local ("18:00"). */
  startLabel?: string | null;
  onDirections: () => void;
  /** Solo con urgencia soon/late: abre LateSheet. */
  onLate?: () => void;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function HeroLeave({ countdown, faces, title, placeName, startLabel, onDirections, onLate, onPress, onLongPress }: Props) {
  const where = [placeName, startLabel].filter(Boolean).join(' · ');
  return (
    <HeroCard onPress={onPress} onLongPress={onLongPress}>
      {countdown}
      <HeroHead label={`Salí para ${title}${where ? `, ${where}` : ''}`} onPress={onPress} onLongPress={onLongPress}>
        <Text style={heroText.title} numberOfLines={2}>
          {title}
        </Text>
        {where ? (
          <Text style={heroText.place} numberOfLines={1}>
            {where}
          </Text>
        ) : null}
      </HeroHead>
      {faces ? <View>{faces}</View> : null}
      <HeroActions
        primary={{ label: 'Cómo llego', onPress: onDirections, hint: 'Abre el mapa con indicaciones' }}
        secondary={onLate ? { label: 'Voy tarde', onPress: onLate, hint: 'Avisá al grupo o mové el bloque' } : null}
      />
    </HeroCard>
  );
}
