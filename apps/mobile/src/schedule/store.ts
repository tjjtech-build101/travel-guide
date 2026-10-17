// Vigilante de horarios en el celu: corre la lógica pura (packages/shared/src/scheduleWatcher.ts) con los datos de
// la app y entrega los avisos (delivery.ts). Zustand fuera de React: lo alimentan <ScheduleWatcher> (cada ~60 s en
// primer plano, con los bloques de React Query) y la task de ubicación en segundo plano (cada muestra; en iOS no
// hay timers de JS en segundo plano). Lo enviado se guarda por día en AsyncStorage para no repetir avisos.
import {
  evaluateSchedule,
  isFarAway,
  nextWatchTarget,
  scheduleAlertText,
  shouldRefreshEta,
  type EtaCacheEntry,
  type ScheduleAlert,
  type ScheduleAlertPayload,
  type ScheduleWatchResult,
  type WatchQuietHours,
} from '@build101/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { appNow } from '../features/now/clock';
import { etaCell, isMineForNow, resolveToday, type TripDates } from '../features/now/selectors';
import { fetchEta, type Eta } from '../features/now/useEta';
import { collapseChoices } from '../features/plan/choices';
import type { PlanBlock, PlanLeg } from '../features/plan/selectors';
import { queryClient } from '../lib/queryClient';
import { useTourStore } from '../tour/store';
import { useVoiceStore, voice } from '../voice/store';
import { createDelivery } from './delivery';
import { sendLocalNotification } from './notifications';

const STORAGE_KEY = 'schedule.sent.v1';
const FLUSH_MS = 1000;

type LatLng = { lat: number; lng: number };

/** Lo que el vigilante necesita de la app (lo actualiza <ScheduleWatcher> con cada render de datos). */
export type WatchContext = {
  tripId: string;
  me: string;
  trip: TripDates | null;
  legs: PlanLeg[];
  blocks: PlanBlock[];
  quietHours: WatchQuietHours;
  /** Última posición del LocationProvider actual (real | simulado). */
  getHere: () => LatLng | null;
};

export type SentAlert = { key: string; at: number; channel: 'voice' | 'queued' | 'notification'; payload: ScheduleAlertPayload };

type State = {
  /** Fecha local ("2026-10-18") de las claves enviadas: al cambiar de día se vacían. */
  date: string | null;
  sent: string[];
  /** Último aviso por bloque (para mostrarlo en Ahora). */
  last: Record<string, SentAlert>;
  eta: EtaCacheEntry | null;
  lastRun: { at: number; result: Pick<ScheduleWatchResult, 'skipped' | 'target'> & { alerts: number } } | null;
  log: { at: number; text: string }[];
  hydrated: boolean;
};

type Actions = {
  setContext: (ctx: WatchContext | null) => void;
  /** Una pasada del vigilante. `here` = muestra de la task de segundo plano (si no, la del provider). */
  run: (opts?: { here?: LatLng | null; source?: string }) => Promise<void>;
  /** Solo dev: olvidar lo enviado hoy. */
  reset: () => void;
  hydrate: () => Promise<void>;
};

const initial: State = { date: null, sent: [], last: {}, eta: null, lastRun: null, log: [], hydrated: false };

let ctx: WatchContext | null = null;
let running = false;
/** Pedido de pasada mientras otra corría (p. ej. cambió la hora simulada): se repite al terminar. */
let rerun: { here?: LatLng | null; source?: string } | null = null;
let lastUserSpeechAt = 0;

useVoiceStore.subscribe((v, prev) => {
  if (prev.speaking === 'user' && v.speaking !== 'user') lastUserSpeechAt = Date.now();
});

