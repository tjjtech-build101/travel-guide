// PRD 16: pronóstico (Open-Meteo). Si viene day_id, persiste/reusa days.weather (<3h).
import type { ToolInput } from '@build101/shared';
import type { WeatherDay } from '@build101/shared';
import { dbError } from '../errors';
import { fetchForecast } from '../google/openMeteo';
import type { ToolCtx, ToolOk } from './types';

const FRESH_MS = 3 * 60 * 60 * 1000;

export async function weather(input: ToolInput<'weather'>, ctx: ToolCtx): Promise<ToolOk> {
  const { admin } = ctx;

  if (input.day_id) {
    const { data: day, error } = await admin.from('days').select('date,weather').eq('id', input.day_id).maybeSingle();
    if (error) throw dbError(error, 'days');
    const existing = day?.weather as WeatherDay | null | undefined;
    if (existing?.fetched_at && Date.now() - Date.parse(existing.fetched_at) < FRESH_MS) {
      return { ok: true, data: { available: true, days: [existing] } };
    }
  }

  const result = await fetchForecast({ lat: input.lat, lng: input.lng, date_from: input.date_from, date_to: input.date_to });

  if (input.day_id && result.available) {
    const { data: day } = await admin.from('days').select('date').eq('id', input.day_id).maybeSingle();
    const dayWeather = result.days.find((d) => d.date === day?.date) ?? result.days[0] ?? null;
    if (dayWeather) {
      const { error: eUpd } = await admin.from('days').update({ weather: dayWeather }).eq('id', input.day_id);
      if (eUpd) throw dbError(eUpd, 'days');
    }
  }

  return { ok: true, data: result };
}
