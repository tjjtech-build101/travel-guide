// Chat guiado de "Nuevo viaje" (PRD 01). Las burbujas del compañero son textos locales (sin LLM, instantáneas).
// Persistido con zustand + AsyncStorage: si falla el arranque o se cierra la app, el chat no se pierde.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanTripStart } from '@build101/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string; error?: boolean };

export type Step = {
  question: string;
  chips: string[];
  /** Chips de selección múltiple (se mandan juntos con "Listo"). */
  multi?: boolean;
  /** Muestra el selector de fecha de inicio. */
  datePicker?: boolean;
};

export const STEPS: Step[] = [
  {
    question: '¡Buenas! ¿A dónde quieren ir? Pueden ser varios lugares, en el orden que quieran.',
    chips: ['Montevideo y Buenos Aires', 'Ruta por el norte argentino', 'Lisboa y Oporto'],
  },
  { question: '¿Cuándo y cuántos días más o menos?', chips: ['Este finde', '1 semana', '10 días', 'Todavía no sé'], datePicker: true },
  { question: '¿Quiénes viajan? ¿Alguien se separa en algún momento?', chips: ['Solo yo', 'En pareja', 'Con amigos', 'En familia'] },
  {
    question: '¿Qué les copa?',
    chips: ['Comida', 'Historia', 'Arquitectura', 'Museos', 'Naturaleza', 'Noche', 'Playa', 'Compras', 'Caminar'],
    multi: true,
  },
  { question: '¿Algo sí o sí? ¿Algo ni loco?', chips: ['Nada en especial'] },
];

export const START_ERROR_TEXT = 'No pude arrancar. ¿Probamos de nuevo?';

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;
const firstMessage = (): ChatMessage => ({ id: newId(), role: 'assistant', text: STEPS[0].question });

type NewTripState = {
  messages: ChatMessage[];
  /** Pregunta actual (índice en STEPS). STEPS.length = ya contestó todo. */
  step: number;
  startDate: string | null;
  interests: string[];
  /** Job en curso (después de "Armar el viaje"). */
  job: PlanTripStart | null;
  answer: (text: string) => void;
  setStartDate: (date: string | null) => void;
  toggleInterest: (chip: string) => void;
  startError: () => void;
  clearError: () => void;
  setJob: (job: PlanTripStart) => void;
  reset: () => void;
};

export const useNewTripStore = create<NewTripState>()(
  persist(
    (set, get) => ({
      messages: [firstMessage()],
      step: 0,
      startDate: null,
      interests: [],
      job: null,
      answer: (text) => {
        const clean = text.trim();
        if (!clean) return;
        const { step, messages } = get();
        const next = step + 1;
        const out: ChatMessage[] = [...messages.filter((m) => !m.error), { id: newId(), role: 'user', text: clean }];
        if (next < STEPS.length) out.push({ id: newId(), role: 'assistant', text: STEPS[next].question });
        set({ messages: out, step: Math.min(next, STEPS.length), interests: [] });
      },
      setStartDate: (startDate) => set({ startDate }),
      toggleInterest: (chip) =>
        set((s) => ({ interests: s.interests.includes(chip) ? s.interests.filter((c) => c !== chip) : [...s.interests, chip] })),
      startError: () =>
        set((s) => ({
          messages: [...s.messages.filter((m) => !m.error), { id: newId(), role: 'assistant', text: START_ERROR_TEXT, error: true }],
        })),
      clearError: () => set((s) => ({ messages: s.messages.filter((m) => !m.error) })),
      setJob: (job) => set({ job }),
      reset: () => set({ messages: [firstMessage()], step: 0, startDate: null, interests: [], job: null }),
    }),
    {
      name: 'build101.new-trip',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ messages: s.messages, step: s.step, startDate: s.startDate, job: s.job }),
    },
  ),
);

/** La conversación que va a plan_trip (sin la burbuja de error). */
export function conversationFor(messages: ChatMessage[], startDate: string | null) {
  const conv = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  if (startDate) conv.push({ role: 'user', text: `Fecha de inicio elegida: ${startDate}` });
  // plan_trip acepta hasta 40 mensajes: nos quedamos con los últimos.
  return conv.slice(-40);
}
