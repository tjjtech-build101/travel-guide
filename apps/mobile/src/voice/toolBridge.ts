// Function calls del modelo → POST /tools/:name con x-actor: agent (PRD 05). En paralelo, timeout 12 s por herramienta;
// el store manda todos los function_call_output y UN solo response.create al final.
import { isToolName, type ToolResponse } from '@build101/shared';

import { callTool } from '../lib/api';

export type FunctionCall = { call_id: string; name: string; arguments: string };
export type CallResult = { call: FunctionCall; res: ToolResponse; input: Record<string, unknown> };

const TOOL_TIMEOUT_MS = 12_000;

/** Herramientas que no van al backend: el celu las resuelve (p. ej. look_at_photo abre la cámara, PRD 08). */
export type LocalTool = (input: Record<string, unknown>) => Promise<ToolResponse>;
const localTools = new Map<string, LocalTool>();

export function registerLocalTool(name: string, fn: LocalTool): () => void {
  localTools.set(name, fn);
  return () => {
    if (localTools.get(name) === fn) localTools.delete(name);
  };
}

export function parseArgs(raw: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function runOne(call: FunctionCall): Promise<CallResult> {
  const input = parseArgs(call.arguments);
  if (!input) {
    return { call, input: {}, res: { ok: false, error: { code: 'invalid_input', message: 'Los argumentos no son JSON válido.' } } };
  }
  const local = localTools.get(call.name);
  if (local) {
    try {
      return { call, input, res: await local(input) };
    } catch (e) {
      return { call, input, res: { ok: false, error: { code: 'local_error', message: e instanceof Error ? e.message : String(e) } } };
    }
  }
  if (!isToolName(call.name)) {
    return { call, input, res: { ok: false, error: { code: 'unknown_tool', message: `No existe la herramienta ${call.name}.` } } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
  try {
    const res = await callTool(call.name, input as never, { actor: 'agent', signal: ctrl.signal });
    if (!res.ok && ctrl.signal.aborted) {
      return { call, input, res: { ok: false, error: { code: 'timeout', message: 'La herramienta tardó demasiado.' } } };
    }
    return { call, input, res };
  } finally {
    clearTimeout(timer);
  }
}

export function runFunctionCalls(calls: FunctionCall[]): Promise<CallResult[]> {
  return Promise.all(calls.map(runOne));
}

/** Output para el modelo: compacto (el modelo no necesita filas enteras con ids internos de Supabase). */
export function toModelOutput(res: ToolResponse): string {
  const s = JSON.stringify(res);
  return s.length > 12_000 ? `${s.slice(0, 12_000)}…(recortado)` : s;
}

const FRIENDLY: Record<string, string> = {
  search_places: 'Buscando lugares',
  place_details: 'Mirando el lugar',
  route_eta: 'Calculando tiempos',
  get_trip_overview: 'Mirando el viaje',
  get_day_plan: 'Mirando el plan',
  add_block: 'Agendando',
  update_block: 'Cambiando el plan',
  move_block: 'Moviendo',
  remove_block: 'Sacando del plan',
  add_idea: 'Guardando la idea',
  undo: 'Deshaciendo',
  plan_trip: 'Armando el viaje',
  generate_tour: 'Armando el tour',
  look_at_photo: 'Mirando la foto',
};

export function friendlyToolName(name: string): string {
  return FRIENDLY[name] ?? 'Trabajando';
}

type BlockLike = { title?: string; start_time?: string | null };

/** Texto de la tarjeta de acción ("Agregué «Café» · 17:00"). null = la herramienta no deja tarjeta. */
export function actionText(name: string, res: ToolResponse): { text: string; proposed: boolean } | null {
  if (!res.ok || !res.undo_token) return null;
  const data = (res.data ?? {}) as { mode?: string; block?: BlockLike };
  if (data.mode === 'proposed') return { text: 'Propuesta enviada al grupo', proposed: true };
  const b = data.block;
  const title = b?.title ? `«${b.title}»` : '';
  const at = b?.start_time ? ` · ${b.start_time.slice(0, 5)}` : '';
  switch (name) {
    case 'add_block':
      return { text: `Agregué ${title}${at}`.trim(), proposed: false };
    case 'add_idea':
      return { text: `Guardé la idea ${title}`.trim(), proposed: false };
    case 'update_block':
      return { text: `Cambié ${title}${at}`.trim(), proposed: false };
    case 'move_block':
      return { text: `Moví ${title}${at}`.trim(), proposed: false };
    case 'remove_block':
      return { text: 'Saqué un bloque del plan', proposed: false };
    default:
      return { text: 'Listo', proposed: false };
  }
}
