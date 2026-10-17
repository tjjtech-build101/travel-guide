// Selección del LocationProvider (real | simulado). Todo lo que use ubicación consume esto.
import type { LocationFix, LocationProvider } from '@build101/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { RealLocationProvider } from './real';
import { SimulatedLocationProvider } from './simulated';

type Kind = LocationProvider['kind'];

type LocationContextValue = {
  provider: LocationProvider;
  kind: Kind;
  setKind: (kind: Kind) => void;
  /** Arranca el provider actual (pide permiso si es el real). Devuelve el error si falla. */
  start: () => Promise<Error | null>;
  active: boolean;
};

const STORAGE_KEY = 'location.provider.kind';

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationContextProvider({ children }: { children: ReactNode }) {
  const providers = useRef<Record<Kind, LocationProvider>>({
    real: new RealLocationProvider(),
    simulated: new SimulatedLocationProvider(),
  }).current;
  const [kind, setKindState] = useState<Kind>('real');
  const [active, setActive] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'real' || v === 'simulated') setKindState(v);
      })
      .catch(() => {});
  }, []);

  const start = useCallback(async (): Promise<Error | null> => {
    try {
      await providers[kind].start();
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
    () => ({ provider: providers[kind], kind, setKind, start, active }),
    [providers, kind, setKind, start, active],
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
