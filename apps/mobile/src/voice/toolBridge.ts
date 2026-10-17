// Function calls del modelo → POST /tools/:name con x-actor: agent (PRD 05). En paralelo, timeout 12 s por herramienta;
// el store manda todos los function_call_output y UN solo response.create al final.
import { isToolName, type ToolResponse } from '@build101/shared';

import { callTool } from '../lib/api';
import { parseArgs } from './toolText';

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

export { actionText, friendlyToolName, parseArgs, toModelOutput } from './toolText';
