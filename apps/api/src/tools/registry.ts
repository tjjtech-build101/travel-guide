// Registro de handlers: un handler por herramienta de toolDefs. HTTP (/tools/:name) y Claude (claude.ts) usan esto.
import { isToolName, toolDefs, type ToolName, type ToolResponse } from '@build101/shared';
import { ToolFailure } from '../errors';
import { add_block } from './add_block';
import { add_idea } from './add_idea';
import { delete_trip } from './delete_trip';
import { events_search } from './events_search';
import { generate_tour } from './generate_tour';
import { get_day_plan } from './get_day_plan';
import { get_trip_overview } from './get_trip_overview';
import { look_at_photo } from './look_at_photo';
import { research } from './research';
import { move_block } from './move_block';
import { place_details } from './place_details';
import { plan_trip } from './plan_trip';
import { remove_block } from './remove_block';
import { route_eta } from './route_eta';
import { search_places } from './search_places';
import { should_generate_tour } from './should_generate_tour';
import { get_stop_content, next_stop, skip_stop, start_tour, tour_status } from './tour_live';
import type { Handler, ToolCtx } from './types';
import { undo } from './undo';
import { update_block } from './update_block';
import { weather } from './weather';

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
  route_eta,
  undo,
  plan_trip,
  look_at_photo,
  research,
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
    if (err instanceof ToolFailure) return { status: err.status, body: { ok: false, error: err.toError() } };
    console.error(`[tools/${name}]`, err);
    return { status: 500, body: { ok: false, error: { code: 'internal', message: (err as Error)?.message ?? 'Error interno' } } };
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
