// Reloj de la app con fecha/hora simulable (para probar Ahora con el seed y para la demo).
// Se simula desde el menú dev o con el deep link `build101://trip/<id>/now?at=2026-10-18T10:30`
// (`at=real` vuelve al reloj real). La hora simulada se interpreta en la zona dada (default Montevideo)
// y sigue corriendo desde ahí (guardamos un desfase, no un instante fijo).
// "Ver mi día 1" (Ahora v2) NO usa este reloj: es una vista local de la pantalla (no dispara avisos ni comparte
// ubicación ni sobrevive al reinicio).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { zonedUtc } from '@build101/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'now.clock.offsetMs';

/** Zona por defecto de la simulación (la demo es en Montevideo). */
export const DEMO_TIME_ZONE = 'America/Montevideo';

type ClockState = {
  /** ms a sumar a Date.now(); 0 = reloj real. */
  offsetMs: number;
  /** Fija la hora simulada a partir de "YYYY-MM-DDTHH:MM" en `timeZone`. Devuelve false si no parsea. */
  simulate: (local: string, timeZone?: string) => boolean;
  /** Vuelve al reloj real. */
  reset: () => void;
};

export const useClockStore = create<ClockState>((set) => {
  return {
    offsetMs: 0,
    simulate: (local, timeZone = DEMO_TIME_ZONE) => {
      const t = zonedUtc(local, timeZone);
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
  };
});

// Restaurar la simulación al abrir la app (sobrevive a recargas de Metro).
// Una "vista previa del día 1" vieja (versiones anteriores la guardaban acá) no se restaura: se descarta.
const LEGACY_PREVIEW_KEY = 'now.clock.preview';
AsyncStorage.multiGet([STORAGE_KEY, LEGACY_PREVIEW_KEY])
  .then((rows) => {
    if (rows[1]?.[1] === '1') {
      AsyncStorage.multiRemove([STORAGE_KEY, LEGACY_PREVIEW_KEY]).catch(() => {});
      return;
    }
    const v = rows[0]?.[1];
    const n = v ? Number(v) : 0;
    if (Number.isFinite(n) && n !== 0) useClockStore.setState({ offsetMs: n });
  })
  .catch(() => {});

/** Instante actual (UTC ms) de la app: real o simulado. */
export function appNow(): number {
  return Date.now() + useClockStore.getState().offsetMs;
}

/** Instante actual que se re-renderiza cada `tickMs` (default 30 s) y al cambiar la simulación. */
export function useNow(tickMs = 30_000): { now: number; simulated: boolean; offsetMs: number } {
  const offsetMs = useClockStore((s) => s.offsetMs);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  void tick;
  return { now: Date.now() + offsetMs, simulated: offsetMs !== 0, offsetMs };
}
