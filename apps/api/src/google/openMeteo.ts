// Open-Meteo (PRD 16): pronóstico diario + horario, sin key. https://open-meteo.com/en/docs
import type { WeatherDay } from '@build101/shared';
import { upstream } from '../errors';
import { cached } from './cache';

const BASE = 'https://api.open-meteo.com/v1/forecast';
/** Open-Meteo da pronóstico hasta 16 días vista. */
export const MAX_FORECAST_DAYS = 16;

type OpenMeteoResponse = {
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    weather_code: number[];
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    precipitation: number[];
    weather_code: number[];
  };
};

export type ForecastResult = { available: true; days: WeatherDay[] } | { available: false; from: string };

/** Primer día con pronóstico disponible (hoy en adelante, formato YYYY-MM-DD, UTC-naive). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pronóstico normalizado para [date_from, date_to]. Si date_from está a más de MAX_FORECAST_DAYS,
 * devuelve {available:false, from} sin llamar a la API (no tiene sentido pedir algo que no va a traer).
 */
export async function fetchForecast(args: { lat: number; lng: number; date_from: string; date_to: string }): Promise<ForecastResult> {
  const today = todayUtc();
  const daysOut = Math.round((Date.parse(`${args.date_from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (daysOut > MAX_FORECAST_DAYS) {
    const from = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_FORECAST_DAYS * 86_400_000).toISOString().slice(0, 10);
    return { available: false, from };
  }
  return cached(
    `weather:${args.lat}:${args.lng}:${args.date_from}:${args.date_to}`,
    async () => {
      const q = new URLSearchParams({
        latitude: String(args.lat),
        longitude: String(args.lng),
        hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
        timezone: 'auto',
        start_date: args.date_from,
        end_date: args.date_to,
      });
      let res: Response;
      try {
        res = await fetch(`${BASE}?${q}`, { signal: AbortSignal.timeout(8000) });
      } catch (err) {
        throw upstream(`Open-Meteo no respondió: ${(err as Error).message}`);
      }
      if (!res.ok) throw upstream(`Open-Meteo respondió ${res.status}`);
      const body = (await res.json()) as OpenMeteoResponse;
      const fetched_at = new Date().toISOString();
      const daily = body.daily;
      if (!daily) return { available: true, days: [] } as ForecastResult;
      const hourlyByDate = new Map<string, WeatherDay['hourly']>();
      const hourly = body.hourly;
      if (hourly) {
        for (let i = 0; i < hourly.time.length; i++) {
          const [date, h] = hourly.time[i].split('T');
          const list = hourlyByDate.get(date) ?? [];
          list.push({ h, t: hourly.temperature_2m[i], pp: hourly.precipitation_probability[i], mm: hourly.precipitation[i], code: hourly.weather_code[i] });
          hourlyByDate.set(date, list);
        }
      }
      const days: WeatherDay[] = daily.time.map((date, i) => ({
        date,
        fetched_at,
        tmax: daily.temperature_2m_max[i],
        tmin: daily.temperature_2m_min[i],
        precip_prob_max: daily.precipitation_probability_max[i],
        code: daily.weather_code[i],
        hourly: hourlyByDate.get(date) ?? [],
      }));
      return { available: true, days } as ForecastResult;
    },
    3 * 60 * 60 * 1000, // 3h, PRD 16: "se reutiliza si tiene menos de 3h"
  );
}

// ───────────────────────── Tour director: clima en la ventana del tour + puesta del sol + hora local

export type TourWeather = {
  /** Offset de la zona del punto (para pasar start_at a hora local: horarios de apertura). */
  utc_offset_s: number;
  tz: string | null;
  /** "HH:MM" local. */
  sunset: string | null;
  /** Horas locales que toca el tour. */
  hours: { h: string; t: number; pp: number; code: number }[];
  max_precip_prob: number;
  temp_c: number | null;
};

type TourMeteoResponse = OpenMeteoResponse & {
  utc_offset_seconds?: number;
  timezone?: string;
  daily?: OpenMeteoResponse['daily'] & { sunset?: string[] };
};

/** Clima de las horas del tour. Nunca tira: null si Open-Meteo no responde. */
export async function tourWeather(args: { lat: number; lng: number; start: Date; duration_min: number }): Promise<TourWeather | null> {
  try {
    const body = await cached(
      `tour-weather:${args.lat.toFixed(2)}:${args.lng.toFixed(2)}:${args.start.toISOString().slice(0, 13)}`,
      async () => {
        const q = new URLSearchParams({
          latitude: String(args.lat),
          longitude: String(args.lng),
          hourly: 'temperature_2m,precipitation_probability,weather_code',
          daily: 'sunset',
          timezone: 'auto',
          past_days: '1',
          forecast_days: '3',
        });
        const res = await fetch(`${BASE}?${q}`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        return (await res.json()) as TourMeteoResponse;
      },
      60 * 60 * 1000,
    );
    const offset = body.utc_offset_seconds ?? 0;
    const local = new Date(args.start.getTime() + offset * 1000);
    const localDate = local.toISOString().slice(0, 10);
    const startH = local.getUTCHours();
    const endH = new Date(local.getTime() + args.duration_min * 60_000).getUTCHours();
    const hours: TourWeather['hours'] = [];
    const hr = body.hourly;
    if (hr) {
      for (let i = 0; i < hr.time.length; i++) {
        const [date, hh] = hr.time[i].split('T');
        const h = Number(hh.slice(0, 2));
        const inWindow = date === localDate && (endH >= startH ? h >= startH && h <= endH : h >= startH);
        if (inWindow) hours.push({ h: hh, t: hr.temperature_2m[i], pp: hr.precipitation_probability[i] ?? 0, code: hr.weather_code[i] });
      }
    }
    const dIdx = body.daily?.time.indexOf(localDate) ?? -1;
    const sunsetIso = dIdx >= 0 ? body.daily?.sunset?.[dIdx] : undefined;
    return {
      utc_offset_s: offset,
      tz: body.timezone ?? null,
      sunset: sunsetIso ? sunsetIso.slice(11, 16) : null,
      hours,
      max_precip_prob: hours.reduce((m, x) => Math.max(m, x.pp ?? 0), 0),
      temp_c: hours[0]?.t ?? null,
    };
  } catch {
    return null;
  }
}
