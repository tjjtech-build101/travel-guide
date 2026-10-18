// Interfaz única de ubicación (Arquitectura, principio 5). Todo lo que use ubicación consume esto.

export type LocationFix = {
  /** epoch ms */
  t: number;
  lat: number;
  lng: number;
  heading: number | null;
  speed?: number | null;
  accuracy: number;
};

export interface LocationProvider {
  readonly kind: 'real' | 'simulated';
  start(): Promise<void>;
  stop(): void;
  getCurrent(): LocationFix | null;
  /** Lectura nueva en este momento (el real le pide al GPS; el simulado devuelve su punto actual). null si no llega a tiempo. */
  requestFix(timeoutMs: number): Promise<LocationFix | null>;
  subscribe(cb: (fix: LocationFix) => void): () => void;
}

/** Punto de un track grabado: `t` = segundos desde el inicio, `heading` puede ser null. */
export type TrackPoint = {
  t: number;
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number;
};

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Velocidades de reproducción del simulador (PRD 09). */
export const SIM_SPEEDS = [1, 2, 5, 10] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

export type SimulatorState = {
  playing: boolean;
  /** segundos desde el inicio del track */
  t: number;
  duration: number;
  speed: SimSpeed;
  /** null = sin track cargado (no emite nada) */
  trackLabel: string | null;
};

/** Controles extra del provider simulado (solo menú dev y mini controles; el resto usa LocationProvider). */
export interface SimulatedControls {
  load(track: TrackPoint[], label: string): void;
  play(): void;
  pause(): void;
  setSpeed(x: SimSpeed): void;
  /** Salta al segundo `tSeconds` del track. */
  seek(tSeconds: number): void;
  /** Salta al punto del track más cercano a (lat, lng) menos `leadSeconds` (default 15) de recorrido. */
  seekToPoint(lat: number, lng: number, leadSeconds?: number): void;
  getState(): SimulatorState;
  onState(cb: (s: SimulatorState) => void): () => void;
}
