// Jobs de agentes (agent_jobs). Formas de result que comparten la API y la app.
import type { PlanCoverage, TripUnderstanding } from './planner';

export const JOB_STATUS = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export type JobProgressLine = { at: string; text: string };

/** Respuesta de POST /tools/plan_trip (data). */
export type PlanTripStart = { job_id: string; trip_id: string };

/** agent_jobs.result de un job kind='plan_trip' (PRD 01). */
export type PlanTripResult = {
  /** Cantidades para el chip "Listo: 2 tramos, 8 días, 31 bloques". */
  legs: number;
  days: number;
  blocks: number;
  summary: string;
  assumptions: string[];
  /** Personas nombradas que todavía no son miembros, por tramo (PRD 04 las usa al unirse). */
  participants_hint: { leg_id: string; names: string[] }[];
  /** undo_token de la fila trip_planned (deshace todo el plan). */
  undo_token?: string | null;
  /** Tramos que no se pudieron completar (Reintentar los completa). */
  failed_legs?: { leg_id: string; city: string; error: string }[];
  /** Lo que pidió el usuario (para "Reintentar" sin perder la conversación). */
  request?: {
    conversation: { role: 'user' | 'assistant'; text: string }[];
    start_date?: string;
    end_date?: string;
    /** PRD 31: lo que entendió trip_brief (compose_days lo reusa para el perfil del grupo). */
    understanding?: Partial<TripUnderstanding>;
  };
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** PRD 31: 'menu' = armó tramos + menú de opciones (sigue compose_days); 'planned' = días armados. */
  stage?: 'menu' | 'planned';
  /** PRD 31: opciones del menú creadas (todas las secciones). */
  options?: number;
  /** PRD 31: lugares del día con "elegí 1 de N". */
  choices?: number;
  /** PRD 31: imperdibles cubiertos por tramo. */
  coverage?: PlanCoverage[];
};

/** agent_jobs.result de un job kind='research' (voz: "lo averiguo y te cuento"). */
export type ResearchResult = {
  question: string;
  /** Hasta ~130 palabras, armada SOLO con facts verificados. Vacía si no se encontró nada respaldado. */
  answer: string;
  /** quote = frase textual de la fuente que respalda el dato (la muestra la hoja de Fuentes). */
  facts: { text: string; source_url: string; quote?: string }[];
  /** Datos investigados que no pasaron la verificación (para la mini-evaluación). */
  rejected: number;
  place_id: string | null;
  /** Facts nuevos guardados en place_library (dedupe por texto). */
  saved_facts: number;
};

/** Respuesta de POST /tools/generate_tour (data). */
export type GenerateTourStart = { job_id: string; tour_id: string };

/** agent_jobs.result de un job kind='generate_tour' (PRD 06/18). */
/**
 * Cómo quedó un tour en el plan (generate_tour): se enlazó al bloque desde el que se pidió, se agregó como bloque
 * `tour` de hoy (personal → aplicado; compartido y lo pidió el Scout → propuesta al grupo), o no se agregó.
 */
export type TourPlanLink =
  | { mode: 'linked' | 'applied'; block_id: string; start_time: string | null }
  | { mode: 'proposed'; proposal_id: string; start_time: string | null }
  | { mode: 'none'; reason: string };

export type GenerateTourResult = {
  tour_id: string;
  plan?: TourPlanLink;
  stop_count: number;
  total_walk_m: number;
  est_duration_min: number;
  stats: {
    web_search_calls: number;
    places_reused: number;
    places_new: number;
    facts_verified: number;
    facts_rejected: number;
    /** Director/escritores (tour director): datos citados en narraciones y oraciones borradas por no tener respaldo. */
    facts_cited?: number;
    sentences_dropped?: number;
    critic_rewrites?: number;
    duration_ms?: number;
  };
  title?: string | null;
  thesis?: string | null;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
};
