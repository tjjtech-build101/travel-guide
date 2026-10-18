// Entrevista previa al tour (tour_brief): la API mira el contexto del grupo y devuelve 0-3 preguntas que de
// verdad cambian el tour. Cada pregunta usa como `id` el nombre del campo de GenerateTourInput que completa,
// así la app y la voz pasan la respuesta tal cual a generate_tour.
import type { ToolInput } from './tools';

export const TOUR_QUESTION_IDS = [
  'themes',
  'energy',
  'familiarity',
  'food_stop',
  'include_paid_entries',
  'kids',
  'indoor',
  'finish',
  'must_include',
  'notes',
] as const;
export type TourQuestionId = (typeof TOUR_QUESTION_IDS)[number];

export type TourQuestion = {
  id: TourQuestionId;
  /** Pregunta en voseo, lista para leer o decir. */
  text: string;
  /** Por qué se pregunta (se muestra chiquito; la voz lo puede usar para justificar). */
  why: string;
  kind: 'single' | 'multi' | 'text';
  options: { value: string; label: string }[];
  /** Valor por defecto (value de una opción, lista de values, o null). */
  default: string | string[] | null;
  /** true = se puede dejar sin responder sin preguntar de nuevo. */
  optional: boolean;
  /** Texto de ejemplo para las preguntas abiertas. */
  placeholder?: string;
};

/** data de tour_brief. */
export type TourBriefResult = {
  /** Una o dos frases: para quién, dónde, cuándo y con qué clima. */
  summary: string;
  city: string | null;
  neighborhood: string | null;
  /** Lo que el Scout tiene en cuenta (bullets cortos para la hoja "Lo que tengo en cuenta"). */
  context: string[];
  /** Ordenadas por importancia: la abierta ("¿qué querés que tenga?") primero, después las de contexto y "algo que sí o sí". */
  questions: TourQuestion[];
  /** Guía de entrevista para la voz: temas a cubrir, en orden, ya adaptados al contexto (saltear lo que ya se sabe). */
  interview: string[];
};

export type TourAnswers = Partial<Record<TourQuestionId, string | string[] | null | undefined>>;

type TourAnswerFields = Pick<
  ToolInput<'generate_tour'>,
  'themes' | 'energy' | 'familiarity' | 'food_stop' | 'include_paid_entries' | 'kids' | 'indoor' | 'finish' | 'must_include' | 'notes'
>;

const asList = (v: string | string[] | null | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]).filter(Boolean);
const asOne = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;
const asBool = (v: string | string[] | null | undefined) => {
  const x = asOne(v);
  return x === 'true' ? true : x === 'false' ? false : undefined;
};

/** Respuestas de la hoja (values de las opciones) → campos de generate_tour. Lo vacío no se manda. */
export function tourAnswersToInput(a: TourAnswers): Partial<TourAnswerFields> {
  const out: Partial<TourAnswerFields> = {};
  const themes = asList(a.themes);
  if (themes.length) out.themes = themes as TourAnswerFields['themes'];
  if (asOne(a.energy)) out.energy = asOne(a.energy) as TourAnswerFields['energy'];
  if (asOne(a.familiarity)) out.familiarity = asOne(a.familiarity) as TourAnswerFields['familiarity'];
  if (asBool(a.food_stop) !== undefined) out.food_stop = asBool(a.food_stop);
  if (asBool(a.include_paid_entries) !== undefined) out.include_paid_entries = asBool(a.include_paid_entries);
  if (a.kids !== undefined && a.kids !== null) out.kids = asList(a.kids).filter((k) => k !== 'none') as TourAnswerFields['kids'];
  if (asOne(a.indoor)) out.indoor = asOne(a.indoor) as TourAnswerFields['indoor'];
  if (asOne(a.finish)) out.finish = asOne(a.finish) as TourAnswerFields['finish'];
  const must = asList(a.must_include)
    .flatMap((m) => m.split(/[,;\n]/))
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (must.length) out.must_include = must;
  const notes = asOne(a.notes)?.trim();
  if (notes) out.notes = notes.slice(0, 500);
  return out;
}

/** Defaults de las preguntas como respuestas iniciales de la hoja. */
export function defaultTourAnswers(questions: TourQuestion[]): TourAnswers {
  return Object.fromEntries(questions.filter((q) => q.default != null).map((q) => [q.id, q.default]));
}
