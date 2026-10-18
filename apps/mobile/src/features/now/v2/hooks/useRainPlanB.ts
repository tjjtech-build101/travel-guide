// Plan B por lluvia (docs/AHORA-V2.md): bloque al aire libre del día en la franja de lluvia y si hay variante 'rain'.
import { useMemo } from 'react';

import type { PlanBlock } from '../../../plan/selectors';
import type { RainPlanB, WeatherSummary } from '../types';
import { rainPlanB } from './pure';

export function useRainPlanB(args: {
  weather: WeatherSummary | null;
  dayBlocks: PlanBlock[];
  allBlocks: PlanBlock[];
  dayId: string | null;
}): RainPlanB | null {
  const { weather, dayBlocks, allBlocks, dayId } = args;
  return useMemo(() => rainPlanB({ weather, dayBlocks, allBlocks, dayId }), [weather, dayBlocks, allBlocks, dayId]);
}