export const useScheduleStore = create<State & Actions>((set, get) => {
  const log = (text: string) => {
    if (__DEV__) console.log('[schedule]', text);
    set((s) => ({ log: [...s.log.slice(-39), { at: Date.now(), text }] }));
  };

  const persist = () => {
    const { date, sent, last } = get();
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ date, sent, last })).catch(() => {});
  };

  const placeName = (blockId: string) => ctx?.blocks.find((b) => b.id === blockId)?.place_name ?? null;

  const delivery = createDelivery({
    isLive: voice.isLive,
    userSpeaking: () => useVoiceStore.getState().speaking === 'user',
    lastUserSpeechAt: () => lastUserSpeechAt,
    injectEvent: (type, payload) => voice.injectEvent(type, payload),
    notify: async (a: ScheduleAlert) => {
      const tripId = ctx?.tripId;
      const { title, body } = scheduleAlertText(a.payload, placeName(a.payload.block_id));
      Haptics.notificationAsync(
        a.payload.kind === 'running_late' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      const ok = await sendLocalNotification({
        title,
        body,
        url: tripId ? `/trip/${tripId}/now` : '/',
        data: { event: 'schedule_alert', ...a.payload },
      });
      log(ok ? `notificación: ${title}` : `sin permiso de notificaciones: ${title}`);
    },
    log,
  });
  setInterval(delivery.flush, FLUSH_MS);

  /** ETA al bloque vigilado: misma consulta que la tarjeta Después de Ahora (comparte caché de React Query). */
  const etaFor = async (target: { id: string; lat: number; lng: number }, here: LatLng, nowMs: number): Promise<number | undefined> => {
    const cache = get().eta;
    if (!shouldRefreshEta(cache, target.id, here, nowMs)) return cache!.minutes;
    try {
      const eta = await queryClient.fetchQuery<Eta>({
        queryKey: ['eta', target.id, etaCell(here)],
        queryFn: () => fetchEta(here, target),
        staleTime: 2 * 60_000,
      });
      set({ eta: { block_id: target.id, minutes: eta.minutes, at: nowMs, from: here } });
      return eta.minutes;
    } catch (e) {
      log(`route_eta falló: ${e instanceof Error ? e.message : String(e)}`);
      return cache?.block_id === target.id ? cache.minutes : undefined;
    }
  };

  return {
    ...initial,

    setContext: (c) => {
      ctx = c;
    },

    run: async ({ here: hereArg, source = 'timer' } = {}) => {
      if (!ctx) return;
      if (running) {
        rerun = { here: hereArg, source };
        return;
      }
      running = true;
      try {
        if (!get().hydrated) await get().hydrate();
        const c = ctx;
        const nowMs = appNow();
        const today = resolveToday(c.legs, c.me, nowMs, c.trip);
        if (today.kind !== 'today') {
          set({ lastRun: { at: nowMs, result: { skipped: 'no_block', target: null, alerts: 0 } } });
          return;
        }
        if (get().date !== today.date) set({ date: today.date, sent: [], last: {}, eta: null });
        const blocks = collapseChoices(c.blocks.filter((b) => b.day_id === today.day.id && isMineForNow(b, c.me)));
        const here = hereArg ?? c.getHere();
        const tour = useTourStore.getState().phase;
        const tourActive = tour === 'live' || tour === 'starting';

        // route_eta solo si hace falta (hay bloque vigilado cerca, sin tour ni silencio).
        const target = nextWatchTarget(blocks, today.minutes);
        const etas: Record<string, number | undefined> = {};
        if (target && here && !tourActive && !isFarAway(here, target)) {
          etas[target.id] = await etaFor(target, here, nowMs);
        }

        const r = evaluateSchedule({
          nowMin: today.minutes,
          here,
          blocks,
          etas,
          tourActive,
          quietHours: c.quietHours,
          sent: get().sent,
        });
        set({ lastRun: { at: nowMs, result: { skipped: r.skipped, target: r.target, alerts: r.alerts.length } } });
        if (!r.markSent.length) {
          if (source.startsWith('deep link')) log(`${source}: sin aviso (${r.skipped ?? 'nada que avisar'}, eta ${r.target?.eta_min ?? '—'}, ${today.minutes} min)`);
          return;
        }
        set((s) => ({ sent: [...s.sent, ...r.markSent] }));
        for (const a of r.alerts) {
          log(`${source}: ${a.payload.kind} ${a.payload.title} (salí en ${a.payload.leave_in_min ?? '—'}, tarde ${a.payload.late_by_min ?? '—'})`);
          const channel = delivery.deliver(a);
          set((s) => ({ last: { ...s.last, [a.payload.block_id]: { key: a.key, at: nowMs, channel, payload: a.payload } } }));
        }
        persist();
      } catch (e) {
        log(`falló: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        running = false;
        const again = rerun;
        rerun = null;
        if (again) void get().run(again);
      }
    },

    reset: () => {
      set({ sent: [], last: {}, eta: null });
      persist();
      log('dev: avisos de hoy olvidados');
    },

    hydrate: async () => {
      if (get().hydrated) return;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const saved = raw ? (JSON.parse(raw) as Pick<State, 'date' | 'sent' | 'last'>) : null;
        if (saved) set({ date: saved.date ?? null, sent: saved.sent ?? [], last: saved.last ?? {} });
      } catch {
        // sin estado guardado
      } finally {
        set({ hydrated: true });
      }
    },
  };
});

/** Para la task de ubicación en segundo plano (sin React). */
export function runScheduleWatcher(here?: LatLng | null, source = 'background') {
  void useScheduleStore.getState().run({ here, source });
}
