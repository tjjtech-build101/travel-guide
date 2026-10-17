// Protagonista "tu tour": resumen del recorrido (paradas, duración, km) y "Empezar tour".
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { formatMinutes } from '../../selectors';
import { HeroActions, HeroCard, heroText, Kicker } from './HeroState';

export type TourPreviewProps = {
  stopsCount: number;
  durationMin: number | null;
  distanceKm: number | null;
  /** Primeras 3 paradas. */
  stopNames?: string[];
  map?: ReactNode;
};

function km(n: number): string {
  return `${n < 10 ? n.toFixed(1).replace('.', ',') : Math.round(n)} km`;
}

export function TourPreview({ stopsCount, durationMin, distanceKm, stopNames, map }: TourPreviewProps) {
  const stats = [
    `${stopsCount} ${stopsCount === 1 ? 'parada' : 'paradas'}`,
    durationMin ? formatMinutes(durationMin) : null,
    distanceKm ? km(distanceKm) : null,
  ].filter(Boolean) as string[];
  const names = (stopNames ?? []).slice(0, 3);
  return (
    <View style={styles.preview} accessible accessibilityLabel={`${stats.join(', ')}${names.length ? `. ${names.join(', ')}` : ''}`}>
      {map ? <View style={styles.map}>{map}</View> : null}
      <Text style={styles.stats}>{stats.join(' · ')}</Text>
      {names.length ? (
        <Text style={heroText.place} numberOfLines={2}>
          {names.join(' → ')}
          {stopsCount > names.length ? ' …' : ''}
        </Text>
      ) : null}
    </View>
  );
}

type Props = TourPreviewProps & {
  title: string;
  when: 'current' | 'next';
  /** Hora local de inicio ("11:00"), si when = next. */
  startLabel?: string | null;
  onStart: () => void;
  starting?: boolean;
  /** Mensaje si no se pudo empezar. */
  error?: string | null;
  onPress?: () => void;
};

export function HeroTour({ title, when, startLabel, onStart, starting, error, onPress, ...preview }: Props) {
  const status = when === 'current' ? 'En curso' : startLabel ? `Empieza a las ${startLabel}` : 'Empieza pronto';
  return (
    <HeroCard onPress={onPress} accessibilityLabel={`Tu tour: ${title}. ${status}`}>
      <Kicker color={colors.scout}>TU TOUR</Kicker>
      <Text style={heroText.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={heroText.meta}>{status}</Text>
      <TourPreview {...preview} />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <HeroActions
        primary={{
          label: error ? 'Probar de nuevo' : 'Empezar tour',
          onPress: onStart,
          loading: starting,
          hint: 'Arranca el tour guiado con el Scout',
        }}
      />
    </HeroCard>
  );
}

const styles = StyleSheet.create({
  preview: { gap: space.xs, marginTop: space.xs },
  map: { borderRadius: radius.md, overflow: 'hidden', marginBottom: space.xs },
  stats: { fontSize: font.body, fontWeight: '700', color: colors.text },
  error: { fontSize: font.small, fontWeight: '600', color: colors.danger },
});
