// Estado de UI del Plan (compartido con el Mapa, PRD 03) + toast de acción con "Deshacer".
import { create } from 'zustand';

import { describeError } from '../../lib/errors';
import type { PlanFilter } from './selectors';

export type PlanView = 'list' | 'split' | 'map';

type PlanMapState = {
  tripId: string | null;
  legId: string | null;
  dayId: string | null;
  selectedBlockId: string | null;
  filter: PlanFilter;
  view: PlanView;
  /** Rama elegida por fecha en tramos paralelos (date → leg_id). */
  branchByDate: Record<string, string>;
  parallelView: boolean;
  expandedIdeas: Record<string, boolean>;
  /** Resetea el estado al cambiar de viaje. */
  ensureTrip: (tripId: string) => void;
  setFilter: (f: PlanFilter) => void;
  setView: (v: PlanView) => void;
  setBranchByDate: (b: Record<string, string>) => void;
  setParallelView: (v: boolean) => void;
  toggleIdeas: (legId: string, open?: boolean) => void;
  select: (p: { legId?: string | null; dayId?: string | null; blockId?: string | null }) => void;
};

const initial = {
  legId: null,
  dayId: null,
  selectedBlockId: null,
  filter: 'all' as PlanFilter,
  view: 'list' as PlanView,
  branchByDate: {},
  parallelView: false,
  expandedIdeas: {},
};

export const usePlanMapStore = create<PlanMapState>((set, get) => ({
  tripId: null,
  ...initial,
  ensureTrip: (tripId) => {
    if (get().tripId !== tripId) set({ tripId, ...initial });
  },
  setFilter: (filter) => set({ filter }),
  setView: (view) => set({ view }),
  setBranchByDate: (branchByDate) => set({ branchByDate }),
  setParallelView: (parallelView) => set({ parallelView }),
  toggleIdeas: (legId, open) =>
    set((s) => ({ expandedIdeas: { ...s.expandedIdeas, [legId]: open ?? !s.expandedIdeas[legId] } })),
  select: ({ legId, dayId, blockId }) =>
    set((s) => ({
      legId: legId === undefined ? s.legId : legId,
      dayId: dayId === undefined ? s.dayId : dayId,
      selectedBlockId: blockId === undefined ? s.selectedBlockId : blockId,
    })),
}));

// ───────────────────────── Toast de acción ("Listo · Deshacer")

export type ActionToastState = {
  id: number;
  text: string;
  /** Causa del error (línea de arriba, en negrita). */
  title?: string;
  tone: 'success' | 'error' | 'info';
  undoToken?: string;
  tripId?: string;
};

type ToastStore = {
  toast: ActionToastState | null;
  show: (t: Omit<ActionToastState, 'id'>, durationMs?: number) => void;
  hide: (id?: number) => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

export const useActionToast = create<ToastStore>((set, get) => ({
  toast: null,
  show: (t, durationMs = 5000) => {
    if (timer) clearTimeout(timer);
    const id = ++seq;
    set({ toast: { ...t, id } });
    timer = setTimeout(() => get().hide(id), durationMs);
  },
  hide: (id) => {
    if (id !== undefined && get().toast?.id !== id) return;
    set({ toast: null });
  },
}));

export const showToast = (t: Omit<ActionToastState, 'id'>, durationMs?: number) =>
  useActionToast.getState().show(t, durationMs);

/** Toast de error con la causa real (lib/errors): "Sin conexión · Revisá el wifi…". */
export const showErrorToast = (error: unknown, doing?: string, durationMs = 6000) => {
  const v = describeError(error, { doing });
  showToast({ tone: 'error', title: v.title, text: v.hint ?? v.body }, durationMs);
};
