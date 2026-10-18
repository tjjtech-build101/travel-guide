// Chip del clima para el encabezado de Ahora: ícono + "18°". Sin datos no se muestra.
import type { ComponentType } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { CloudIcon, FogIcon, RainIcon, SnowIcon, StormIcon, SunIcon } from '../../../../ui/icons';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';
import type { WeatherSummary } from '../types';

const ICONS: Record<WeatherSummary['icon'], ComponentType<{ color: ColorValue; size?: number }>> = {
  sun: SunIcon,
  cloud: CloudIcon,
  rain: RainIcon,
  storm: StormIcon,
  snow: SnowIcon,
  fog: FogIcon,
};

export function WeatherChip({ weather }: { weather: WeatherSummary | null }) {
  if (!weather) return null;
  const Icon = ICONS[weather.icon] ?? CloudIcon;
  const temp = weather.temp_c !== null ? `${Math.round(weather.temp_c)}°` : null;
  return (
    <View
      style={styles.chip}
      accessible
      accessibilityLabel={`Clima: ${weather.summary}${temp ? `, ${Math.round(weather.temp_c ?? 0)} grados` : ''}`}
    >
      <Icon color={weather.icon === 'sun' ? colors.bronzeText : colors.khakiText} size={18} />
      {temp ? <Text style={styles.temp}>{temp}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.khakiLight,
  },
  temp: { fontSize: font.small, fontWeight: '700', color: colors.khakiText, fontVariant: ['tabular-nums'] },
});
