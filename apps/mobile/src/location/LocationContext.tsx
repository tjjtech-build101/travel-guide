// Selección del LocationProvider (real | simulado). Todo lo que use ubicación consume esto.
// Solo el menú dev y los mini controles del simulador usan useSimulator(); el resto no sabe qué modo está activo.
import {
  CIUDAD_VIEJA_STOPS,
  type LocationFix,
  type LocationProvider,
  type NamedPoint,
  parseTrack,
  SIM_SPEEDS,
  type SimSpeed,
  type SimulatorState,
  type TrackPoint,
} from '@build101/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { RealLocationProvider } from './real';
import { SimulatedLocationProvider } from './simulated';

type Kind = LocationProvider['kind'];

type LocationContextValue = {
  provider: LocationProvider;
  kind: Kind;
  setKind: (kind: Kind) => void;
  /** Arranca el provider actual (o el de `kind`; pide permiso si es el real). Devuelve el error si falla. */
  start: (kind?: Kind) => Promise<Error | null>;
  active: boolean;
  simulator: SimulatedLocationProvider;
  /** Paradas para "Saltar a parada" (del tour elegido o las del seed). */
  simStops: NamedPoint[];
  /** Carga un track en el simulador y lo recuerda entre reinicios. */
  loadSimTrack: (track: TrackPoint[], label: string, stops?: NamedPoint[]) => void;
  /** Modo demo (`?loc=near`): pasa al simulado y lo deja quieto en ese punto (no se recuerda entre reinicios). */
  placeSimulatedAt: (lat: number, lng: number, label?: string) => void;
};

const STORAGE_KEY = 'location.provider.kind';
const SIM_KEY = 'location.sim.v1';
export const SEED_TRACK_LABEL = 'Ciudad Vieja (seed)';

type SimStored = { label: string; track: TrackPoint[]; stops: NamedPoint[]; speed?: SimSpeed };

/** Track del seed incluido en el bundle (supabase/seed/ciudad-vieja-track.json). */
export function seedTrack(): TrackPoint[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../../supabase/seed/ciudad-vieja-track.json') as TrackPoint[];
}
export const SEED_STOPS: NamedPoint[] = CIUDAD_VIEJA_STOPS.map((s) => ({ ...s }));

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationContextProvider({ children }: { children: ReactNode }) {
  const real = useRef(new RealLocationProvider()).current;
  const simulator = useRef(new SimulatedLocationProvider()).current;
  const providers = useMemo<Record<Kind, LocationProvider>>(() => ({ real, simulated: simulator }), [real, simulator]);
  const [kind, setKindState] = useState<Kind>('real');
  const [active, setActive] = useState(false);
  const [simStops, setSimStops] = useState<NamedPoint[]>(SEED_STOPS);
  // Si el modo demo ya ubicó el simulador, el track guardado (que carga async) no lo pisa.
  const placed = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'real' || v === 'simulated') setKindState(v);
      })
      .catch(() => {});
    // Track del simulador: el último cargado o, si no hay, el del seed (pausado en t=0).
    AsyncStorage.getItem(SIM_KEY)
      .then((raw) => {
        if (placed.current) return;
        const stored = raw ? (JSON.parse(raw) as SimStored) : null;
        const parsed = stored ? parseTrack(stored.track) : null;
        if (stored && parsed?.ok) {
          simulator.load(parsed.track, stored.label);
          setSimStops(stored.stops ?? []);
          if (stored.speed && (SIM_SPEEDS as readonly number[]).includes(stored.speed)) simulator.setSpeed(stored.speed);
        } else {
          simulator.load(seedTrack(), SEED_TRACK_LABEL);
        }
      })
      .catch(() => {
        if (!placed.current) simulator.load(seedTrack(), SEED_TRACK_LABEL);
      });
  }, [simulator]);

  // Recordar la velocidad elegida.
  useEffect(() => {
    let lastSpeed = simulator.getState().speed;
    return simulator.onState((s) => {
      if (s.speed === lastSpeed) return;
      lastSpeed = s.speed;
      AsyncStorage.getItem(SIM_KEY)
        .then((raw) => {
          if (!raw) return;
          const stored = JSON.parse(raw) as SimStored;
          return AsyncStorage.setItem(SIM_KEY, JSON.stringify({ ...stored, speed: s.speed }));
        })
        .catch(() => {});
    });
  }, [simulator]);

  const loadSimTrack = useCallback(
    (track: TrackPoint[], label: string, stops: NamedPoint[] = []) => {
      simulator.load(track, label);
      setSimStops(stops);
      const stored: SimStored = { label, track, stops, speed: simulator.getState().speed };
      AsyncStorage.setItem(SIM_KEY, JSON.stringify(stored)).catch(() => {});
    },
    [simulator],
  );

  const placeSimulatedAt = useCallback(
    (lat: number, lng: number, label?: string) => {
      placed.current = true;
      simulator.placeAt(lat, lng, label);
      if (kind !== 'simulated') {
        providers[kind].stop();
        setKindState('simulated');
        AsyncStorage.setItem(STORAGE_KEY, 'simulated').catch(() => {});
      }
      simulator
        .start()
        .then(() => setActive(true))
        .catch(() => {});
    },
    [simulator, kind, providers],
  );

  const start = useCallback(async (which?: Kind): Promise<Error | null> => {
    try {
      await providers[which ?? kind].start();
      setActive(true);
      return null;
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [kind, providers]);

  const setKind = useCallback(
    (next: Kind) => {
      if (next === kind) return;
      const wasActive = active;
      providers[kind].stop();
      setKindState(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      if (wasActive) {
        providers[next].start().catch(() => setActive(false));
      }
    },
    [kind, active, providers],
  );

  useEffect(() => () => Object.values(providers).forEach((p) => p.stop()), [providers]);

  const value = useMemo(
    () => ({ provider: providers[kind], kind, setKind, start, active, simulator, simStops, loadSimTrack, placeSimulatedAt }),
    [providers, kind, setKind, start, active, simulator, simStops, loadSimTrack, placeSimulatedAt],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationProvider(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocationProvider fuera de <LocationContextProvider>');
  return ctx;
}

/** Último LocationFix del provider actual (se actualiza en vivo). */
export function useLocationFix(): LocationFix | null {
  const { provider } = useLocationProvider();
  const [fix, setFix] = useState<LocationFix | null>(() => provider.getCurrent());
  useEffect(() => {
    setFix(provider.getCurrent());
    return provider.subscribe(setFix);
  }, [provider]);
  return fix;
}

/** Simulador de GPS (solo menú dev y mini controles). */
export function useSimulator() {
  const { simulator, simStops, loadSimTrack, kind, setKind, start, active } = useLocationProvider();
  const [state, setState] = useState<SimulatorState>(() => simulator.getState());
  useEffect(() => {
    setState(simulator.getState());
    return simulator.onState(setState);
  }, [simulator]);
  return { sim: simulator, state, stops: simStops, loadTrack: loadSimTrack, enabled: kind === 'simulated', setKind, start, active };
}
