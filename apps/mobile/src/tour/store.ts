// Tour en vivo en el celu (PRD 07): estado + motor (tourEngine de packages/shared) + qué hacer con cada evento.
// Zustand fuera de React: lo alimentan TourRunner (LocationProvider + reloj), la task de ubicación en segundo plano
// y las herramientas de voz (voiceTools.ts). Se persiste en AsyncStorage para sobrevivir a que el sistema mate la app.
//
// Evento del motor →
//   (a) hay llamada con el Scout: se inyecta con el helper de PRD 05 (voice.injectEvent), esperando 3 s de silencio
//       si la persona está hablando;
//   (b) no hay llamada (PLAN B): tarjeta en Ahora (narración corta de get_stop_content + haptic) y botón
//       "Que me lo cuente el Scout" que abre la llamada en modo tour con foco en la parada.
import {
  createEngineState,
  engineFinish,
  engineMarkTold,
  engineOnFix,
  engineProgress,
  engineSkip,
  engineTick,
  isVoiceEngineEvent,
  tourStartedPayload,
  type EngineFix,
  type EngineState,
  type EngineStop,
  type EngineTour,
  type LeftRoutePayload,
  type StartTourResult,
  type StopLayer,
  type TimeWarningPayload,
  type TourEngineEvent,
  type TourStopView,
  type TourVoiceEvent,
} from '@build101/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { toAppError, type AppError } from '../lib/errors';
import { useVoiceStore, voice } from '../voice/store';
import { getStopContent, skipStopRemote, startTour, syncProgress } from './api';

const STORAGE_KEY = 'tour.live.v1';
/** Esperar este silencio después de que la persona habló antes de inyectar un evento. */
const AFTER_USER_SPEECH_MS = 3000;

export type TourCard =
  | {
      kind: 'narration';
      id: string;
      stopId: string;
      name: string;
      layer: StopLayer;
      loading: boolean;
      text: string | null;
      sources: { url: string; title?: string }[];
      alreadyTold: boolean;
      /** Causa real (lib/errors la explica). */
      error: AppError | null;
    }
  | { kind: 'dwell'; id: string; stopId: string; name: string; offer: StopLayer }
  | { kind: 'left_route'; id: string; payload: LeftRoutePayload }
  | { kind: 'time_warning'; id: string; payload: TimeWarningPayload }
  | { kind: 'done'; id: string; visited: number; skipped: number; total: number; minutes: number };

export type LiveTour = {
  tourId: string;
  tripId: string | null;
  title: string;
  mode: string | null;
  tour: EngineTour;
  stops: TourStopView[];
  engine: EngineState;
};

export type TourLogEntry = { at: number; text: string };

type State = {
  phase: 'idle' | 'starting' | 'live' | 'done';
  live: LiveTour | null;
  card: TourCard | null;
  /** Por qué falló el último start_tour (lib/errors la explica). */
  error: AppError | null;
  hydrated: boolean;
  /** Últimos eventos (menú dev / depuración). */
  log: TourLogEntry[];
  /** Permiso de ubicación "siempre": null = no se pidió todavía. */
  background: 'always' | 'foreground_only' | null;
};

type Actions = {
  /** "Empezar tour": start_tour + motor. Idempotente (doble toque, tour ya activo). */
  start: (args: { tourId: string; tripId?: string | null; participants?: string[] }) => Promise<boolean>;
  /** Arranque a partir de un start_tour ya hecho (p. ej. por la voz). */
  startFromResult: (r: StartTourResult, args: { tripId?: string | null; participants?: string[] }) => void;
  onFix: (fix: EngineFix) => void;
  tick: (now?: number) => void;
  skip: (stopId: string, opts?: { remote?: boolean }) => void;
  markTold: (stopId: string, layer: StopLayer) => void;
  finish: () => Promise<void>;
  /** Cierra el tour terminado y vuelve a la vista Ahora normal. */
  close: () => void;
  dismissCard: () => void;
  /** Plan B: pedir una capa (corta / más / secreto) y mostrarla en la tarjeta. */
  showLayer: (stopId: string, layer: StopLayer) => Promise<void>;
  /** "Que me lo cuente el Scout": abre la llamada en modo tour con foco en la parada. */
  askScout: (stopId?: string | null) => Promise<void>;
  hydrate: () => Promise<void>;
  setBackground: (b: State['background']) => void;
  /** Solo dev: corre el fin del tour `min` minutos (−10 = quedan 10 min menos) y hace un tick. */
  devShiftClock: (min: number) => void;
};

