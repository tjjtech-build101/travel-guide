// Planificador de tours (como el de viajes): entrevista en rondas (tour_interview) → variantes de recorrido
// (tour_variants) → generate_tour con la variante elegida. Tipos que comparten la API y la app.
import type { ToolInput } from './tools';

/** Lo que la entrevista necesita conocer. Cada pregunta cubre una; `coverage` dice cuáles ya se saben. */
export const TOUR_DIMENSIONS = [
  'expectations', // qué esperan del tour, qué los entusiasma
  'must', // lugares que no se quieren perder (nombre exacto, desambiguado)
  'avoid',
  'themes',
  'duration',
  'group', // con quién van
  'energy',
  'finish', // cómo terminar
  'food',
  'kids',
  'familiarity', // primera vez o conocen la zona
  'indoor', // clima
  'storyline', // trama / misterio
  'other',
] as const;
export type TourDimension = (typeof TOUR_DIMENSIONS)[number];

export type TourInterviewQuestion = {
  /** Id libre y estable en la entrevista ("portones", "epoca", "final"): las respuestas se guardan por id. */
  id: string;
  dimension: TourDimension;
  text: string;
  why: string;
  kind: 'single' | 'multi' | 'text';
  options: { value: string; label: string }[];
  default: string | string[] | null;
  optional: boolean;
};

/** Lo que el Scout entendió del tour pedido (campos de generate_tour + deseos con palabras de la persona). */
export type TourUnderstanding = {
  duration_min: number | null;
  /** Lugares concretos que no se quieren perder, ya desambiguados ("Portones Shopping", "Iglesia de Carrasco"). */
  must_include: string[];
  avoid: string[];
  /** TOUR_THEMES. */
  themes: string[];
  energy: 'tranqui' | 'normal' | 'a_full' | null;
  finish: 'view' | 'food' | 'start' | 'any' | null;
  food_stop: boolean | null;
  kids: ('menores_5' | '5_a_9' | '10_a_13' | 'adolescentes')[];
  indoor: 'outdoor' | 'mixed' | 'indoor' | null;
  familiarity: 'first_time' | 'returning' | 'local' | null;
  include_paid_entries: boolean | null;
  storyline: boolean | null;
  /** Deseos con sus palabras ("historias de las quintas", "algo con misterio", "casas lindas"). */
  wishes: string[];
};

/** data de tour_interview. */
export type TourInterviewResult = {
  /** 1-2 frases: lo que entendí. */
  summary: string;
  understood: TourUnderstanding;
  /** "Lo que tengo en cuenta" (perfil del grupo, clima, hora, lo que ya escucharon). */
  context: string[];
  /** Lugares con historia cerca (para que la persona elija o reconozca nombres). */
  nearby: string[];
  /** 0-4 por ronda, ordenadas por importancia. */
  questions: TourInterviewQuestion[];
  /** true = ya sé lo suficiente: la app pasa a las variantes. */
  done: boolean;
  round: number;
  coverage?: Partial<Record<TourDimension, 'known' | 'assumed' | 'unknown'>>;
};

export type TourVariantStop = {
  name: string;
  lat: number;
  lng: number;
  /** "plaza", "iglesia", "museo"… */
  kind: string;
  google_place_id?: string | null;
  wikidata_id?: string | null;
  /** Por qué está (una frase), si se sabe. */
  why?: string | null;
};

export type TourVariant = {
  id: string;
  /** "Lo esencial", "Joyas escondidas", "Con atardecer en la rambla". */
  label: string;
  pitch: string;
  /** "+ termina con vista al río" / "− más caminata". */
  tradeoffs: string[];
  recommended: boolean;
  title: string;
  stops: TourVariantStop[];
  duration_min: number;
  est_duration_min: number;
  walk_m: number;
  /** Lugares pedidos que esta variante incluye / no pudo incluir. */
  must_included: string[];
  must_missing: string[];
};

/** data de tour_variants. */
export type TourVariantsResult = { variants: TourVariant[] };

type GenFields = Partial<
  Pick<
    ToolInput<'generate_tour'>,
    'duration_min' | 'must_include' | 'themes' | 'energy' | 'finish' | 'food_stop' | 'kids' | 'indoor' | 'familiarity' | 'include_paid_entries' | 'storyline' | 'notes'
  >
>;

/** Lo entendido → campos de generate_tour (lo null no se manda). */
export function understandingToTourInput(u: TourUnderstanding): GenFields {
  const out: GenFields = {};
  if (u.duration_min) out.duration_min = Math.max(15, Math.min(240, Math.round(u.duration_min)));
  if (u.must_include.length) out.must_include = u.must_include.slice(0, 5);
  if (u.themes.length) out.themes = u.themes as GenFields['themes'];
  if (u.energy) out.energy = u.energy;
  if (u.finish) out.finish = u.finish;
  if (u.food_stop != null) out.food_stop = u.food_stop;
  if (u.kids.length) out.kids = u.kids;
  if (u.indoor) out.indoor = u.indoor;
  if (u.familiarity) out.familiarity = u.familiarity;
  if (u.include_paid_entries != null) out.include_paid_entries = u.include_paid_entries;
  if (u.storyline != null) out.storyline = u.storyline;
  const notes = [...u.wishes, ...(u.avoid.length ? [`Evitar: ${u.avoid.join(', ')}`] : [])].join('. ');
  if (notes) out.notes = notes.slice(0, 500);
  return out;
}

export const EMPTY_TOUR_UNDERSTANDING: TourUnderstanding = {
  duration_min: null,
  must_include: [],
  avoid: [],
  themes: [],
  energy: null,
  finish: null,
  food_stop: null,
  kids: [],
  indoor: null,
  familiarity: null,
  include_paid_entries: null,
  storyline: null,
  wishes: [],
};
