// Inputs Zod de las herramientas del agente (Contratos → "API de herramientas").
// Reglas: el input raíz es siempre z.object (OpenAI Realtime exige type:'object');
// nada de union/refine en la raíz: las validaciones cruzadas van en el handler.
import { z } from 'zod';
import { BLOCK_STATUS, BLOCK_TYPES, ROUTE_MODES, TIME_FLEX, TRANSFER_MODES } from '../constants';
import { INTEREST_TAGS } from '../profile';

// z.guid() y no z.uuid(): los IDs fijos del seed (00000000-...-0001) no son UUID v4 válidos.
export const Id = z.guid();
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Formato HH:MM')
  .describe('Hora local HH:MM');
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const LatLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

/** Un tramo en transporte público de un traslado (Google Routes TRANSIT). */
export const TransitLine = z.object({
  /** "121", "D1", "Línea A" (nameShort o name de la línea). */
  name: z.string().max(80),
  vehicle: z.enum(['bus', 'subway', 'train', 'tram', 'ferry', 'other']),
  from_stop: z.string().max(200).optional(),
  to_stop: z.string().max(200).optional(),
  /** HH:MM local de salida / llegada según el horario de Google. */
  departure: z.string().max(5).optional(),
  arrival: z.string().max(5).optional(),
  headsign: z.string().max(200).optional(),
  stops: z.number().int().nonnegative().optional(),
});
export type TransitLine = z.infer<typeof TransitLine>;

export const Transfer = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  mode: z.enum(TRANSFER_MODES),
  duration_min: z.number().int().positive().optional(),
  // Traslados dentro del día (plan_trip): detalle de transporte público. Todos opcionales (jsonb).
  lines: z.array(TransitLine).max(6).optional(),
  /** Minutos caminando en total (hasta la parada, transbordos y desde la parada). */
  walk_min: z.number().int().nonnegative().optional(),
  /** "Bus 121 en Ciudadela → Pocitos (sale 18:05)". */
  summary: z.string().max(300).optional(),
  /** Link a Google Maps en modo transporte (Cómo llego). */
  maps_url: z.string().url().optional(),
  /** true = sin Google: duración estimada por distancia, sin líneas. */
  estimated: z.boolean().optional(),
  /** true = lo calculó el sistema: se recalcula solo cuando cambia el día (uno cargado a mano nunca se toca). */
  auto: z.boolean().optional(),
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
  detail: z
    .boolean()
    .optional()
    .describe('Con exactamente 2 paradas con lat/lng: devuelve además `detail` (polilínea y pasos) para mostrar la ruta en la app.'),
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
/** Temas del tour: los intereses del perfil (INTEREST_TAGS) + dos propios del tour. */
export const TOUR_THEMES = [...INTEREST_TAGS, 'curiosidades', 'para_chicos'] as const;
export const TourTheme = z.enum(TOUR_THEMES);
export type TourTheme = z.infer<typeof TourTheme>;

// Respuestas de la entrevista previa (tour_brief). Cada pregunta de tour_brief tiene como `id` el nombre del campo.
export const TourEnergy = z.enum(['tranqui', 'normal', 'a_full']);
export const TourFamiliarity = z.enum(['first_time', 'returning', 'local']);
export const TourFinish = z.enum(['view', 'food', 'start', 'any']);
export const TourIndoor = z.enum(['outdoor', 'mixed', 'indoor']);
export const TourKids = z.enum(['menores_5', '5_a_9', '10_a_13', 'adolescentes']);

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
  end_point: TourEndPoint.nullable().optional().describe('null/ausente = termina según finish (default: donde quede mejor)'),
  participant_ids: z.array(Id).optional().describe('Default: block_participants o el usuario del JWT'),
  storyline: z.boolean().default(false),
  start_at: z.string().optional().describe('ISO datetime, para chequear horarios; default: ahora'),
  language: z.string().default('es'),
  themes: z.array(TourTheme).optional().describe('Espontáneo/explorador: temas a priorizar'),
  radius_m: z.number().int().positive().max(2000).optional().describe('Default: min(1200, duration_min*20)'),
  extend_tour_id: Id.optional().describe('Explorador: agrega paradas nuevas a un tour ya generado, sin duplicar place_id'),
  // Respuestas de tour_brief (todas opcionales: sin respuesta se usa el perfil del grupo).
  energy: TourEnergy.optional().describe('tranqui = menos paradas, más pausas; a_full = más paradas'),
  familiarity: TourFamiliarity.optional().describe('first_time = lo esencial; returning/local = lo menos conocido'),
  food_stop: z.boolean().optional().describe('true = incluir una parada para comer o tomar algo'),
  include_paid_entries: z.boolean().optional().describe('true = se puede entrar a lugares con entrada paga'),
  kids: z.array(TourKids).optional().describe('Edades de los chicos que van (vacío = sin chicos)'),
  indoor: TourIndoor.optional().describe('indoor = priorizar lugares cubiertos (lluvia)'),
  finish: TourFinish.optional().describe('Cómo terminar si no hay end_point: con vista, comiendo, volviendo al inicio o donde sea'),
  must_include: z.array(z.string().min(1).max(120)).max(5).optional().describe('Lugares que sí o sí quieren ver (nombres)'),
  notes: z.string().max(500).optional().describe('Pedido libre de la persona ("algo con fantasmas", "nada de iglesias")'),
});

