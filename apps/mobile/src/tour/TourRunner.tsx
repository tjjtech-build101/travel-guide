// Conecta el tour en vivo con el mundo (PRD 07): muestras del LocationProvider (real | simulado) → motor, reloj cada
// 15 s, ubicación en segundo plano con GPS real y permiso "siempre". Va montado una sola vez en el layout raíz.
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerFreshPositionTools, setFreshPositionSource } from '../location/freshPositionTools';
import { useLocationProvider } from '../location/LocationContext';
import { startBackgroundUpdates, stopBackgroundUpdates } from './backgroundLocation';
import { useTourStore } from './store';
import { registerTourVoiceTools } from './voiceTools';

const TICK_MS = 15_000;

export function TourRunner() {
  const { provider, kind, start, active } = useLocationProvider();
  const phase = useTourStore((s) => s.phase);
  const background = useTourStore((s) => s.background);

  useEffect(() => {
    registerTourVoiceTools();
    registerFreshPositionTools();
    void useTourStore.getState().hydrate();
  }, []);

  // Posición fresca para search_places / route_eta de la voz (location/freshPositionTools.ts).
  useEffect(() => setFreshPositionSource(() => provider.getCurrent()), [provider]);

  // Motor: cada muestra del provider actual + reloj.
  useEffect(() => {
    if (phase !== 'live') return;
    if (!active) void start();
    const store = useTourStore.getState;
    const feed = (f: { t: number; lat: number; lng: number; speed?: number | null; accuracy: number }) =>
      store().onFix({ t: f.t, lat: f.lat, lng: f.lng, speed: f.speed ?? null, accuracy: f.accuracy });
    const cur = provider.getCurrent();
    if (cur) feed(cur);
    const unsub = provider.subscribe(feed);
    const timer = setInterval(() => store().tick(), TICK_MS);
    // Al volver a primer plano, un tick enseguida (el reloj no corrió en segundo plano en iOS).
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') store().tick();
    });
    return () => {
      unsub();
      clearInterval(timer);
      appSub.remove();
    };
  }, [phase, provider, active, start]);

  // GPS real + permiso "siempre": actualizaciones en segundo plano mientras dura el tour.
  useEffect(() => {
    if (phase === 'live' && kind === 'real' && background === 'always') {
      void startBackgroundUpdates();
      return () => void stopBackgroundUpdates();
    }
    void stopBackgroundUpdates();
    return undefined;
  }, [phase, kind, background]);

  return null;
}
