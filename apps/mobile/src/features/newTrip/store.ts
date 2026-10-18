// Flujo "Nuevo viaje" (PRD 01 + PRD 31): contame → lo que entendí (trip_brief, 1-4 rondas) → formas (trip_shapes) →
// ¿cómo lo armamos? → plan_trip. Persistido con zustand + AsyncStorage: si falla algo o se cierra la app,
// no se pierde lo escrito ni lo que ya devolvió la API. Las llamadas viven en flow.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanTripStart, TripBriefResult, TripShape } from '@build101/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { addDays, clampDays, daysInclusive } from './calendarModel';
import type { AnswerValue, Answers, PlanMode } from './model';

export type Phase = 'tell' | 'brief' | 'shapes' | 'build';

export const PHASE_ORDER: Phase[] = ['tell', 'brief', 'shapes', 'build'];

type Loadable = 'brief' | 'round' | 'shapes' | 'plan';

type NewTripState = {
  phase: Phase;
  /** Lo que contó la persona (texto libre). */
  story: string;
  startDate: string | null;
  /** Salida elegida en el calendario de Contame (solo con startDate). */
  endDate: string | null;
  /** "¿Cuántos días?" de Contame (1-60) o null. */
  days: number | null;
  /** Rondas de la entrevista (trip_brief round 1..4), en orden. */
  rounds: TripBriefResult[];
  /** inputKey con el que se pidió cada ronda (si cambia lo anterior, se vuelve a pedir). */
  roundKeys: string[];
  /** Ronda que se está mostrando (0-based). Atrás/adelante entre rondas no pierde respuestas. */
  roundIndex: number;
  /** Respuestas de TODAS las rondas, por id de pregunta. */
  answers: Answers;
  shapes: TripShape[] | null;
  shapesKey: string | null;
  chosenShapeId: string | null;
  /** Job en curso (después de armar). */
  job: PlanTripStart | null;
  jobMode: PlanMode | null;
  // No persistido:
  loading: Loadable | null;
  error: Partial<Record<Loadable, string>>;

  setPhase: (phase: Phase) => void;
  back: () => void;
  setStory: (story: string) => void;
  setStartDate: (date: string | null) => void;
  /** Llegada/salida del calendario; con salida, los días se completan solos. */
  setDates: (start: string | null, end: string | null) => void;
  /** Días a mano; si hay llegada, mueve la salida para que cierre. */
  setDays: (days: number | null) => void;
  /** Guarda la ronda `index` (descarta las posteriores: se pidieron con otras respuestas) y la muestra. */
  setRound: (index: number, brief: TripBriefResult, key: string, answers: Answers) => void;
  setRoundIndex: (index: number) => void;
  setAnswer: (id: string, value: AnswerValue) => void;
  setAnswers: (answers: Answers) => void;
  setShapes: (shapes: TripShape[], key: string) => void;
  chooseShape: (id: string | null) => void;
  setLoading: (what: Loadable | null) => void;
  setError: (what: Loadable, message: string | null) => void;
  setJob: (job: PlanTripStart, mode?: PlanMode | null) => void;
  reset: () => void;
};

const initial = {
  phase: 'tell' as Phase,
  story: '',
  startDate: null,
  endDate: null,
  days: null,
  rounds: [] as TripBriefResult[],
  roundKeys: [] as string[],
  roundIndex: 0,
  answers: {},
  shapes: null,
  shapesKey: null,
  chosenShapeId: null,
  job: null,
  jobMode: null,
  loading: null,
  error: {},
};

export const useNewTripStore = create<NewTripState>()(
  persist(
    (set, get) => ({
      ...initial,
      setPhase: (phase) => set({ phase }),
      back: () => {
        const s = get();
        if (s.phase === 'brief' && s.roundIndex > 0) {
          set({ roundIndex: s.roundIndex - 1, loading: null });
          return;
        }
        const i = PHASE_ORDER.indexOf(s.phase);
        if (i > 0) set({ phase: PHASE_ORDER[i - 1]!, loading: null });
      },
      setStory: (story) => set({ story }),
      setStartDate: (startDate) => set((s) => ({ startDate, endDate: startDate && s.endDate && s.endDate > startDate ? s.endDate : null })),
      setDates: (start, end) =>
        set((s) => {
          if (!start) return { startDate: null, endDate: null };
          if (end && end > start) return { startDate: start, endDate: end, days: clampDays(daysInclusive(start, end)) };
          return { startDate: start, endDate: s.days ? addDays(start, s.days - 1) : null };
        }),
      setDays: (days) =>
        set((s) => {
          const n = days == null ? null : clampDays(days);
          return { days: n, endDate: s.startDate && n ? addDays(s.startDate, n - 1) : null };
        }),
      setRound: (index, brief, key, answers) =>
        set((s) => ({
          rounds: [...s.rounds.slice(0, index), brief],
          roundKeys: [...s.roundKeys.slice(0, index), key],
          roundIndex: index,
          answers,
        })),
      setRoundIndex: (roundIndex) => set((s) => ({ roundIndex: Math.max(0, Math.min(roundIndex, s.rounds.length - 1)) })),
      setAnswer: (id, value) => set((s) => ({ answers: { ...s.answers, [id]: value } })),
      setAnswers: (answers) => set({ answers }),
      setShapes: (shapes, shapesKey) =>
        set((s) => ({ shapes, shapesKey, chosenShapeId: shapes.some((v) => v.id === s.chosenShapeId) ? s.chosenShapeId : null })),
      chooseShape: (chosenShapeId) => set({ chosenShapeId }),
      setLoading: (loading) => set({ loading }),
      setError: (what, message) =>
        set((s) => {
          const error = { ...s.error };
          if (message) error[what] = message;
          else delete error[what];
          return { error };
        }),
      setJob: (job, jobMode = null) => set({ job, jobMode }),
      reset: () => set({ ...initial }),
    }),
    {
      name: 'build101.new-trip.v3',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        phase: s.phase,
        story: s.story,
        startDate: s.startDate,
        endDate: s.endDate,
        days: s.days,
        rounds: s.rounds,
        roundKeys: s.roundKeys,
        roundIndex: s.roundIndex,
        answers: s.answers,
        shapes: s.shapes,
        shapesKey: s.shapesKey,
        chosenShapeId: s.chosenShapeId,
        job: s.job,
        jobMode: s.jobMode,
      }),
    },
  ),
);

/** La forma elegida (o null). */
export function chosenShape(s: Pick<NewTripState, 'shapes' | 'chosenShapeId'>): TripShape | null {
  return s.shapes?.find((v) => v.id === s.chosenShapeId) ?? null;
}

/** La ronda que se está mostrando (o null si todavía no hay entrevista). */
export function currentBrief(s: Pick<NewTripState, 'rounds' | 'roundIndex'>): TripBriefResult | null {
  return s.rounds[s.roundIndex] ?? s.rounds[s.rounds.length - 1] ?? null;
}
