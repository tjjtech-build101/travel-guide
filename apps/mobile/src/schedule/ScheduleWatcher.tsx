// Monta el vigilante de horarios dentro de un viaje: le pasa los bloques (React Query + Realtime), el perfil
// (quiet_hours) y la posición del LocationProvider, y lo corre cada ~60 s en primer plano, al volver a primer plano
// y cuando cambia la hora simulada de Ahora. En segundo plano lo corre la task de ubicación (tour/backgroundLocation).
import { QuietHours } from '@build101/shared';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useClockStore } from '../features/now/clock';
import { useMe, usePlanBlocks, usePlanOverview } from '../features/plan/queries';
import { useMyProfile } from '../features/profile/queries';
import { useTrip } from '../features/trips/queries';
import { useLocationProvider } from '../location/LocationContext';
import { useScheduleStore } from './store';

const EVERY_MS = 60_000;

/** profiles.quiet_hours si existe y tiene forma válida ({start:'23:00', end:'08:00', tz}); si no, sin silencio. */
function parseQuietHours(v: unknown): { start: string; end: string } | null {
  const r = QuietHours.partial({ tz: true }).safeParse(v);
  return r.success ? r.data : null;
}

export function ScheduleWatcher({ tripId }: { tripId: string }) {
  const me = useMe();
  const trip = useTrip(tripId);
  const overview = usePlanOverview(tripId);
  const blocks = usePlanBlocks(tripId);
  const profile = useMyProfile();
  const { provider } = useLocationProvider();
  const offsetMs = useClockStore((s) => s.offsetMs);

  const ready = !!overview.data && !!blocks.data && !!me;
  useEffect(() => {
    const store = useScheduleStore.getState();
    if (!ready) {
      store.setContext(null);
      return;
    }
    store.setContext({
      tripId,
      me,
      trip: trip.data ?? null,
      legs: overview.data!.legs,
      blocks: blocks.data!,
      quietHours: parseQuietHours(profile.data?.quiet_hours),
      getHere: () => {
        const f = provider.getCurrent();
        return f ? { lat: f.lat, lng: f.lng } : null;
      },
    });
    // Cambió el plan (Realtime) o la posición de origen: una pasada enseguida.
    void store.run({ source: 'datos' });
  }, [ready, tripId, me, trip.data, overview.data, blocks.data, profile.data?.quiet_hours, provider]);

  useEffect(() => {
    if (!ready) return;
    const run = (source: string) => void useScheduleStore.getState().run({ source });
    const timer = setInterval(() => run('timer'), EVERY_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') run('primer plano');
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready]);

  // Hora simulada de Ahora (menú dev o ?at=…): evaluar con la hora nueva.
  useEffect(() => {
    if (ready) void useScheduleStore.getState().run({ source: 'reloj' });
  }, [offsetMs, ready]);

  useEffect(() => () => useScheduleStore.getState().setContext(null), []);

  return null;
}
