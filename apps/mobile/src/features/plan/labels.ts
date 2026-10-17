// Labels en español (nunca mostrar 'meal' / 'confirmed' crudos) y colores de tramos.
import type { BlockStatus, BlockType, TimeFlex, TransferMode } from '@build101/shared';

export const TYPE_LABEL: Record<BlockType, string> = {
  activity: 'Actividad',
  meal: 'Comida',
  tour: 'Tour',
  transfer: 'Traslado',
  lodging: 'Alojamiento',
  free: 'Libre',
  meetup: 'Encuentro',
};

export const STATUS_LABEL: Record<BlockStatus, string> = {
  idea: 'Idea',
  proposed: 'Propuesto',
  confirmed: 'Confirmado',
  booked: 'Reservado',
};

export const STATUS_COLORS: Record<BlockStatus, { bg: string; fg: string }> = {
  idea: { bg: '#F1EDE4', fg: '#6B6658' },
  proposed: { bg: '#FFF3D6', fg: '#8A5A00' },
  confirmed: { bg: '#E3F2E6', fg: '#1E6B34' },
  booked: { bg: '#E3ECFB', fg: '#1D4FA8' },
};

export const TIME_FLEX_LABEL: Record<TimeFlex, string> = {
  fixed: 'Hora fija',
  morning: 'Mañana',
  afternoon: 'Tarde',
  evening: 'Noche',
  any: 'Cuando sea',
};

export const TRANSFER_MODE_LABEL: Record<TransferMode, string> = {
  walk: 'A pie',
  transit: 'Transporte público',
  bus: 'Bus',
  ferry: 'Ferry',
  flight: 'Avión',
  car: 'Auto',
};

export const ROLE_LABEL = { organizer: 'Organiza', traveler: 'Viaja', follower: 'Sigue el viaje' } as const;

/** Colores de alertas por kind (closes | late | rain | diet). */
export const ALERT_COLORS: Record<string, { bg: string; fg: string }> = {
  closes: { bg: '#FFF1DB', fg: '#8A4B00' },
  late: { bg: '#FBE4E1', fg: '#A8261B' },
  rain: { bg: '#E1EEFB', fg: '#1D4F8A' },
  diet: { bg: '#E6F4E3', fg: '#2F6B1E' },
};
export const ALERT_FALLBACK = { bg: '#F1EDE4', fg: '#5F5D57' };

export const ALERT_LABEL: Record<string, string> = {
  closes: 'Horario',
  late: 'Llegamos tarde',
  rain: 'Lluvia',
  diet: 'Comida',
};

/**
 * 8 colores accesibles para tramos (contraste AA sobre blanco con texto blanco).
 * TODO(shared): el PRD pide LEG_COLORS en packages/shared/src/constants.ts (lo usa también el Mapa);
 * vive acá hasta que se mueva.
 */
// Del uniforme del Scout (sombrero, pañuelo, lago, bronce, oliva, cinta); todos se leen con texto blanco.
export const LEG_COLORS = ['#8A6236', '#D33B2D', '#3567A0', '#B07A16', '#6E7744', '#5A3921'] as const;

/**
 * Color del tramo por su posición en el viaje (sort_order, fecha, id). Los tramos paralelos comparten
 * sort_order en el seed, por eso se usa la posición y no sort_order crudo.
 */
export function legColorMap(legs: { id: string; sort_order: number; start_date: string }[]): Map<string, string> {
  const sorted = [...legs].sort(
    (a, b) => a.sort_order - b.sort_order || a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id),
  );
  return new Map(sorted.map((l, i) => [l.id, LEG_COLORS[i % LEG_COLORS.length]]));
}
