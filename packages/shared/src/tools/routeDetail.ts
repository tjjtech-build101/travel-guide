// Ruta detallada para "Cómo llego" embebido en Ahora (docs/AHORA-V2.md → "Cómo llego").
// route_eta con `detail: true` y exactamente 2 paradas devuelve, además de lo de siempre, `detail: RouteDetail`.
import type { RouteMode } from '../constants';

export type RouteStepDetail = {
  /**
   * "Doblá a la derecha en Sarandí" (localizado por Google). En transit los tramos a pie vienen agrupados
   * ("Caminá 4 min hasta la parada Ciudadela") y los de vehículo armados ("Tomá el bus 121 hacia Pocitos").
   */
  instruction: string;
  /** Maniobra de Google (TURN_LEFT, STRAIGHT, …) para elegir ícono; null si no hay (pasos agrupados, transit, estimado). */
  maneuver: string | null;
  distance_m: number;
  /** Redondeado: un paso de navegación corto (< 30 s) puede dar 0. Los pasos agrupados/transit son ≥ 1. */
  duration_min: number;
  /** Cómo se hace este paso (en transit hay pasos `walk` y `transit`). Opcional por compatibilidad; la API siempre lo manda. */
  mode?: RouteMode;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  /** Solo transit: tramo en vehículo ("Bus 121 · sale 18:05 · 6 paradas"). */
  transit?: {
    line: string;
    vehicle: 'bus' | 'subway' | 'train' | 'tram' | 'ferry' | 'other';
    from_stop?: string;
    to_stop?: string;
    departure?: string;
    arrival?: string;
    headsign?: string;
    stops?: number;
  };
};

export type RouteDetail = {
  mode: RouteMode;
  duration_min: number;
  distance_m: number;
  /** Polilínea codificada de Google (precision 5) de toda la ruta; null si es estimada. */
  polyline: string | null;
  steps: RouteStepDetail[];
  /** true = sin Google (línea recta estimada). */
  estimated: boolean;
};
