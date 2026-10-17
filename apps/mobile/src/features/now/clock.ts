// Reloj de la app con fecha/hora simulable (para probar Ahora con el seed y para la demo).
// Se simula desde el menú dev o con el deep link `build101://trip/<id>/now?at=2026-10-18T10:30`
// (`at=real` vuelve al reloj real). La hora simulada se interpreta en la zona dada (default Montevideo)
// y sigue corriendo desde ahí (guardamos un desfase, no un instante fijo).
// "Ver mi día 1" (Ahora v2, estado before) usa previewDay1: marca `preview` para el chip "Volver a hoy".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { zonedUtc } from '@build101/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

const STORAGE_KEY = 'now.clock.offsetMs';
const PREVIEW_KEY = 'now.clock.preview';

/** Zona por defecto de la simulación (la demo es en Montevideo). */
export const DEMO_TIME_ZONE = 'America/Montevideo';

type ClockState = {
  /** ms a sumar a Date.now(); 0 = reloj real. */
  offsetMs: number;
  /** La simulación es la vista previa del día 1 (muestra "Vista previa del día 1 · Volver a hoy"). */
  preview: boolean;
  /** Fija la hora simulada a partir de "YYYY-MM-DDTHH:MM" en `timeZone`. Devuelve false si no parsea. */
  simulate: (local: string, timeZone?: string) => boolean;
  /** Simula el día 1 del viaje a las 10:00 hora local del tramo. Devuelve false si la fecha no sirve. */
  previewDay1: (tripStartDate: string, timeZone?: string) => boolean;
  /** Vuelve al reloj real (y apaga la vista previa). */
  reset: () => void;
};

export const useClockStore = create<ClockState>((set) => {
  const apply = (local: string, timeZone: string, preview: boolean): boolean => {
    const t = zonedUtc(local, timeZone);
    if (t === null) return false;
    const offsetMs = t - Date.now();
    set({ offsetMs, preview });
    AsyncStorage.setItem(STORAGE_KEY, String(offsetMs)).catch(() => {});
    if (preview) AsyncStorage.setItem(PREVIEW_KEY, '1').catch(() => {});
    else AsyncStorage.removeItem(PREVIEW_KEY).catch(() => {});
    return true;
  };
  return {
    offsetMs: 0,
    preview: false,
    simulate: (local, timeZone = DEMO_TIME_ZONE) => apply(local, timeZone, false),
    previewDay1: (tripStartDate, timeZone = DEMO_TIME_ZONE) => {
      const date = tripStartDate.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      return apply(`${date}T10:00`, timeZone, true);
    },
    reset: () => {
      set({ offsetMs: 0, preview: false });
      AsyncStorage.multiRemove([STORAGE_KEY, PREVIEW_KEY]).catch(() => {});
    },
  };
});

// Restaurar la simulación al abrir la app (sobrevive a recargas de Metro).
AsyncStorage.multiGet([STORAGE_KEY, PREVIEW_KEY])
  .then((rows) => {
    const v = rows[0]?.[1];
    const n = v ? Number(v) : 0;
    if (Number.isFinite(n) && n !== 0) useClockStore.setState({ offsetMs: n, preview: rows[1]?.[1] === '1' });
  })
  .catch(() => {});

/** Instante actual (UTC ms) de la app: real o simulado. */
export function appNow(): number {
  return Date.now() + useClockStore.getState().offsetMs;
}

/**
 * Instante actual que se re-renderiza cada `tickMs` (default 30 s) y al cambiar la simulación.
 * `preview`: estamos en la vista previa del día 1.
 */
export function useNow(tickMs = 30_000): { now: number; simulated: boolean; preview: boolean } {
  const offsetMs = useClockStore((s) => s.offsetMs);
  const preview = useClockStore((s) => s.preview);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  void tick;
  return { now: Date.now() + offsetMs, simulated: offsetMs !== 0, preview: offsetMs !== 0 && preview };
}
