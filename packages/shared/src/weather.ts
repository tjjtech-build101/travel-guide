// Formas normalizadas del clima (PRD 16). days.weather guarda exactamente WeatherDay.

export type WeatherHour = { h: string; t: number; pp: number; mm: number; code: number };
export type WeatherDay = {
  date: string;
  fetched_at: string;
  tmax: number;
  tmin: number;
  precip_prob_max: number;
  code: number;
  hourly: WeatherHour[];
};

export type WeatherIcon = 'sun' | 'cloud' | 'cloud-sun' | 'fog' | 'rain' | 'storm' | 'snow';

/** Códigos WMO (Open-Meteo) → ícono simple para el chip de clima. */
export const WMO_ICON: Record<number, WeatherIcon> = {
  0: 'sun',
  1: 'cloud-sun',
  2: 'cloud-sun',
  3: 'cloud',
  45: 'fog',
  48: 'fog',
  51: 'rain',
  53: 'rain',
  55: 'rain',
  56: 'rain',
  57: 'rain',
  61: 'rain',
  63: 'rain',
  65: 'rain',
  66: 'rain',
  67: 'rain',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snow',
  80: 'rain',
  81: 'rain',
  82: 'rain',
  85: 'snow',
  86: 'snow',
  95: 'storm',
  96: 'storm',
  99: 'storm',
};

export function wmoIcon(code: number): WeatherIcon {
  return WMO_ICON[code] ?? 'cloud';
}
