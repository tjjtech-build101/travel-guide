// "Tour acá, ahora" (PRD 18, parte cliente). generate_tour (PRD 06/18) arma el tour en la API como job; la app
// sigue el job por Realtime (agent_jobs) y, cuando está listo, "Empezar" arranca el tour en vivo (PRD 07).
//
// Interfaz que usa la app (estable):
//   isNearbyTourAvailable(): Promise<boolean>   ¿la API expone generate_tour? (GET /health → tools)
//   startNearbyTour({ lat, lng, trip_id?, duration_min?, themes? }): Promise<NearbyTourResult>
//      → POST /tools/generate_tour { mode:'spontaneous', start_lat, start_lng, duration_min, ... } → { job_id, tour_id }
//   useNearbyTourJob: el job en curso (para la tarjeta de progreso en Ahora), persistido en AsyncStorage.
import type { GenerateTourStart, ToolInput } from '@build101/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { callTool } from '../../lib/api';
import { env } from '../../lib/env';

export const NEARBY_TOUR_TOOL = 'generate_tour';
export const NEARBY_DURATIONS = [30, 60, 90] as const;

export type StartNearbyTourInput = {
  lat: number;
  lng: number;
  trip_id?: string;
  duration_min?: number;
  themes?: ToolInput<'generate_tour'>['themes'];
};

export type NearbyTourResult =
  | { ok: true; job_id: string; tour_id: string }
  | { ok: false; code: 'not_available' | 'no_location' | 'error'; message: string };

/** Herramientas que expone la API (GET /health). Lista vacía si no responde. */
export async function fetchApiTools(): Promise<string[]> {
  if (!env.apiUrl) return [];
  try {
    const res = await fetch(`${env.apiUrl}/health`);
    const json = (await res.json()) as { tools?: unknown };
    return Array.isArray(json.tools) ? json.tools.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function isNearbyTourAvailable(): Promise<boolean> {
  return (await fetchApiTools()).includes(NEARBY_TOUR_TOOL);
}

/** Hook: ¿está la herramienta? (se revisa al montar y cada 5 min; no es polling de datos del viaje). */
export function useNearbyTourAvailable() {
  return useQuery({ queryKey: ['api', 'tools', NEARBY_TOUR_TOOL], queryFn: isNearbyTourAvailable, staleTime: 5 * 60_000 });
}

export async function startNearbyTour(input: StartNearbyTourInput): Promise<NearbyTourResult> {
  const { lat, lng, duration_min = 60, ...rest } = input;
  const res = await callTool<'generate_tour', GenerateTourStart>('generate_tour', {
    mode: 'spontaneous',
    start_lat: lat,
    start_lng: lng,
    duration_min,
    storyline: false,
    language: 'es',
    ...rest,
  });
  if (res.ok) {
    useNearbyTourJob.getState().track({ jobId: res.data.job_id, tourId: res.data.tour_id, durationMin: duration_min, tripId: input.trip_id ?? null });
    return { ok: true, job_id: res.data.job_id, tour_id: res.data.tour_id };
  }
  if (res.error.code === 'unknown_tool') return { ok: false, code: 'not_available', message: 'El "Tour acá, ahora" llega muy pronto.' };
  return { ok: false, code: 'error', message: res.error.message };
}

// ---------- job en curso ----------

export type NearbyJob = { jobId: string; tourId: string; durationMin: number; tripId: string | null; at: number };

const JOB_KEY = 'tour.nearby.job.v1';
/** Un armado de hace más de 3 h ya no se muestra. */
const JOB_TTL_MS = 3 * 3600_000;

export const useNearbyTourJob = create<{
  job: NearbyJob | null;
  track: (j: Omit<NearbyJob, 'at'>) => void;
  clear: () => void;
  hydrate: () => Promise<void>;
}>((set) => ({
  job: null,
  track: (j) => {
    const job = { ...j, at: Date.now() };
    set({ job });
    AsyncStorage.setItem(JOB_KEY, JSON.stringify(job)).catch(() => {});
  },
  clear: () => {
    set({ job: null });
    AsyncStorage.removeItem(JOB_KEY).catch(() => {});
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(JOB_KEY);
      const job = raw ? (JSON.parse(raw) as NearbyJob) : null;
      if (job && Date.now() - job.at < JOB_TTL_MS) set((s) => (s.job ? s : { job }));
    } catch {
      // sin caché
    }
  },
}));