// ---------- generate_indoor_tour · tour adentro de un lugar (museo, mercado, iglesia) ----------

export const GenerateIndoorTourInput = z.object({
  venue_name: z.string().min(2).max(160).describe('El lugar por dentro, tal cual lo dijo la persona ("Museo Torres García")'),
  lat: z.number().min(-90).max(90).optional().describe('Posición de la persona (para ubicar el lugar correcto)'),
  lng: z.number().min(-180).max(180).optional(),
  trip_id: Id.optional(),
  duration_min: z.number().int().min(15).max(120).default(45),
  language: z.string().default('es'),
  notes: z.string().max(500).optional().describe('Pedido libre ("lo más famoso", "para chicos", "solo la planta baja")'),
});

// ---------- tour_brief · entrevista previa al tour ----------

export const TourBriefInput = z.object({
  mode: TourMode.default('spontaneous'),
  trip_id: Id.optional(),
  block_id: Id.optional(),
  start_lat: z.number().min(-90).max(90),
  start_lng: z.number().min(-180).max(180),
  duration_min: z.number().int().min(15).max(240).default(60),
  end_point: TourEndPoint.nullable().optional(),
  participant_ids: z.array(Id).optional(),
  start_at: z.string().optional().describe('ISO datetime; default: ahora'),
});

// ---------- PRD 16 · weather / events_search ----------

export const WeatherInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  date_from: IsoDate,
  date_to: IsoDate,
  day_id: Id.optional().describe('Si viene, persiste el resultado en days.weather'),
});

export const EventsSearchInput = z.object({
  city: z.string().min(1),
  country: z.string().optional(),
  date_from: IsoDate,
  date_to: IsoDate,
  interests: z.array(z.string()).optional(),
  lang: z.string().default('es'),
});

// ---------- should_generate_tour (decide si un bloque amerita "Generar tour") ----------

export const ShouldGenerateTourInput = z.object({
  block_title: z.string().min(1),
  block_type: z.enum(BLOCK_TYPES),
  place_name: z.string().optional(),
  description: z.string().max(2000).optional(),
});

// ---------- delete_trip (irreversible: borra el viaje y todo lo que cuelga de trip_id) ----------

export const DeleteTripInput = z.object({ trip_id: Id });

// ---------- PRD 08 · look_at_photo ----------

/** ~1,5 MB de base64 (la app manda JPEG 1280 px, calidad 0,6 ≈ 150-400 KB). */
const MAX_IMAGE_BASE64 = 2_000_000;

export const LookAtPhotoInput = z
  .object({
    /** La foto en el mismo pedido (JPEG base64, sin "data:"): la API la sube a Storage en paralelo con Claude. */
    image_base64: z.string().min(100).max(MAX_IMAGE_BASE64).optional(),
    /** Alternativa de Contratos: la foto ya subida a Storage (bucket photos). */
    storage_path: z.string().min(3).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    heading: z.number().min(0).max(360).nullable().optional().describe('Grados, norte verdadero; null si no hay brújula'),
    accuracy: z.number().nullable().optional(),
    question: z.string().max(300).optional().describe('"¿qué dice esa placa?"'),
    trip_id: Id.optional(),
    tour_id: Id.optional(),
    taken_at: z.string().optional(),
    language: z.string().min(2).max(8).optional().describe('Idioma de la narración (default: perfil)'),
  })
  .refine((v) => !!v.image_base64 !== !!v.storage_path, { message: 'Mandá image_base64 o storage_path (uno de los dos)' });

export const LookAtPhotoModelOutput = z.object({
  narration: z.string().describe('≤60 palabras, para decir en voz alta'),
  place: z
    .object({ place_id: z.string().nullable(), name: z.string(), confidence: z.number().min(0).max(1) })
    .nullable(),
  inscriptions: z.array(z.object({ original: z.string(), language: z.string(), translation: z.string().nullable() })),
  facts_used: z.array(z.object({ text: z.string(), source_url: z.string() })),
  quality: z.enum(['ok', 'blurry', 'dark']),
});
export type LookAtPhotoModelOutput = z.infer<typeof LookAtPhotoModelOutput>;

export type LookAtPhotoOutput = LookAtPhotoModelOutput & {
  /** Tour interno (positioning manual): la parada del tour que se ve en la foto (confianza ≥ 0,6). */
  tour_stop?: { stop_id: string; name: string } | null;
  photo_id: string | null;
  storage_path: string | null;
  /** ms por tramo (subida, cercanos, claude) para medir la latencia. */
  timings: Record<string, number>;
};

// ---------- research (voz: "no lo sé, lo averiguo y te cuento") ----------

export const ResearchInput = z.object({
  question: z.string().min(3).max(300).describe('La pregunta tal cual la hizo la persona, con el contexto necesario'),
  place_id: Id.optional().describe('Si es sobre un lugar de place_library: los datos verificados se guardan ahí'),
  place_name: z.string().max(200).optional().describe('Nombre del lugar, si la pregunta es sobre uno'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  trip_id: Id.optional(),
  language: z.string().min(2).max(8).optional(),
});

// ---------- plan_transfers (traslados dentro del día) ----------

export const PlanTransfersInput = z.object({
  trip_id: Id,
  leg_id: Id.optional().describe('Solo ese tramo'),
  day_id: Id.optional().describe('Solo ese día'),
});
