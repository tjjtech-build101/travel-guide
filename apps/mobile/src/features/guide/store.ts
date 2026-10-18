// Estado de la guía: qué recorridos ya viste (AsyncStorage, por dispositivo) y cuál está abierto.
// Un recorrido arranca solo la primera vez (useGuide) y nunca durante una llamada con el Scout.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { useVoiceStore } from '../../voice/store';
import { GUIDE_FLOWS, type GuideFlowId } from './flows';

const STORAGE_KEY = 'guide.seen.v1';

type GuideState = {
  loaded: boolean;
  seen: GuideFlowId[];
  active: { flow: GuideFlowId; index: number } | null;
  /** Arranca el recorrido si todavía no lo viste (o siempre, con force). */
  start: (flow: GuideFlowId, opts?: { force?: boolean }) => boolean;
  next: () => void;
  back: () => void;
  /** Cierra el recorrido abierto y lo marca como visto. */
  close: () => void;
  /** "Volver a ver la guía": se borran los vistos. */
  resetAll: () => void;
};

function persist(seen: GuideFlowId[]) {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(seen)).catch(() => {});
}

const inCall = () => {
  const s = useVoiceStore.getState().status;
  return s === 'connecting' || s === 'live' || s === 'reconnecting' || s === 'ending';
};

export const useGuideStore = create<GuideState>((set, get) => ({
  loaded: false,
  seen: [],
  active: null,
  start: (flow, opts) => {
    const s = get();
    if (!s.loaded || s.active || inCall()) return false;
    if (!opts?.force && s.seen.includes(flow)) return false;
    set({ active: { flow, index: 0 } });
    return true;
  },
  next: () => {
    const a = get().active;
    if (!a) return;
    if (a.index + 1 >= GUIDE_FLOWS[a.flow].length) get().close();
    else set({ active: { ...a, index: a.index + 1 } });
  },
  back: () => {
    const a = get().active;
    if (a && a.index > 0) set({ active: { ...a, index: a.index - 1 } });
  },
  close: () => {
    const a = get().active;
    if (!a) return;
    const seen = get().seen.includes(a.flow) ? get().seen : [...get().seen, a.flow];
    set({ active: null, seen });
    persist(seen);
  },
  resetAll: () => {
    set({ seen: [], active: null });
    persist([]);
  },
}));

AsyncStorage.getItem(STORAGE_KEY)
  .then((v) => {
    const seen = v ? (JSON.parse(v) as unknown) : [];
    useGuideStore.setState({ loaded: true, seen: Array.isArray(seen) ? (seen.filter((f) => f in GUIDE_FLOWS) as GuideFlowId[]) : [] });
  })
  .catch(() => useGuideStore.setState({ loaded: true }));

// Si entra una llamada, la guía se cierra sin marcarse como vista (vuelve la próxima vez).
useVoiceStore.subscribe((v) => {
  if ((v.status === 'connecting' || v.status === 'live') && useGuideStore.getState().active) useGuideStore.setState({ active: null });
});
