// Herramientas para agentes Claude (Tool Runner). Mismo handler que POST /tools/:name.
// El SDK de Anthropic vive solo en la API (nunca entra al bundle del celu).
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { TOOL_NAMES, toolDefs, type ToolName, type ToolResponse } from '@build101/shared';
import { executeTool } from './registry';
import type { ToolCtx } from './types';

/**
 * `ctx.actor` debería ser 'agent' para agentes internos (así rige "el agente propone en lo compartido").
 * betaZodTool valida el input con el mismo Zod antes de llamar a run.
 */
export const toClaudeTools = (
  ctx: ToolCtx,
  names: readonly ToolName[] = TOOL_NAMES,
  /** Opcional: achica la respuesta antes de dársela al modelo (ahorra tokens). Default: JSON completo. */
  format: (name: ToolName, body: ToolResponse) => string = (_n, body) => JSON.stringify(body),
) =>
  names.map((n) =>
    betaZodTool({
      name: n,
      description: toolDefs[n].description,
      inputSchema: toolDefs[n].input,
      run: async (input) => format(n, (await executeTool(n, input, ctx)).body),
    }),
  );
