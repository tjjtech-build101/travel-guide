// Registro único de herramientas: la API, Claude (Tool Runner) y OpenAI Realtime usan estas definiciones.
import { z } from 'zod';
import {
  AddBlockInput,
  AddIdeaInput,
  EventsSearchInput,
  GenerateTourInput,
  GetDayPlanInput,
  GetTripOverviewInput,
  LookAtPhotoInput,
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
import { GetStopContentInput, NextStopInput, SkipStopInput, StartTourInput, TourStatusInput } from './tour';
import { GapSuggestionsInput, NowBriefInput, PlanDayInput, ReportLateInput } from './nowTools';

export * from './schemas';
export * from './tour';
export * from './nowTools';

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
  look_at_photo: {
    description:
      'Mira una foto (Claude visión + GPS + orientación + lugares cercanos con datos verificados): qué lugar es, inscripciones y su traducción, y una narración corta. Guarda la foto en photos.',
    input: LookAtPhotoInput,
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
  // PRD 07 · tour en vivo
  start_tour: {
    description:
      'Arranca un tour listo (status active) y devuelve el tour con sus paradas. Si ya estaba activo, devuelve el progreso guardado.',
    input: StartTourInput,
  },
  tour_status: {
    description:
      'Estado del tour en vivo: parada actual, próxima (con ETA a pie), minutos restantes, visitadas y salteadas. Con end:true lo termina.',
    input: TourStatusInput,
  },
  get_stop_content: {
    description:
      'Texto verificado de una capa de la parada (short, more, secret, myth, photo, kid, transition) con sus fuentes. already_told=true si ya se lo contaste a esta persona: resumilo en 1 frase o salteala.',
    input: GetStopContentInput,
  },
  next_stop: {
    description:
      'Marca la parada actual como visitada y devuelve la siguiente con transition_to_next y nav_to_next (indicaciones para llegar).',
    input: NextStopInput,
  },
  skip_stop: {
    description: 'Saltea una parada del tour (p. ej. si la persona acepta recortar por tiempo).',
    input: SkipStopInput,
  },
  // Ahora v2 (docs/AHORA-V2.md). now_brief y gap_suggestions son solo de la app (APP_ONLY_TOOLS).
  now_brief: {
    description: 'Una frase de Scout para la vista Ahora a partir de una foto del momento. Lectura, sin feed.',
    input: NowBriefInput,
  },
  gap_suggestions: {
    description: 'Hasta 3 ideas para un hueco libre: del banco de ideas del tramo, lugares abiertos cerca y eventos de hoy.',
    input: GapSuggestionsInput,
  },
  report_late: {
    description:
      'Avisa al grupo que la persona llega tarde a un bloque (activity_feed running_late). No mueve nada; se puede deshacer.',
    input: ReportLateInput,
  },
  plan_day: {
    description:
      'Scout arma bloques para un hueco del día (desde from_time hasta to_time) con el banco de ideas y lugares cerca. Siempre queda como UNA propuesta para aceptar; nunca aplica solo.',
    input: PlanDayInput,
  },
} as const satisfies Record<string, ToolDef>;

export type ToolName = keyof typeof toolDefs;
/** Herramientas que solo usa la app (la voz y los agentes no las ven). */
export const APP_ONLY_TOOLS: readonly ToolName[] = ['now_brief', 'gap_suggestions'];
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
