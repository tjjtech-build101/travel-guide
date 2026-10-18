// PRD 07 · Herramientas del tour en vivo: start_tour / tour_status / get_stop_content / next_stop / skip_stop.
// Input raíz siempre z.object (OpenAI Realtime). Formas compartidas de `tours.progress` (Contratos v1.1).
import { z } from 'zod';

const Id = z.guid();
const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

/** Valores de `content_told.layer` (PRD 07). */
export const STOP_LAYERS = ['short', 'more', 'secret', 'myth', 'photo', 'kid', 'transition'] as const;
export type StopLayer = (typeof STOP_LAYERS)[number];

/** Capa → columna de tour_stops. */
export const STOP_LAYER_COLUMN = {
  short: 'narration_short',
  more: 'narration_more',
  secret: 'narration_secret',
  myth: 'myth_vs_fact',
  photo: 'photo_spot',
  kid: 'kid_mission',
  transition: 'transition_to_next',
} as const satisfies Record<StopLayer, string>;

/** `tours.progress` (Contratos v1.1). */
export const TourProgress = z.object({
  current_stop_id: Id.nullable(),
  visited: z.array(
    z.object({ stop_id: Id, arrived_at: z.string(), left_at: z.string().nullable().optional() }),
  ),
  skipped: z.array(Id),
  started_at: z.string(),
  ends_at: z.string(),
});
export type TourProgress = z.infer<typeof TourProgress>;

export const StartTourInput = z.object({ tour_id: Id });

/**
 * `tours.route` (Contratos v1.1 + modo interno). positioning 'manual' = tour adentro de un lugar (museo, mercado):
 * el GPS no sirve para saber en qué punto está, así que la llegada la marca la persona (voz, botón o foto).
 */
export type TourRoute = {
  polyline: string | null;
  total_walk_m?: number;
  est_duration_min?: number;
  positioning?: 'gps' | 'manual';
  indoor?: boolean;
  venue?: { name: string; lat: number; lng: number; place_id: string | null } | null;
};

export const isManualTour = (route: Pick<TourRoute, 'positioning'> | null | undefined): boolean => route?.positioning === 'manual';

export const TourStatusInput = z.object({
  tour_id: Id,
  progress: TourProgress.optional().describe(
    'Estado local del celu (es la verdad): si viene, se guarda en tours.progress antes de responder',
  ),
  lat: Lat.optional().describe('Posición actual (para la ETA a pie a la próxima parada)'),
  lng: Lng.optional(),
  end: z.boolean().optional().describe('true = terminar el tour (status done)'),
});

export const GetStopContentInput = z.object({
  stop_id: Id,
  layer: z.enum(STOP_LAYERS).default('short'),
});

export const NextStopInput = z.object({
  tour_id: Id,
  lat: Lat.optional().describe('Explorador: devuelve la parada no contada más cercana a este punto'),
  lng: Lng.optional(),
});

export const SkipStopInput = z.object({ tour_id: Id, stop_id: Id });

/** Parada tal como la devuelven las herramientas de tour (y la usa el motor en el celu). */
export type TourStopView = {
  stop_id: string;
  place_id: string | null;
  name: string;
  sort_order: number;
  lat: number | null;
  lng: number | null;
  geofence_radius_m: number;
  dwell_min: number;
  look_at: string | null;
  /** Capas que esta persona ya escuchó (content_told). */
  layers_told: StopLayer[];
  /** Capas con contenido. */
  layers_available: StopLayer[];
};

/** data de start_tour. */
export type StartTourResult = {
  tour: {
    id: string;
    trip_id: string | null;
    block_id: string | null;
    title: string | null;
    mode: string | null;
    status: string;
    duration_min: number;
    route: TourRoute | null;
    progress: TourProgress;
  };
  stops: TourStopView[];
  persona: { name: string; voice: string };
  already_active: boolean;
};

/** data de tour_status. */
export type TourStatusResult = {
  tour_id: string;
  status: string;
  current: { stop_id: string; name: string; sort_order: number } | null;
  next: { stop_id: string; name: string; sort_order: number; eta_min: number | null; distance_m: number | null } | null;
  remaining_min: number;
  visited: string[];
  skipped: string[];
  pending: number;
  progress: TourProgress | null;
};

/** data de get_stop_content. */
export type StopContentResult = {
  stop_id: string;
  place_id: string | null;
  name: string;
  layer: StopLayer;
  text: string | null;
  sources: { url: string; title?: string }[];
  already_told: boolean;
  /** Capas con contenido que esta persona todavía no escuchó (en orden: more, secret, myth, kid, photo). */
  layers_left?: StopLayer[];
  /** Dossier del lugar: todos los datos verificados (para seguir contando y responder preguntas sin inventar). */
  facts?: string[];
};

/** data de next_stop. */
export type NextStopResult = {
  done: boolean;
  previous: { stop_id: string; name: string } | null;
  transition_to_next: string | null;
  nav_to_next: string | null;
  next: { stop_id: string; name: string; sort_order: number; lat: number | null; lng: number | null; look_at: string | null } | null;
  progress: TourProgress;
};

/** data de skip_stop. */
export type SkipStopResult = { skipped: string[]; current_stop_id: string | null; pending: number; progress: TourProgress };
