// Planificador de tours (como "Nuevo viaje"): lógica pura de la entrevista. Sin React ni red (testeable).
import type { TourInterviewQuestion, TourInterviewResult, TourUnderstanding } from '@build101/shared';

export type Turn = { role: 'user' | 'assistant'; text: string };
export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;
/** "Otra cosa…" de cada pregunta (texto libre), por id. */
export type FreeAnswers = Record<string, string>;

export const TELL_PROMPT = '¿Qué tour tenés ganas de hacer? Contame qué te copa, si hay algún lugar que no te querés perder, con quién vas y cómo te gustaría terminar.';
export const TELL_EXAMPLES = [
  'Una hora por el barrio con historias de antes, y no me quiero perder los Portones de Carrasco.',
  'Vamos con mis dos hijos de 7 y 10: algo entretenido, con plazas y terminar tomando algo.',
  'Arquitectura y casas lindas, tranqui, y terminar viendo el atardecer.',
];
export const TOUR_DURATIONS = [30, 45, 60, 90, 120] as const;
export const MAX_ROUNDS = 4;

export const durationLabel = (m: number) => (m === 60 ? '1 hora' : m === 90 ? '1 h 30' : m === 120 ? '2 horas' : `${m} min`);

export function baseConversation(story: string, durationMin: number | null): Turn[] {
  const text = [story.trim(), durationMin ? `(Tengo ${durationLabel(durationMin)}.)` : ''].filter(Boolean).join('\n');
  return [{ role: 'user', text: text || 'Quiero un tour acá cerca.' }];
}

export function defaultAnswers(questions: TourInterviewQuestion[]): Answers {
  return Object.fromEntries(questions.filter((q) => q.default != null && q.kind !== 'text').map((q) => [q.id, q.default as AnswerValue]));
}

export function toggleAnswer(q: TourInterviewQuestion, current: AnswerValue | undefined, value: string): AnswerValue {
  if (q.kind !== 'multi') return value;
  const list = Array.isArray(current) ? current : current ? [current] : [];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function isSelected(current: AnswerValue | undefined, value: string): boolean {
  return Array.isArray(current) ? current.includes(value) : current === value;
}

/** La respuesta en palabras (labels + "otra cosa"), o null si no contestó. */
export function answerText(q: TourInterviewQuestion, value: AnswerValue | undefined, free?: string): string | null {
  const vals = value == null ? [] : Array.isArray(value) ? value : [value];
  const labels = q.kind === 'text' ? vals.filter((v) => v.trim()) : vals.map((v) => q.options.find((o) => o.value === v)?.label ?? v);
  const parts = [...labels, ...(free?.trim() ? [free.trim()] : [])];
  return parts.length ? parts.join(', ') : null;
}

/** Preguntas de las rondas 0..upTo (sin repetir id: la última versión gana). */
export function roundQuestions(rounds: Pick<TourInterviewResult, 'questions'>[], upTo = rounds.length - 1): TourInterviewQuestion[] {
  const byId = new Map<string, TourInterviewQuestion>();
  rounds.slice(0, upTo + 1).forEach((r) => r.questions.forEach((q) => byId.set(q.id, q)));
  return [...byId.values()];
}

/** Lo contado + cada pregunta (Scout) con su respuesta (persona). Las sin responder no van. */
export function conversationWithAnswers(base: Turn[], questions: TourInterviewQuestion[], answers: Answers, free: FreeAnswers): Turn[] {
  const out = [...base];
  for (const q of questions) {
    const a = answerText(q, answers[q.id], free[q.id]);
    if (!a) continue;
    out.push({ role: 'assistant', text: q.text.slice(0, 2000) }, { role: 'user', text: a.slice(0, 2000) });
  }
  return out.slice(0, 40);
}

/** ¿Pedir otra ronda? Si la entrevista no dijo "listo", hay preguntas y no llegamos al máximo. */
export function wantsAnotherRound(r: Pick<TourInterviewResult, 'done' | 'questions'>, round: number): boolean {
  return !r.done && round < MAX_ROUNDS;
}

const FINISH: Record<string, string> = { view: 'Termina con vista', food: 'Termina comiendo', start: 'Vuelve al inicio', any: '' };
const ENERGY: Record<string, string> = { tranqui: 'Tranqui', normal: 'Ritmo normal', a_full: 'A full' };

/** Chips de "Lo que entendí". */
export function understoodChips(u: TourUnderstanding): string[] {
  return [
    u.duration_min ? durationLabel(u.duration_min) : null,
    ...u.must_include.map((m) => `Sí o sí: ${m}`),
    ...u.themes.slice(0, 4).map((t) => t.replace('_', ' ')),
    u.energy ? ENERGY[u.energy] : null,
    u.finish ? FINISH[u.finish] || null : null,
    u.food_stop ? 'Con parada para comer' : null,
    u.kids.length ? 'Con chicos' : null,
    u.storyline ? 'Con trama' : null,
  ].filter((x): x is string => !!x);
}

export function parseTradeoff(raw: string): { sign: '+' | '−' | null; text: string } {
  const m = /^\s*([+\-−])\s*(.*)$/.exec(raw);
  if (!m) return { sign: null, text: raw.trim() };
  return { sign: m[1] === '+' ? '+' : '−', text: m[2].trim() };
}

export const kmLabel = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
