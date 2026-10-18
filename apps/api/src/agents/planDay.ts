// plan_day (Ahora v2): Scout llena un hueco del día con bloques. Una sola llamada a Claude con salida estructurada
// sobre datos ya juntados (banco de ideas + lugares cerca); el resultado se sanea por reglas y queda como propuesta.
// Interfaz chica (PlanDayLLM) para mockear en tests, igual que PlannerLLM.
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { BLOCK_TYPES, SCOUT, type BlockType } from '@build101/shared';
import { z } from 'zod';
import { anthropicClient, fallbackParams, PLANNER_MODEL, textOf, type AnyBlock, type Effort } from './llm';

// Sin min/max/regex: va como salida estructurada (se valida en sanitizePlan).
export const PlanDayItem = z.object({
  title: z.string().describe('Título corto en rioplatense, ej. "Café en el Brasilero"'),
  type: z.enum(BLOCK_TYPES),
  start_time: z.string().describe('HH:MM, hora local'),
  end_time: z.string().describe('HH:MM, hora local'),
  idea_id: z.string().nullable().describe('id de una idea del banco si este bloque es esa idea; si no, null'),
  place_ref: z.string().nullable().describe('ref de un lugar de la lista "lugares cerca"; si no, null'),
  description: z.string().nullable().describe('Una línea: qué hacer ahí'),
});
export const PlanDayOutputSchema = z.object({
  summary: z.string().describe('Una frase en rioplatense: qué propone Scout, ej. "Café, Ciudad Vieja y atardecer en la rambla"'),
  blocks: z.array(PlanDayItem),
});
export type PlanDayItemT = z.infer<typeof PlanDayItem>;
export type PlanDayPlanT = z.infer<typeof PlanDayOutputSchema>;

export interface PlanDayLLM {
  plan(args: { system: string; user: string; signal: AbortSignal }): Promise<PlanDayPlanT>;
}

const EFFORT: Effort = 'low';

export function anthropicPlanDay(): PlanDayLLM {
  return {
    async plan({ system, user, signal }) {
      const client = anthropicClient();
      const format = betaZodOutputFormat(PlanDayOutputSchema);
      const params = {
        model: PLANNER_MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        output_config: { effort: (process.env.PLAN_DAY_EFFORT?.trim() as Effort) || EFFORT, format: { type: 'json_schema', schema: format.schema } },
        ...fallbackParams({ fallbacks: true }),
        system: [{ type: 'text', text: system }],
        messages: [{ role: 'user', content: user }],
      };
      const msg = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0], {
        signal,
      })) as unknown as { stop_reason: string | null; content: AnyBlock[] };
      if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`plan_day: ${msg.stop_reason}`);
      return format.parse(textOf(msg.content));
    },
  };
}

export type PlanIdea = { id: string; title: string; type: string; place_name: string | null; duration_min: number | null; walk_min: number | null };
export type PlanPlace = { ref: string; name: string; address: string | null; types: string[]; rating: number | null; walk_min: number | null };
export type BusySlot = { title: string; start_time: string | null; end_time: string | null };

export const PLAN_DAY_SYSTEM = [
  `Sos ${SCOUT.name}. ${SCOUT.persona}`,
  'Armás un plan simple para un hueco libre de HOY. Pocas cosas y bien elegidas: 1 a 4 bloques, con aire entre medio.',
  'Reglas:',
  '- Todo entre "desde" y "hasta" (hora local), sin superponerse con lo ocupado ni entre sí.',
  '- Preferí las ideas del banco (el grupo ya las eligió). Usá su id en idea_id.',
  '- Si usás un lugar de la lista "lugares cerca", poné su ref en place_ref. No inventes lugares: si no está en las listas, usá un bloque genérico sin lugar (ej. "Paseo por la rambla") con place_ref null.',
  '- Contá el tiempo de caminata entre bloques.',
  '- Títulos cortos, en español rioplatense.',
].join('\n');

export function renderPlanDayUser(a: {
  date: string;
  city: string | null;
  from: string;
  to: string;
  reason?: string;
  busy: BusySlot[];
  ideas: PlanIdea[];
  places: PlanPlace[];
}): string {
  const lines = [
    `Fecha: ${a.date}${a.city ? ` · ${a.city}` : ''}`,
    `Desde: ${a.from} · Hasta: ${a.to}`,
  ];
  if (a.reason) lines.push(`Pedido: ${a.reason}`);
  lines.push('', 'Ocupado hoy:', ...(a.busy.length ? a.busy.map((b) => `- ${b.start_time ?? '?'}–${b.end_time ?? '?'} ${b.title}`) : ['- nada']));
  lines.push(
    '',
    'Banco de ideas:',
    ...(a.ideas.length
      ? a.ideas.map(
          (i) =>
            `- id=${i.id} · ${i.title} (${i.type})${i.place_name ? ` · ${i.place_name}` : ''}${i.duration_min ? ` · ${i.duration_min} min` : ''}${i.walk_min != null ? ` · a ${i.walk_min} min a pie` : ''}`,
        )
      : ['- vacío']),
  );
  lines.push(
    '',
    'Lugares cerca (abiertos ahora):',
    ...(a.places.length
      ? a.places.map(
          (p) =>
            `- ref=${p.ref} · ${p.name}${p.types.length ? ` (${p.types.slice(0, 2).join(', ')})` : ''}${p.rating ? ` · ★ ${p.rating}` : ''}${p.walk_min != null ? ` · a ${p.walk_min} min a pie` : ''}`,
        )
      : ['- ninguno']),
  );
  return lines.join('\n');
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toM = (t: string) => {
  const m = HHMM.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export type CleanItem = Omit<PlanDayItemT, 'type'> & { type: BlockType; start: number; end: number };

/**
 * Regla dura (no solo prompt): horas válidas dentro de [from, to), sin pisar lo ocupado ni entre sí, ids/refs que
 * existan, cada idea una sola vez, máximo 6.
 */
export function sanitizePlan(
  plan: PlanDayPlanT,
  a: { from: number; to: number; busy: { start: number; end: number }[]; ideaIds: Set<string>; placeRefs: Set<string> },
): CleanItem[] {
  const taken = [...a.busy];
  const usedIdeas = new Set<string>();
  const out: CleanItem[] = [];
  const items = [...plan.blocks].sort((x, y) => (toM(x.start_time) ?? 0) - (toM(y.start_time) ?? 0));
  for (const it of items) {
    const start = toM(it.start_time);
    const end = toM(it.end_time);
    if (start === null || end === null || end <= start || start < a.from || end > a.to) continue;
    if (taken.some((t) => start < t.end && t.start < end)) continue;
    const idea_id = it.idea_id && a.ideaIds.has(it.idea_id) && !usedIdeas.has(it.idea_id) ? it.idea_id : null;
    if (it.idea_id && !idea_id) continue; // inventó o repitió una idea
    const place_ref = it.place_ref && a.placeRefs.has(it.place_ref) ? it.place_ref : null;
    const title = it.title.trim().slice(0, 80);
    if (!title) continue;
    if (idea_id) usedIdeas.add(idea_id);
    taken.push({ start, end });
    out.push({ ...it, title, idea_id, place_ref, type: (BLOCK_TYPES as readonly string[]).includes(it.type) ? it.type : 'activity', start, end });
    if (out.length >= 6) break;
  }
  return out;
}
