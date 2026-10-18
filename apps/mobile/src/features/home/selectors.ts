// Selectores puros de la home (Inicio): saludo, viajes por momento y cuentas regresivas. Sin React ni red.
import { daysBetween, isTripInProgress, localParts } from '../now/selectors';
import type { TripCard } from '../trips/queries';

/** Hora de la home: la de la demo (UTC−3), igual que isTripInProgress. */
export const HOME_OFFSET_MIN = -180;

export function greeting(utcMs: number): string {
  const h = Math.floor(localParts(utcMs, HOME_OFFSET_MIN).minutes / 60);
  if (h >= 5 && h < 12) return 'Buen día';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

export type HomeTrips = {
  /** En curso (el primero va como héroe). */
  live: TripCard[];
  /** Por venir o sin fechas, el más cercano primero. */
  upcoming: TripCard[];
  /** Terminados, el más reciente primero. */
  past: TripCard[];
};

export function splitTrips(trips: TripCard[], utcMs: number): HomeTrips {
  const today = localParts(utcMs, HOME_OFFSET_MIN).date;
  const live: TripCard[] = [];
  const upcoming: TripCard[] = [];
  const past: TripCard[] = [];
  for (const t of trips) {
    if (isTripInProgress(t, utcMs, HOME_OFFSET_MIN)) live.push(t);
    else if (t.status === 'finished' || (t.end_date && t.end_date < today)) past.push(t);
    else upcoming.push(t);
  }
  // Sin fechas al final de los próximos.
  upcoming.sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
  past.sort((a, b) => (b.end_date ?? '').localeCompare(a.end_date ?? ''));
  return { live, upcoming, past };
}

/** Días hasta que arranca (0 = hoy); null si no tiene fecha de inicio. */
export function daysUntilStart(trip: Pick<TripCard, 'start_date'>, utcMs: number): number | null {
  if (!trip.start_date) return null;
  return daysBetween(localParts(utcMs, HOME_OFFSET_MIN).date, trip.start_date);
}

/** "Hoy", "Mañana", "En 12 días", "Sin fechas". */
export function countdownLabel(days: number | null): string {
  if (days === null) return 'Sin fechas';
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `En ${days} días`;
}

/** Día del viaje (1-based) y total, si tiene fechas. */
export function tripDayOf(trip: Pick<TripCard, 'start_date' | 'end_date'>, date: string): { day: number; total: number } | null {
  if (!trip.start_date || !trip.end_date) return null;
  const total = daysBetween(trip.start_date, trip.end_date) + 1;
  const day = Math.min(total, Math.max(1, daysBetween(trip.start_date, date) + 1));
  return { day, total };
}
