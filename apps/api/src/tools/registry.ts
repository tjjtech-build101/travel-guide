// Registro de handlers: un handler por herramienta de toolDefs. HTTP (/tools/:name) y Claude (claude.ts) usan esto.
import { isToolName, toolDefs, type ToolName, type ToolResponse } from '@build101/shared';
import { toFailure, ToolFailure } from '../errors';
import { add_block } from './add_block';
import { add_idea } from './add_idea';
import { delete_trip } from './delete_trip';
import { choose_option } from './choose_option';
import { compose_days } from './compose_days';
import { decide_proposal } from './decide_proposal';
import { events_search } from './events_search';
import { generate_tour } from './generate_tour';
import { get_day_plan } from './get_day_plan';
import { get_trip_overview } from './get_trip_overview';
import { look_at_photo } from './look_at_photo';
import { research } from './research';
import { move_block } from './move_block';
import { place_details } from './place_details';
import { plan_transfers } from './plan_transfers';
import { plan_trip } from './plan_trip';
import { react_option } from './react_option';
import { remove_block } from './remove_block';
import { route_eta } from './route_eta';
import { search_places } from './search_places';
import { should_generate_tour } from './should_generate_tour';
import { tour_brief } from './tour_brief';
import { trip_brief } from './trip_brief';
import { trip_shapes } from './trip_shapes';
import { get_stop_content, next_stop, skip_stop, start_tour, tour_status } from './tour_live';
import type { Handler, ToolCtx } from './types';
import { undo } from './undo';
import { update_block } from './update_block';
import { weather } from './weather';
import { where_am_i } from './where_am_i';

export const handlers: { [N in ToolName]: Handler<N> } = {
  get_trip_overview,
  get_day_plan,
  add_block,
  update_block,
  move_block,
  remove_block,
  add_idea,
  search_places,
  place_details,
  where_am_i,
  route_eta,
  undo,
  decide_proposal,
  plan_trip,
  plan_transfers,
  trip_brief,
  trip_shapes,
  react_option,
  compose_days,
  choose_option,
  look_at_photo,
  research,
  tour_brief,
  generate_tour,
  weather,
  events_search,
  should_generate_tour,
  delete_trip,
  start_tour,
  tour_status,
  get_stop_content,
  next_stop,
  skip_stop,
};

export type ToolRun = { status: number; body: ToolResponse };

/** Ejecuta un handler con input YA validado. Nunca tira: errores → { ok:false }. */
export async function executeTool<N extends ToolName>(name: N, input: unknown, ctx: ToolCtx): Promise<ToolRun> {
  try {
    const handler = handlers[name] as Handler<ToolName>;
    const body = await handler(input as never, ctx);
    return { status: 200, body };
  } catch (err) {
    const f = toFailure(err);
    if (!(err instanceof ToolFailure) || f.status >= 500) console.error(`[tools/${name}]`, err);
    return { status: f.status, body: { ok: false, error: f.toError() } };
  }
}

/** Valida con Zod y ejecuta. 404 si la herramienta no existe, 400 si el input no valida. */
export async function runTool(name: string, raw: unknown, ctx: ToolCtx): Promise<ToolRun> {
  if (!isToolName(name)) {
    return { status: 404, body: { ok: false, error: { code: 'unknown_tool', message: `No existe la herramienta ${name}.` } } };
  }
  const parsed = toolDefs[name].input.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      status: 400,
      body: { ok: false, error: { code: 'invalid_input', message: 'Input inválido.', issues: parsed.error.issues } },
    };
  }
  return executeTool(name, parsed.data, ctx);
}
