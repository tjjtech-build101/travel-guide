// Inputs Zod de las herramientas del agente (Contratos → "API de herramientas").
// Reglas: el input raíz es siempre z.object (OpenAI Realtime exige type:'object');
// nada de union/refine en la raíz: las validaciones cruzadas van en el handler.
import { z } from 'zod';
import { BLOCK_STATUS, BLOCK_TYPES, ROUTE_MODES, TIME_FLEX, TRANSFER_MODES } from '../constants';

// z.guid() y no z.uuid(): los IDs fijos del seed (00000000-...-0001) no son UUID v4 válidos.
export const Id = z.guid();
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Formato HH:MM')
  .describe('Hora local HH:MM');
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const Transfer = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  mode: z.enum(TRANSFER_MODES),
  duration_min: z.number().int().positive().optional(),
});

export const BlockAlertInput = z.object({
  kind: z.enum(['closes', 'late', 'rain', 'diet']),
  text: z.string().min(1).max(300),
});
export const BlockSourceInput = z.object({
  url: z.string().url(),
  title: z.string().max(200).optional(),
});

/** Campos editables de un bloque (sin claves de pertenencia). */
export const BlockFields = z.object({
  type: z.enum(BLOCK_TYPES),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  google_place_id: z.string().optional(),
  place_name: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  start_time: TimeOfDay.optional(),
  end_time: TimeOfDay.optional(),
  time_flex: z.enum(TIME_FLEX).optional(),
  duration_min: z.number().int().positive().max(24 * 60).optional(),
  participant_ids: z.array(Id).optional().describe('Default: miembros del tramo. [yo] = bloque personal.'),
  is_private: z.boolean().optional(),
  status: z.enum(BLOCK_STATUS).optional(),
  cost_estimate: z.number().nonnegative().optional(),
  cost_currency: z.string().length(3).optional(),
  booking_url: z.string().url().optional(),
  notes: z.string().max(4000).optional(),
  transfer: Transfer.optional(),
  alerts: z.array(BlockAlertInput).max(5).optional().describe('Avisos: closes = cierra/cerrado ese día, late, rain, diet'),
  sources: z.array(BlockSourceInput).max(5).optional().describe('Fuentes (ej. web search) de eventos o datos'),
  sort_order: z.number().int().optional(),
});
export type BlockFieldsInput = z.infer<typeof BlockFields>;

const Reason = z.string().max(500).optional().describe('Por qué se hace el cambio (se muestra en propuestas y feed)');

export const GetTripOverviewInput = z.object({ trip_id: Id });

export const GetDayPlanInput = z.object({
  day_id: Id.optional(),
  trip_id: Id.optional(),
  date: IsoDate.optional(),
  leg_id: Id.optional().describe('Si hay tramos paralelos y no viene, se usa el tramo del usuario'),
});

export const AddBlockInput = BlockFields.extend({
  trip_id: Id,
  leg_id: Id,
  day_id: Id.nullable().describe('null = banco de ideas'),
  reason: Reason,
});

/** Patch de update_block: los campos opcionales del bloque aceptan null para borrarlos (ej. pasar de hora fija a franja). */
const CLEARABLE = [
  'description', 'google_place_id', 'place_name', 'lat', 'lng', 'start_time', 'end_time', 'duration_min',
  'cost_estimate', 'cost_currency', 'booking_url', 'notes', 'transfer', 'alerts', 'sources',
] as const;
export const BlockPatch = BlockFields.partial().extend(
  Object.fromEntries(CLEARABLE.map((k) => [k, BlockFields.shape[k].unwrap().nullable().optional()])) as {
    [K in (typeof CLEARABLE)[number]]: z.ZodOptional<z.ZodNullable<ReturnType<(typeof BlockFields.shape)[K]['unwrap']>>>;
  },
);

export const UpdateBlockInput = z.object({
  block_id: Id,
  patch: BlockPatch,
  reason: Reason,
});

export const MoveBlockInput = z.object({
  block_id: Id,
  day_id: Id.nullable(),
  sort_order: z.number().int().optional(),
  start_time: TimeOfDay.optional(),
  recompute_times: z.boolean().default(true),
  reason: Reason,
});

export const RemoveBlockInput = z.object({ block_id: Id, reason: Reason });

export const SearchPlacesInput = z.object({
  query: z.string().min(1).optional(),
  near: LatLng.optional(),
  radius_m: z.number().int().positive().max(50_000).default(3000),
  open_now: z.boolean().optional(),
  max_results: z.number().int().min(1).max(20).default(8),
});

export const PlaceDetailsInput = z.object({ google_place_id: z.string().min(1) });

export const RouteStop = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  google_place_id: z.string().optional(),
});

export const RouteEtaInput = z.object({
  stops: z.array(RouteStop).min(2).max(10),
  mode: z.enum(ROUTE_MODES),
  departure_time: z.string().optional().describe('ISO 8601'),
});

export const UndoInput = z.object({ undo_token: z.string().min(10) });

export const AddIdeaInput = BlockFields.extend({
  trip_id: Id,
  leg_id: Id,
  reason: Reason,
});

// ---------- PRD 01 · plan_trip ----------

export const PlanTripMessage = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(2000),
});

export const PlanTripInput = z.object({
  trip_id: Id.optional().describe('Viaje existente: solo completa tramos sin bloques. Sin trip_id: crea un viaje nuevo.'),
  title: z.string().max(80).optional(),
  conversation: z
    .array(PlanTripMessage)
    .min(1)
    .max(40)
    .describe('Lo que contó el usuario (destinos, fechas, quiénes, gustos, sí o sí / ni loco)'),
  start_date: IsoDate.optional().describe('YYYY-MM-DD si el usuario eligió fecha'),
  end_date: IsoDate.optional(),
});

// ---------- PRD 06/18 · generate_tour ----------

export const TourMode = z.enum(['planned', 'spontaneous', 'explorer']);
export const TourTheme = z.enum(['historia', 'arquitectura', 'comida', 'curiosidades', 'para_chicos']);

export const TourEndPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().optional(),
});

export const GenerateTourInput = z.object({
  mode: TourMode,
  trip_id: Id.optional().describe('Si hay trip_id, el tour puede escribir activity_feed (tour_generated)'),
  block_id: Id.optional().describe('planned: toma lugar, hora y participantes del bloque'),
  start_lat: z.number().min(-90).max(90),
  start_lng: z.number().min(-180).max(180),
  duration_min: z.number().int().min(15).max(240).default(60),
  end_point: TourEndPoint.nullable().optional().describe('null/ausente = vuelve cerca del inicio (loop)'),
  participant_ids: z.array(Id).optional().describe('Default: block_participants o el usuario del JWT'),
  storyline: z.boolean().default(false),
  start_at: z.string().optional().describe('ISO datetime, para chequear horarios; default: ahora'),
  language: z.string().default('es'),
  themes: z.array(TourTheme).optional().describe('Espontáneo/explorador: temas a priorizar'),
  radius_m: z.number().int().positive().max(2000).optional().describe('Default: min(1200, duration_min*20)'),
  extend_tour_id: Id.optional().describe('Explorador: agrega paradas nuevas a un tour ya generado, sin duplicar place_id'),
});