export type TourStore = State & Actions;

const initial: State = { phase: 'idle', live: null, card: null, error: null, hydrated: false, log: [], background: null };

let voiceQueue: TourVoiceEvent[] = [];
let lastUserSpeechAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

useVoiceStore.subscribe((v, prev) => {
  if (prev.speaking === 'user' && v.speaking !== 'user') lastUserSpeechAt = Date.now();
});

const cardId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function toEngineStops(stops: TourStopView[]): EngineStop[] {
  return stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({
      stop_id: s.stop_id,
      place_id: s.place_id,
      name: s.name,
      sort_order: s.sort_order,
      lat: s.lat!,
      lng: s.lng!,
      radius_m: s.geofence_radius_m,
      dwell_min: s.dwell_min,
    }));
}

function stopName(live: LiveTour, stopId: string): string {
  return live.stops.find((s) => s.stop_id === stopId)?.name ?? 'la parada';
}

export const useTourStore = create<TourStore>((set, get) => {
  const log = (text: string) => {
    if (__DEV__) console.log('[tour]', text);
    set((s) => ({ log: [...s.log.slice(-59), { at: Date.now(), text }] }));
  };

  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { phase, live, card, background } = get();
      const data = phase === 'idle' ? null : JSON.stringify({ phase, live, card, background });
      (data ? AsyncStorage.setItem(STORAGE_KEY, data) : AsyncStorage.removeItem(STORAGE_KEY)).catch(() => {});
    }, 800);
  };

  const pushProgress = (end = false) => {
    const live = get().live;
    if (!live) return;
    void syncProgress(live.tourId, engineProgress(live.tour, live.engine), end);
  };

  const setEngine = (engine: EngineState) => {
    const live = get().live;
    if (!live) return;
    set({ live: { ...live, engine } });
    persist();
  };

  // ---------- voz ----------
  const flushVoice = () => {
    if (!voiceQueue.length) return;
    if (!voice.isLive()) {
      // Se cortó la llamada con eventos en cola: van al plan B.
      const q = voiceQueue;
      voiceQueue = [];
      q.forEach(planB);
      return;
    }
    const v = useVoiceStore.getState();
    if (v.speaking === 'user' || Date.now() - lastUserSpeechAt < AFTER_USER_SPEECH_MS) return;
    const q = voiceQueue;
    voiceQueue = [];
    for (const e of q) {
      const ok = voice.injectEvent(e.type, e.payload);
      log(`→ voz [EVENTO:${e.type}] ${ok ? '' : '(falló, plan B)'}`);
      if (!ok) planB(e);
      // El scout va a pedir la corta con get_stop_content: la marcamos para el próximo dwell / re-llegada.
      if (ok && e.type === 'arrived_stop' && !e.payload.layers_told.includes('short')) get().markTold(e.payload.stop_id, 'short');
    }
  };

  // ---------- plan B (sin llamada) ----------
  const planB = (e: TourVoiceEvent) => {
    const live = get().live;
    if (!live) return;
    switch (e.type) {
      case 'arrived_stop': {
        const p = e.payload;
        const layer: StopLayer = p.layers_told.includes('short') ? (p.layers_told.includes('more') ? 'secret' : 'more') : 'short';
        void get().showLayer(p.stop_id, layer);
        break;
      }
      case 'dwell': {
        const p = e.payload;
        const offer: StopLayer = p.layers_told.includes('more') ? 'secret' : 'more';
        set({ card: { kind: 'dwell', id: cardId(), stopId: p.stop_id, name: stopName(live, p.stop_id), offer } });
        Haptics.selectionAsync().catch(() => {});
        break;
      }
      case 'left_route':
        set({ card: { kind: 'left_route', id: cardId(), payload: e.payload } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
      case 'time_warning':
        set({ card: { kind: 'time_warning', id: cardId(), payload: e.payload } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        break;
    }
    persist();
  };

  const handle = (events: TourEngineEvent[]) => {
    for (const e of events) {
      if (isVoiceEngineEvent(e)) {
        log(`${e.type} ${'stop_id' in e.payload ? stopName(get().live!, e.payload.stop_id) : ''}`);
        if (e.type === 'arrived_stop') {
          // Llegada: haptic siempre (con y sin llamada) y progreso al backend.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          pushProgress();
        }
        if (voice.isLive()) {
          voiceQueue.push(e);
          flushVoice();
        } else {
          planB(e);
        }
        continue;
      }
      log(e.type === 'left_stop' ? `left_stop ${stopName(get().live!, e.stop_id)}` : e.type);
      if (e.type === 'left_stop') pushProgress();
      if (e.type === 'back_on_route' && get().card?.kind === 'left_route') set({ card: null });
      if (e.type === 'tour_done') doneCard();
    }
  };

  const doneCard = () => {
    const live = get().live;
    if (!live) return;
    const eng = live.engine;
    set({
      phase: 'done',
      card: {
        kind: 'done',
        id: cardId(),
        visited: Object.keys(eng.visited).length,
        skipped: eng.skipped.length,
        total: live.tour.stops.length,
        minutes: Math.max(1, Math.round((Date.now() - eng.startedAt) / 60_000)),
      },
    });
    pushProgress(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    persist();
  };

  // Cola de voz: reintento cada 1 s (silencio después de que la persona habló).
  setInterval(flushVoice, 1000);

  return {
    ...initial,

    start: async ({ tourId, tripId = null, participants = [] }) => {
      const s = get();
      if (s.phase === 'starting') return false;
      if (s.phase === 'live' && s.live?.tourId === tourId) return true;
      set({ phase: 'starting', error: null });
      try {
        const r = await startTour(tourId);
        get().startFromResult(r, { tripId, participants });
        return true;
      } catch (e) {
        const error = toAppError(e);
        log(`start_tour falló: ${error.code} ${error.detail ?? error.message}`);
        set({ phase: s.phase === 'live' || s.phase === 'done' ? s.phase : 'idle', error });
        return false;
      }
    },

    startFromResult: (r, { tripId = null, participants = [] }) => {
      const stops = r.stops;
      const tour: EngineTour = { tour_id: r.tour.id, stops: toEngineStops(stops), participants, route: null };
      const told = Object.fromEntries(stops.map((s) => [s.stop_id, [...s.layers_told]]));
      const startedAt = Date.parse(r.tour.progress.started_at);
      const endsAt = Date.parse(r.tour.progress.ends_at);
      const prev = get().live;
      // Mismo tour ya corriendo en el celu (p. ej. la voz llamó start_tour de nuevo): no se reinicia el motor.
      const engine =
        prev && prev.tourId === r.tour.id
          ? prev.engine
          : createEngineState(tour, { startedAt, endsAt, told, progress: r.already_active ? r.tour.progress : null });
      voiceQueue = [];
      set({
        phase: 'live',
        error: null,
        card: null,
        live: {
          tourId: r.tour.id,
          tripId: r.tour.trip_id ?? tripId,
          title: r.tour.title ?? 'Tour',
          mode: r.tour.mode,
          tour,
          stops,
          engine,
        },
      });
      log(`tour ${r.tour.title ?? r.tour.id} · ${tour.stops.length} paradas${r.already_active ? ' (retomado)' : ''}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      persist();
      // Arrancó en medio de una llamada de chat: el scout recibe las reglas del modo tour.
      if (voice.isLive() && useVoiceStore.getState().args?.mode !== 'tour') {
        voice.injectEvent('tour_started', tourStartedPayload(r.tour.id, r.tour.title, stops), { respond: false });
      }
    },

    onFix: (fix) => {
      const live = get().live;
      if (!live || get().phase !== 'live') return;
      // La misma muestra puede llegar por watchPosition y por la task de segundo plano: solo hacia adelante.
      const last = live.engine.lastFix;
      if (last && (fix.t < last.t || (fix.t === last.t && fix.lat === last.lat && fix.lng === last.lng))) return;
      const r = engineOnFix(live.tour, live.engine, fix);
      setEngine(r.state);
      if (r.events.length) handle(r.events);
    },

    tick: (now = Date.now()) => {
      const live = get().live;
      if (!live || get().phase !== 'live') return;
      const r = engineTick(live.tour, live.engine, now);
      if (r.events.length || r.state !== live.engine) setEngine(r.state);
      if (r.events.length) handle(r.events);
    },

    skip: (stopId, { remote = true } = {}) => {
      const live = get().live;
      if (!live) return;
      setEngine(engineSkip(live.tour, live.engine, stopId));
      log(`skip ${stopName(live, stopId)}`);
      if (remote) void skipStopRemote(live.tourId, stopId);
      const card = get().card;
      if (card && 'stopId' in card && card.stopId === stopId) set({ card: null });
      // Ya no queda nada: termina.
      const after = get().live!;
      const pending = after.tour.stops.filter((s) => !after.engine.visited[s.stop_id] && !after.engine.skipped.includes(s.stop_id));
      if (!pending.length && !after.engine.insideStopId) get().tick();
    },

    markTold: (stopId, layer) => {
      const live = get().live;
      if (!live) return;
      setEngine(engineMarkTold(live.engine, stopId, layer));
    },

    finish: async () => {
      const live = get().live;
      if (!live) return;
      setEngine(engineFinish(live.engine));
      voiceQueue = [];
      doneCard();
    },

    close: () => {
      voiceQueue = [];
      set({ ...initial, hydrated: true, background: get().background });
      persist();
    },

    dismissCard: () => {
      set({ card: null });
      persist();
    },

    showLayer: async (stopId, layer) => {
      const live = get().live;
      if (!live) return;
      const id = cardId();
      const name = stopName(live, stopId);
      set({ card: { kind: 'narration', id, stopId, name, layer, loading: true, text: null, sources: [], alreadyTold: false, error: null } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        const c = await getStopContent(stopId, layer);
        get().markTold(stopId, layer);
        const cur = get().card;
        if (cur?.id !== id) return;
        set({ card: { ...cur, loading: false, text: c.text, sources: c.sources, alreadyTold: c.already_told } as TourCard });
      } catch (e) {
        const cur = get().card;
        if (cur?.id !== id) return;
        set({ card: { ...cur, loading: false, error: toAppError(e) } as TourCard });
      }
      persist();
    },

    askScout: async (stopId) => {
      const live = get().live;
      if (!live) return;
      const stop = stopId ? live.stops.find((s) => s.stop_id === stopId) : null;
      const eng = live.engine;
      set({ card: null });
      await useVoiceStore.getState().requestCall({
        mode: 'tour',
        tourId: live.tourId,
        tripId: live.tripId,
        focus: stop
          ? { label: `la parada "${stop.name}" del tour`, ...(stop.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : {}) }
          : { label: `el tour "${live.title}"` },
        context: {
          kind: 'tour',
          tour_id: live.tourId,
          ...(stop
            ? { stop: { stop_id: stop.stop_id, place_id: stop.place_id, name: stop.name, layers_told: eng.told[stop.stop_id] ?? [] } }
            : {}),
          visited: Object.keys(eng.visited).length,
          skipped: eng.skipped.length,
          total: live.tour.stops.length,
        },
      });
    },

    hydrate: async () => {
      if (get().hydrated) return;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = raw ? (JSON.parse(raw) as Pick<State, 'phase' | 'live' | 'card' | 'background'>) : null;
        // No pisar un tour que arrancó mientras leíamos.
        if (saved?.live && get().phase === 'idle') {
          set({ phase: saved.phase === 'starting' ? 'live' : saved.phase, live: saved.live, card: saved.card, background: saved.background ?? null });
          log(`tour retomado: ${saved.live.title}`);
        }
      } catch (e) {
        console.warn('[tour] no pude leer el estado guardado', e);
      } finally {
        set({ hydrated: true });
      }
    },

    setBackground: (background) => {
      set({ background });
      persist();
    },

    devShiftClock: (min) => {
      const live = get().live;
      if (!live) return;
      setEngine({ ...live.engine, endsAt: live.engine.endsAt + min * 60_000, lastProactiveAt: null });
      log(`dev: reloj ${min > 0 ? '+' : ''}${min} min`);
      get().tick();
    },
  };
});

/** Para el TourRunner: vaciar la cola de voz ya (p. ej. al terminar de hablar). */
export const tourVoiceQueueSize = () => voiceQueue.length;
