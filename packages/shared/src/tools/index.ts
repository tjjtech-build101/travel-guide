// Registro único de herramientas: la API, Claude (Tool Runner) y OpenAI Realtime usan estas definiciones.
import { z } from 'zod';
import {
  AddBlockInput,
  AddIdeaInput,
  EventsSearchInput,
  GenerateTourInput,
  GetDayPlanInput,
  GetTripOverviewInput,
  MoveBlockInput,
  PlaceDetailsInput,
  PlanTripInput,
  RemoveBlockInput,
  RouteEtaInput,
  SearchPlacesInput,
  UndoInput,
  UpdateBlockInput,
  WeatherInput,
} from './schemas';

export * from './schemas';

type ToolDef = { description: string; input: z.ZodObject };

export const toolDefs = {
  get_trip_overview: {
    description: 'Devuelve tramos, miembros, días y un resumen corto del viaje.',
    input: GetTripOverviewInput,
  },
  get_day_plan: {
    description: 'Devuelve los bloques de un día (por day_id, o por trip_id + date).',
    input: GetDayPlanInput,
  },
  add_block: {
    description:
      'Agrega un bloque al itinerario. Si es personal se aplica; si es compartido y lo pide el agente, queda como propuesta para el grupo.',
    input: AddBlockInput,
  },
  update_block: {
    description: 'Modifica un bloque. Misma regla: personal aplica, compartido + agente propone.',
    input: UpdateBlockInput,
  },
  move_block: {
    description: 'Mueve un bloque a otro día (o al banco de ideas con day_id null) y recalcula horarios.',
    input: MoveBlockInput,
  },
  remove_block: {
    description: 'Borra un bloque. Compartido + agente: queda como propuesta.',
    input: RemoveBlockInput,
  },
  add_idea: {
    description: 'Agrega una idea sin día al banco de ideas del tramo.',
    input: AddIdeaInput,
  },
  search_places: {
    description: 'Busca lugares (Google Places) por texto y/o cerca de un punto.',
    input: SearchPlacesInput,
  },
  place_details: {
    description: 'Detalle de un lugar: horarios, si está abierto, precio, web, teléfono.',
    input: PlaceDetailsInput,
  },
  route_eta: {
    description: 'Tiempos y distancias entre 2 a 10 puntos, a pie, en transporte o en auto.',
    input: RouteEtaInput,
  },
  undo: {
    description: 'Deshace una acción anterior a partir de su undo_token.',
    input: UndoInput,
  },
  plan_trip: {
    description:
      'Arma un viaje entero (tramos, días y bloques) a partir de la conversación. Es un trabajo en segundo plano: devuelve { job_id, trip_id } y el progreso se ve en agent_jobs.',
    input: PlanTripInput,
  },
  generate_tour: {
    description:
      'Arma un tour con paradas verificadas (planificado, espontáneo o explorador). Trabajo en segundo plano: devuelve { job_id, tour_id } y el progreso (y las paradas) se ven por Realtime en agent_jobs / tour_stops.',
    input: GenerateTourInput,
  },
  weather: {
    description: 'Pronóstico diario y horario (Open-Meteo) para un punto y rango de fechas.',
    input: WeatherInput,
  },
  events_search: {
    description: 'Busca eventos (con fecha y fuente) en una ciudad para un rango de fechas.',
    input: EventsSearchInput,
  },
} as const satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof toolDefs;
export const TOOL_NAMES = Object.keys(toolDefs) as ToolName[];
export type ToolInput<N extends ToolName> = z.infer<(typeof toolDefs)[N]['input']>;

export type ToolError = { code: string; message: string; issues?: unknown };
export type ToolResponse<T = unknown> =
  | { ok: true; data: T; undo_token?: string; feed_id?: string }
  | { ok: false; error: ToolError };

/** Herramientas en el formato de function calling de OpenAI Realtime. */
export function toRealtimeTools(names: readonly ToolName[] = TOOL_NAMES) {
  return names.map((name) => {
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(toolDefs[name].input, { io: 'input' }) as Record<
      string,
      unknown
    >;
    return { type: 'function' as const, name, description: toolDefs[name].description, parameters };
  });
}

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolDefs, name);
}
