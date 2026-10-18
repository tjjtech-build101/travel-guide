// SimulatedLocationProvider (PRD 09): reproduce un track grabado [{t, lat, lng, heading, accuracy}] como si fuera
// el GPS real. Emite por la misma interfaz LocationProvider, así mapa, geofences y tour no saben que es simulado.
// - Reproduciendo: tick cada 250 ms (≥4 fixes/s), t += Δreal × velocidad; si el paso supera 10 m se emiten
//   sub-muestras (a 10x no se saltea ninguna geofence).
// - En pausa: reemite la posición actual cada 1 s (igual que el real cuando estás quieto).
// - Sin track: no emite nada.
// `speed` emitido = velocidad del track (no × reproducción); `t` = Date.now() (los timers del tour usan reloj real).
import {
  advanceClock,
  type LocationFix,
  type LocationProvider,
  type SimSpeed,
  type SimulatedControls,
  type SimulatorState,
  TrackCursor,
  type TrackPoint,
} from '@build101/shared';

import { Emitter } from './emitter';

export const PLAZA_INDEPENDENCIA = { lat: -34.90656, lng: -56.19903 } as const;

const TICK_MS = 250;
const HEARTBEAT_MS = 1000;
const MAX_STEP_M = 10;

export class SimulatedLocationProvider implements LocationProvider, SimulatedControls {
  readonly kind = 'simulated' as const;
  private emitter = new Emitter<LocationFix>();
  private stateEmitter = new Emitter<SimulatorState>();
  private current: LocationFix | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor: TrackCursor | null = null;
  private label: string | null = null;
  private t = 0;
  private playing = false;
  private speed: SimSpeed = 1;
  private lastTickAt = 0;
  private lastEmitAt = 0;
  private running = false;

  // ---------- LocationProvider ----------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emitAt(this.t);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getCurrent(): LocationFix | null {
    return this.current;
  }

  requestFix(): Promise<LocationFix | null> {
    // Aunque nadie lo haya arrancado (no emite), el punto del track en `t` es dónde "está".
    if (!this.cursor) return Promise.resolve(this.current ? { ...this.current, t: Date.now() } : null);
    const s = this.cursor.sampleAt(this.t);
    return Promise.resolve({ t: Date.now(), lat: s.lat, lng: s.lng, heading: s.heading, speed: s.speed, accuracy: s.accuracy });
  }

  subscribe(cb: (fix: LocationFix) => void): () => void {
    return this.emitter.subscribe(cb);
  }

  // ---------- SimulatedControls ----------

  load(track: TrackPoint[], label: string): void {
    this.cursor = new TrackCursor(track);
    this.label = label;
    this.t = 0;
    this.playing = false;
    this.current = null;
    this.emitAt(0);
    this.emitState();
  }

  /**
   * Modo demo (Ahora v2, `?loc=near`): se queda quieto en un punto arbitrario (track de 2 puntos iguales, en pausa).
   * Reemite cada 1 s como cuando estás quieto. Cargar otro track lo reemplaza.
   */
  placeAt(lat: number, lng: number, label = 'Punto fijo (demo)'): void {
    const p = { lat, lng, heading: null, accuracy: 5 };
    this.load([{ t: 0, ...p }, { t: 1, ...p }], label);
  }

  /** Descarga el track (vuelve al estado vacío: no emite nada). */
  unload(): void {
    this.cursor = null;
    this.label = null;
    this.t = 0;
    this.playing = false;
    this.current = null;
    this.emitState();
  }

  play(): void {
    if (!this.cursor) return;
    if (this.t >= this.cursor.duration) this.t = 0;
    this.playing = true;
    this.lastTickAt = Date.now();
    this.emitState();
  }

  pause(): void {
    this.playing = false;
    this.emitState();
  }

  setSpeed(x: SimSpeed): void {
    this.speed = x;
    this.emitState();
  }

  seek(tSeconds: number): void {
    if (!this.cursor) return;
    this.t = Math.min(this.cursor.duration, Math.max(0, tSeconds));
    this.lastTickAt = Date.now();
    // Un salto es un salto: no se subdivide (si no, a 10 m por muestra serían cientos de fixes de golpe).
    this.emitAt(this.t);
    this.emitState();
  }

  seekToPoint(lat: number, lng: number, leadSeconds = 15): void {
    if (!this.cursor) return;
    this.seek(this.cursor.seekTargetFor({ lat, lng }, leadSeconds));
  }

  getState(): SimulatorState {
    return {
      playing: this.playing,
      t: this.t,
      duration: this.cursor?.duration ?? 0,
      speed: this.speed,
      trackLabel: this.label,
    };
  }

  onState(cb: (s: SimulatorState) => void): () => void {
    return this.stateEmitter.subscribe(cb);
  }

  /** Track cargado (para dibujarlo o persistirlo). */
  getTrack(): TrackPoint[] | null {
    return this.cursor?.track ?? null;
  }

  // ---------- internos ----------

  private tick() {
    const now = Date.now();
    const delta = now - this.lastTickAt;
    this.lastTickAt = now;
    if (!this.cursor) return;
    if (!this.playing) {
      if (now - this.lastEmitAt >= HEARTBEAT_MS) this.emitAt(this.t);
      return;
    }
    const from = this.t;
    const next = advanceClock({ t: from, playing: true }, delta, this.speed, this.cursor.duration);
    const steps = this.cursor.stepsBetween(from, next.t, MAX_STEP_M);
    // Sub-muestras repartidas en el intervalo real para que `t` (epoch ms) sea creciente.
    steps.forEach((ts, i) => this.emitAt(ts, now - Math.round(((steps.length - 1 - i) * delta) / steps.length)));
    this.t = next.t;
    this.playing = next.playing;
    this.emitState();
  }

  private emitAt(trackT: number, at = Date.now()) {
    if (!this.cursor || !this.running) return;
    const s = this.cursor.sampleAt(trackT);
    const fix: LocationFix = {
      t: at,
      lat: s.lat,
      lng: s.lng,
      heading: s.heading,
      speed: s.speed,
      accuracy: s.accuracy,
    };
    this.current = fix;
    this.lastEmitAt = Date.now();
    this.emitter.emit(fix);
  }

  private emitState() {
    this.stateEmitter.emit(this.getState());
  }
}
