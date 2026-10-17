// Reloj de la app con fecha/hora simulable (para probar Ahora con el seed y para la demo).
// Se simula desde el menú dev o con el deep link `build101://trip/<id>/now?at=2026-10-18T10:30`
// (`at=real` vuelve al reloj real). La hora simulada se interpreta en hora de Montevideo (UTC−3)
// y sigue corriendo desde ahí (guardamos un desfase, no un instante fijo).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { utcFromLocal } from './selectors';

const STORAGE_KEY = 'now.clock.offsetMs';

type ClockState = {
  /** ms a sumar a Date.now(); 0 = reloj real. */
  offsetMs: number;
  /** Fija la hora simulada a partir de "YYYY-MM-DDTHH:MM" (hora de Montevideo). Devuelve false si no parsea. */
  simulate: (local: string) => boolean;
  reset: () => void;
};

export const useClockStore = create<ClockState>((set) => ({
  offsetMs: 0,
  simulate: (local) => {
    const t = utcFromLocal(local);
    if (t === null) return false;
    const offsetMs = t - Date.now();
    set({ offsetMs });
    AsyncStorage.setItem(STORAGE_KEY, String(offsetMs)).catch(() => {});
    return true;
  },
  reset: () => {
    set({ offsetMs: 0 });
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));

// Restaurar la simulación al abrir la app (sobrevive a recargas de Metro).
AsyncStorage.getItem(STORAGE_KEY)
  .then((v) => {
    const n = v ? Number(v) : 0;
    if (Number.isFinite(n) && n !== 0) useClockStore.setState({ offsetMs: n });
  })
  .catch(() => {});

/** Instante actual (UTC ms) de la app: real o simulado. */
export function appNow(): number {
  return Date.now() + useClockStore.getState().offsetMs;
}

/** Instante actual que se re-renderiza cada `tickMs` (default 30 s) y al cambiar la simulación. */
export function useNow(tickMs = 30_000): { now: number; simulated: boolean } {
  const offsetMs = useClockStore((s) => s.offsetMs);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  void tick;
  return { now: Date.now() + offsetMs, simulated: offsetMs !== 0 };
}
