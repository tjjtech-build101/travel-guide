// SimulatedLocationProvider: esqueleto que cumple la interfaz.
// Por ahora emite un punto fijo en Plaza Independencia (Montevideo) cada segundo.
// El replay del track grabado (supabase/seed/ciudad-vieja-track.json) es de otro PRD: va en loadTrack()/replay.
import type { LocationFix, LocationProvider, TrackPoint } from '@build101/shared';

import { Emitter } from './emitter';

export const PLAZA_INDEPENDENCIA = { lat: -34.90656, lng: -56.19903 } as const;

const TICK_MS = 1000;

export class SimulatedLocationProvider implements LocationProvider {
  readonly kind = 'simulated' as const;
  private emitter = new Emitter<LocationFix>();
  private current: LocationFix | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private track: TrackPoint[] | null = null;

  /** Hook para el PRD del replay: cargar un track y reproducirlo en vez del punto fijo. */
  loadTrack(track: TrackPoint[]) {
    this.track = track;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    const tick = () => {
      const p = this.track?.[0] ?? { ...PLAZA_INDEPENDENCIA, heading: 0, accuracy: 5 };
      this.emit({ t: Date.now(), lat: p.lat, lng: p.lng, heading: p.heading, speed: 0, accuracy: p.accuracy });
    };
    tick();
    this.timer = setInterval(tick, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getCurrent(): LocationFix | null {
    return this.current;
  }

  subscribe(cb: (fix: LocationFix) => void): () => void {
    return this.emitter.subscribe(cb);
  }

  private emit(fix: LocationFix) {
    this.current = fix;
    this.emitter.emit(fix);
  }
}
