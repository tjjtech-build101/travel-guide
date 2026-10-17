// RealLocationProvider: expo-location en primer plano (posición + brújula).
// El permiso se pide en start(), que se llama en el momento justo (al abrir Mapa o voz), nunca al iniciar la app.
import type { LocationFix, LocationProvider } from '@build101/shared';
import * as Location from 'expo-location';

import { backgroundFixes } from './backgroundFixes';
import { Emitter } from './emitter';

/** Si no hubo fix nuevo en este tiempo, reemitimos el último (quieto, iOS no manda updates por distanceInterval). */
const HEARTBEAT_MS = 1000;
const HEADING_THROTTLE_MS = 1000;

export class LocationPermissionError extends Error {
  constructor(public canAskAgain: boolean) {
    super('Permiso de ubicación denegado');
    this.name = 'LocationPermissionError';
  }
}

export class RealLocationProvider implements LocationProvider {
  readonly kind = 'real' as const;
  private emitter = new Emitter<LocationFix>();
  private current: LocationFix | null = null;
  private heading: number | null = null;
  private positionSub: Location.LocationSubscription | null = null;
  private headingSub: Location.LocationSubscription | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastEmit = 0;
  private starting: Promise<void> | null = null;
  private bgSub: (() => void) | null = null;

  start(): Promise<void> {
    if (this.positionSub) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.doStart().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async doStart() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') throw new LocationPermissionError(perm.canAskAgain);

    this.positionSub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 2 },
      (loc) => {
        this.emit({
          t: loc.timestamp,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading: this.heading ?? validHeading(loc.coords.heading),
          speed: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
          accuracy: loc.coords.accuracy ?? 0,
        });
      },
    );

    try {
      this.headingSub = await Location.watchHeadingAsync((h) => {
        const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        this.heading = Number.isFinite(value) ? value : null;
        if (this.current && Date.now() - this.lastEmit >= HEADING_THROTTLE_MS) {
          this.emit({ ...this.current, t: Date.now(), heading: this.heading });
        }
      });
    } catch {
      // Sin brújula (simulador): seguimos con heading del GPS.
    }

    // Muestras de la task de segundo plano (tour en vivo con pantalla bloqueada): mismas que watchPosition.
    this.bgSub = backgroundFixes.subscribe((fix) => {
      if (!this.current || fix.t > this.current.t) this.emit({ ...fix, heading: this.heading ?? fix.heading });
    });

    this.heartbeat = setInterval(() => {
      if (this.current && Date.now() - this.lastEmit >= HEARTBEAT_MS) {
        this.emit({ ...this.current, t: Date.now() });
      }
    }, HEARTBEAT_MS);
  }

  stop(): void {
    this.positionSub?.remove();
    this.headingSub?.remove();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.bgSub?.();
    this.bgSub = null;
    this.positionSub = null;
    this.headingSub = null;
    this.heartbeat = null;
  }

  getCurrent(): LocationFix | null {
    return this.current;
  }

  subscribe(cb: (fix: LocationFix) => void): () => void {
    return this.emitter.subscribe(cb);
  }

  private emit(fix: LocationFix) {
    this.current = fix;
    this.lastEmit = Date.now();
    this.emitter.emit(fix);
  }
}

function validHeading(h: number | null | undefined): number | null {
  return h != null && h >= 0 ? h : null;
}
