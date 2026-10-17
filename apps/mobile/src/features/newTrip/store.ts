// Flujo "Nuevo viaje" (PRD 01 + PRD 31): contame → lo que entendí (trip_brief) → formas (trip_shapes) →
// ¿cómo lo armamos? → plan_trip. Persistido con zustand + AsyncStorage: si falla algo o se cierra la app,
// no se pierde lo escrito ni lo que ya devolvió la API. Las llamadas viven en flow.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanTripStart, TripBriefResult, TripShape } from '@build101/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AnswerValue, Answers, PlanMode } from './model';

export type Phase = 'tell' | 'brief' | 'shapes' | 'build';

export const PHASE_ORDER: Phase[] = ['tell', 'brief', 'shapes', 'build'];

type Loadable = 'brief' | 'shapes' | 'plan';

type NewTripState = {
  phase: Phase;
  /** Lo que contó la persona (texto libre). */
  story: string;
  startDate: string | null;
  brief: TripBriefResult | null;
  /** inputKey con el que se pidió `brief` (si cambia lo contado, se vuelve a pedir). */
  briefKey: string | null;
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
  setBrief: (brief: TripBriefResult, key: string, answers: Answers) => void;
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
  brief: null,
  briefKey: null,
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
        const i = PHASE_ORDER.indexOf(get().phase);
        if (i > 0) set({ phase: PHASE_ORDER[i - 1]!, loading: null });
      },
      setStory: (story) => set({ story }),
      setStartDate: (startDate) => set({ startDate }),
      setBrief: (brief, briefKey, answers) => set({ brief, briefKey, answers }),
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
      name: 'build101.new-trip.v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        phase: s.phase,
        story: s.story,
        startDate: s.startDate,
        brief: s.brief,
        briefKey: s.briefKey,
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
