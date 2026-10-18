// Llamadas a las herramientas nuevas de Ahora v2 (now_brief, gap_suggestions, plan_day). Tipadas con los Zod de
// nowTools.ts; el cast es porque el carril API las registra en toolDefs (si ya están, no cambia nada).
import type { GapSuggestionsInput, NowBriefInput, PlanDayInput, ToolName, ToolResponse } from '@build101/shared';
import { callTool, type CallToolOptions } from '../../../../lib/api';

// z.input sin importar zod (la app no lo tiene como dependencia directa).
type In<S> = S extends { _zod: { input: infer I } } ? I : never;

type NowToolInputs = {
  now_brief: In<typeof NowBriefInput>;
  gap_suggestions: In<typeof GapSuggestionsInput>;
  plan_day: In<typeof PlanDayInput>;
};

export function callNowTool<N extends keyof NowToolInputs, T>(
  name: N,
  input: NowToolInputs[N],
  opts?: CallToolOptions,
): Promise<ToolResponse<T>> {
  return callTool<ToolName, T>(name as ToolName, input as never, opts);
}
