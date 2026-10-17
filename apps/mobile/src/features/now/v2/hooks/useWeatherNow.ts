// Clima de ahora para el WeatherChip (docs/AHORA-V2.md): herramienta weather del día (Open-Meteo; con day_id la API
// reusa days.weather < 3 h). Se pide cada 30 min como mucho; el resumen se recalcula con la hora local.
import { type WeatherDay, zonedParts } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { callToolOrThrow } from '../../../../lib/api';
import { useNow } from '../../clock';
import type { WeatherSummary } from '../types';
import { summarizeWeather } from './pure';

type WeatherResult = { available: true; days: WeatherDay[] } | { available: false; from: string };

export function useWeatherNow(args: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Fecha local del tramo (YYYY-MM-DD). */
  date: string | null | undefined;
  dayId?: string | null;
  /** Zona IANA del tramo. */
  tz: string;
}): WeatherSummary | null {
  const { lat, lng, date, dayId, tz } = args;
  const enabled = lat != null && lng != null && !!date;
  const q = useQuery({
    // Fuera de ['trip', …]: el clima no cambia por Realtime. Celda de ~1 km para no repedir con cada paso.
    queryKey: ['weather', 'now', dayId ?? null, date, enabled ? `${lat!.toFixed(2)},${lng!.toFixed(2)}` : null],
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: async (): Promise<WeatherDay | null> => {
      const res = await callToolOrThrow<'weather', WeatherResult>('weather', {
        lat: lat!,
        lng: lng!,
        date_from: date!,
        date_to: date!,
        ...(dayId ? { day_id: dayId } : {}),
      });
      if (!res.data.available) return null;
      return res.data.days.find((d) => d.date === date) ?? res.data.days[0] ?? null;
    },
  });
  const { now } = useNow();
  const minute = zonedParts(now, tz).minutes;
  // Recalcular cada 15 min alcanza (la hora del chip y "llueve a las 15").
  const bucket = Math.floor(minute / 15);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => summarizeWeather(q.data, minute), [q.data, bucket]);
}
