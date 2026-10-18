// Protagonista "tu tour": resumen del recorrido (paradas, duración, km) y "Empezar tour".
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorNotice } from '../../../../ui/ErrorNotice';
import { Skeleton } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import { formatMinutes } from '../../selectors';
import { HeroActions, HeroCard, HeroHead, heroText, Kicker } from './HeroState';

export type TourPreviewProps = {
  stopsCount: number;
  durationMin: number | null;
  distanceKm: number | null;
  /** Primeras 3 paradas. */
  stopNames?: string[];
  map?: ReactNode;
  /** Todavía no llegó el resumen del tour: una línea esqueleto. */
  loading?: boolean;
};

function km(n: number): string {
  return `${n < 10 ? n.toFixed(1).replace('.', ',') : Math.round(n)} km`;
}

export function TourPreview({ stopsCount, durationMin, distanceKm, stopNames, map, loading }: TourPreviewProps) {
  if (loading) return <Skeleton width="60%" height={18} style={styles.preview} />;
  const stats = [
    stopsCount ? `${stopsCount} ${stopsCount === 1 ? 'parada' : 'paradas'}` : null,
    durationMin ? formatMinutes(durationMin) : null,
    distanceKm ? km(distanceKm) : null,
  ].filter(Boolean) as string[];
  const names = (stopNames ?? []).slice(0, 3);
  if (!stats.length && !names.length && !map) return null;
  return (
    <View style={styles.preview} accessible accessibilityLabel={`${stats.join(', ')}${names.length ? `. ${names.join(', ')}` : ''}`}>
      {map ? <View style={styles.map}>{map}</View> : null}
      {stats.length ? <Text style={styles.stats}>{stats.join(' · ')}</Text> : null}
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
  /** Por qué no se pudo empezar (AppError de tour/store o texto): lib/errors lo explica en criollo. */
  error?: unknown;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function HeroTour({ title, when, startLabel, onStart, starting, error, onPress, onLongPress, ...preview }: Props) {
  const status = when === 'current' ? 'En curso' : startLabel ? `Empieza a las ${startLabel}` : 'Empieza pronto';
  return (
    <HeroCard onPress={onPress} onLongPress={onLongPress}>
      <Kicker color={colors.scout}>TU TOUR</Kicker>
      <HeroHead label={`Tu tour: ${title}. ${status}`} onPress={onPress} onLongPress={onLongPress}>
        <Text style={heroText.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={heroText.meta}>{status}</Text>
      </HeroHead>
      <TourPreview {...preview} />
      {error ? <ErrorNotice error={error} doing="empezar el tour" compact /> : null}
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
});
