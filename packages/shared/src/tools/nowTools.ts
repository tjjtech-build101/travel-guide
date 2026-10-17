// Herramientas de Ahora v2 (docs/AHORA-V2.md): now_brief, gap_suggestions, report_late, plan_day.
// Se registran en toolDefs (index.ts) junto con las demás.
import { z } from 'zod';

import { Id, IsoDate, TimeOfDay } from './schemas';

// ---------- now_brief (lectura, sin feed) ----------

export const NowBriefBlock = z.object({
  title: z.string(),
  type: z.string().optional(),
  place_name: z.string().nullable().optional(),
  start_time: TimeOfDay.nullable().optional(),
  end_time: TimeOfDay.nullable().optional(),
});

export const NowBriefSnapshot = z.object({
  local_time: TimeOfDay,
  city: z.string().nullable().optional(),
  hero: z.enum(['leave', 'tour', 'current', 'free', 'state']),
  current: NowBriefBlock.nullable().optional(),
  next: NowBriefBlock.nullable().optional(),
  /** Minutos hasta tener que salir hacia `next` (negativo = tarde). */
  leave_in_min: z.number().int().nullable().optional(),
  walk_min: z.number().int().nullable().optional(),
  /** Minutos libres hasta el próximo bloque (hero free). */
  gap_min: z.number().int().nullable().optional(),
  weather: z
    .object({ temp_c: z.number().nullable().optional(), summary: z.string().optional(), rain_soon: z.boolean().optional() })
    .nullable()
    .optional(),
  /** Hasta 2 sugerencias del hueco, para que la frase pueda nombrar una. */
  suggestions: z.array(z.object({ title: z.string(), walk_min: z.number().int().nullable().optional() })).max(2).optional(),
  /** Gente del bloque que ya comparte ubicación: "Ana a 300 m". */
  group: z.array(z.object({ name: z.string(), distance_m: z.number().nullable().optional() })).max(6).optional(),
});
export type NowBriefSnapshotT = z.infer<typeof NowBriefSnapshot>;

export const NowBriefInput = z.object({
  trip_id: Id,
  language: z.string().default('es'),
  snapshot: NowBriefSnapshot,
});
export type NowBriefOutput = { text: string; source: 'llm' | 'rules' };

// ---------- gap_suggestions (lectura) ----------

export const GapSuggestionsInput = z.object({
  trip_id: Id,
  leg_id: Id,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Minutos libres del hueco: acota cuán lejos y cuán largo. */
  minutes: z.number().int().positive().max(600),
  /** Fecha y hora local del tramo (para "abierto ahora" y eventos de hoy). */
  date: IsoDate,
  local_time: TimeOfDay,
  limit: z.number().int().min(1).max(3).default(3),
});

export type GapSuggestion = {
  id: string;
  source: 'idea' | 'place' | 'event';
  title: string;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  walk_min: number | null;
  /** Una línea: por qué ahora ("Abierto hasta las 19 · 4 min a pie"). */
  why: string;
  /** Si es una idea del banco: el bloque a agendar con move_block. */
  block_id?: string;
  google_place_id?: string | null;
  /** Eventos: hora de inicio local. */
  start_time?: string | null;
  url?: string | null;
};
export type GapSuggestionsOutput = { items: GapSuggestion[] };

// ---------- report_late (escritura: feed running_late + undo) ----------

export const ReportLateInput = z.object({
  trip_id: Id,
  block_id: Id,
  late_by_min: z.number().int().min(1).max(240),
  note: z.string().max(200).optional(),
});
export type ReportLateOutput = { feed_id: string; summary: string };

// ---------- plan_day (el agente propone; nunca aplica solo) ----------

export const PlanDayInput = z.object({
  trip_id: Id,
  day_id: Id,
  from_time: TimeOfDay.describe('Desde qué hora llenar (hora local del tramo)'),
  to_time: TimeOfDay.optional().describe('Hasta qué hora; default: 22:00 o el próximo bloque fijo'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  reason: z.string().max(300).optional(),
});
export type PlanDayOutput = { proposal_id: string; summary: string; count: number };
