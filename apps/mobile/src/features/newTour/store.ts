// Estado de "Nuevo tour" (planificador de tours): Contame → Lo que entendí (rondas) → Elegí tu recorrido.
import type { TourInterviewResult, TourVariant } from '@build101/shared';
import { create } from 'zustand';

import { defaultAnswers, type AnswerValue, type Answers, type FreeAnswers } from './model';

export type TourPhase = 'tell' | 'brief' | 'variants';
type LoadingKey = 'brief' | 'round' | 'variants' | 'start' | null;
type ErrorKey = 'brief' | 'round' | 'variants' | 'start';

type State = {
  phase: TourPhase;
  story: string;
  durationMin: number | null;
  here: { lat: number; lng: number } | null;
  tripId: string | null;
  /** Bloque "tour" del itinerario desde el que se abrió (el tour queda ligado a ese bloque). */
  blockId: string | null;
  rounds: TourInterviewResult[];
  roundIndex: number;
  answers: Answers;
  free: FreeAnswers;
  variants: TourVariant[] | null;
  chosenId: string | null;
  loading: LoadingKey;
  error: Record<ErrorKey, string | null>;
  init: (opts: { here: { lat: number; lng: number } | null; tripId: string | null; blockId?: string | null; story?: string; durationMin?: number | null }) => void;
  setStory: (s: string) => void;
  setDuration: (m: number | null) => void;
  setPhase: (p: TourPhase) => void;
  setRound: (i: number, r: TourInterviewResult) => void;
  setRoundIndex: (i: number) => void;
  setAnswer: (id: string, v: AnswerValue) => void;
  setFree: (id: string, t: string) => void;
  setVariants: (v: TourVariant[]) => void;
  choose: (id: string) => void;
  setLoading: (l: LoadingKey) => void;
  setError: (k: ErrorKey, msg: string | null) => void;
  back: () => void;
};

const noErrors = { brief: null, round: null, variants: null, start: null };

export const useNewTourStore = create<State>()((set, get) => ({
  phase: 'tell',
  story: '',
  durationMin: 60,
  here: null,
  tripId: null,
  blockId: null,
  rounds: [],
  roundIndex: 0,
  answers: {},
  free: {},
  variants: null,
  chosenId: null,
  loading: null,
  error: noErrors,
  init: ({ here, tripId, blockId, story, durationMin }) =>
    set({ phase: 'tell', story: story ?? '', durationMin: durationMin === undefined ? 60 : durationMin, here, tripId, blockId: blockId ?? null, rounds: [], roundIndex: 0, answers: {}, free: {}, variants: null, chosenId: null, loading: null, error: noErrors }),
  setStory: (story) => set({ story }),
  setDuration: (durationMin) => set({ durationMin }),
  setPhase: (phase) => set({ phase }),
  setRound: (i, r) =>
    set((s) => {
      const rounds = [...s.rounds.slice(0, i), r];
      // Defaults de las preguntas nuevas, sin pisar lo ya contestado.
      return { rounds, roundIndex: i, answers: { ...defaultAnswers(r.questions), ...s.answers }, variants: null, chosenId: null };
    }),
  setRoundIndex: (roundIndex) => set({ roundIndex }),
  setAnswer: (id, v) => set((s) => ({ answers: { ...s.answers, [id]: v }, variants: null })),
  setFree: (id, t) => set((s) => ({ free: { ...s.free, [id]: t }, variants: null })),
  setVariants: (variants) => set({ variants, chosenId: variants.find((v) => v.recommended)?.id ?? variants[0]?.id ?? null }),
  choose: (chosenId) => set({ chosenId }),
  setLoading: (loading) => set({ loading }),
  setError: (k, msg) => set((s) => ({ error: { ...s.error, [k]: msg } })),
  back: () => {
    const s = get();
    if (s.phase === 'variants') return set({ phase: 'brief' });
    if (s.phase === 'brief' && s.roundIndex > 0) return set({ roundIndex: s.roundIndex - 1 });
    if (s.phase === 'brief') return set({ phase: 'tell' });
  },
}));

export const currentRound = (s: Pick<State, 'rounds' | 'roundIndex'>): TourInterviewResult | null => s.rounds[s.roundIndex] ?? null;
