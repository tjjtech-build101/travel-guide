// Jobs de agentes (agent_jobs). Formas de result que comparten la API y la app.

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
  request?: { conversation: { role: 'user' | 'assistant'; text: string }[]; start_date?: string; end_date?: string };
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
};
