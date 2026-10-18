// tour_variants (planificador de tours, paso 2 — como trip_shapes): 2-3 recorridos posibles para elegir.
// Usa la misma preparación que generate_tour (prepareTour: candidatos reales, lugares pedidos, puntaje para el grupo,
// problema de ruta) y arma variantes con estrategias distintas sobre los mismos candidatos:
//   A · recomendado (el puntaje tal cual) · B · joyas (pesa lo menos conocido) · C · otro cierre (con vista) o un tema
//   a fondo. Se descartan las que repiten casi las mismas paradas. Claude les pone nombre, pitch, pros/contras y
//   elige la recomendada; si falla, quedan nombres por defecto.
import { distanceMeters, type TourUnderstanding, type TourVariant, type TourVariantsResult } from '@build101/shared';
import { z } from 'zod';
import type { Effort } from './llm';
import type { Usage } from './schemas';
import { KIND_LABEL, mustMatchScore, type Keyed, type PreparedTour } from './tourGenerator';
import { normalizeNotability, planRoute, type PlaceKind, type RoutePlan } from './tourRoute';

export const VariantsOutput = z.object({
  variants: z.array(
    z.object({
      id: z.string().describe('El id de la variante tal como te lo pasé (A, B, C)'),
      label: z.string().describe('2-4 palabras ("Lo esencial", "Joyas de barrio", "Final con vista al río")'),
      title: z.string().describe('Título evocador del tour (máx. 6 palabras, sin dos puntos de folleto)'),
      pitch: z.string().describe('Una frase de venta pensada para esta persona'),
      tradeoffs: z.array(z.string()).describe('2-3 pros y contras cortos, empezando con "+" o "−"'),
      recommended: z.boolean(),
      stop_why: z.array(z.object({ name: z.string(), why: z.string().describe('Por qué está esta parada, una frase corta') })),
    }),
  ),
});
export type VariantsOutputT = z.infer<typeof VariantsOutput>;

export const VARIANTS_SYSTEM = `Sos el director creativo de los tours a pie del Scout, un guía rioplatense. Te paso lo que quiere la persona (entrevista + ficha del grupo) y 2-3 recorridos posibles ya calculados (paradas reales en orden, minutos y km), cada uno con un id. Para cada uno: label corto, title evocador, una frase de venta pensada para ESTA persona (nombrá lo que pidió si está), 2-3 pros/contras honestos ("+ termina con vista al río", "− más caminata", "− no entra el Museo X") y por qué está cada parada (una frase, sin inventar datos históricos: si no sabés, decí qué se ve o qué tipo de lugar es). Marcá recommended=true en UNA sola: la que mejor cumple lo que pidió (lugares pedidos primero). Voseo, cálido, sin folleto.`;

export type VariantPlan = { id: string; strategy: 'recommended' | 'gems' | 'finish_view' | 'theme'; theme?: string; plan: RoutePlan };

/** Jaccard de paradas: dos variantes con ≥ 75% de paradas en común son la misma. */
export function samePlan(a: string[], b: string[]): boolean {
  const A = new Set(a);
  const inter = b.filter((k) => A.has(k)).length;
  return inter / new Set([...a, ...b]).size >= 0.75;
}

/** Las 2-3 variantes (sin LLM). Pura sobre lo preparado. */
export function planVariants(prep: PreparedTour, u: TourUnderstanding): VariantPlan[] {
  const { keyed, baseProblem, routeCand, maxStops, budget, lastKey, group } = prep;
  const plans: VariantPlan[] = [];
  const add = (v: VariantPlan) => {
    if (v.plan.keys.length < 3) return;
    if (plans.some((p) => samePlan(p.plan.keys, v.plan.keys))) return;
    plans.push(v);
  };
  const run = (score: (c: Keyed) => number, extra: { lastKey?: string | null } = {}) =>
    planRoute({ ...baseProblem, lastKey: extra.lastKey !== undefined ? extra.lastKey : lastKey, budgetMin: budget, maxStops, candidates: keyed.map((c) => ({ ...routeCand(c), score: score(c) })) });

  // A · recomendado.
  add({ id: 'A', strategy: 'recommended', plan: run((c) => c.score) });
  // B · joyas: lo menos conocido sube (lo pedido sigue adentro: es obligatorio en la ruta).
  add({
    id: 'B',
    strategy: 'gems',
    plan: run((c) => {
      const n = normalizeNotability({ rating_count: c.rating_count, sitelinks: c.sitelinks, verified_facts: c.facts.filter((f) => f.verified).length });
      return c.score * (1.35 - 0.9 * n);
    }),
  });
  // C · si no eligió cómo terminar: cierre con vista; si no, el tema que más le gusta, a fondo.
  const VIEW: PlaceKind[] = ['viewpoint', 'plaza', 'park'];
  const viewEnd = !u.finish && !baseProblem.end ? keyed.filter((c) => VIEW.includes(c.kind)).sort((a, b) => b.score - a.score)[0] : undefined;
  if (viewEnd) add({ id: 'C', strategy: 'finish_view', plan: run((c) => c.score, { lastKey: viewEnd.key }) });
  const topTheme = Object.entries(group.weights).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topTheme) add({ id: plans.some((p) => p.id === 'C') ? 'D' : 'C', strategy: 'theme', theme: topTheme, plan: run((c) => c.score * (c.interests.includes(topTheme as never) ? 2.2 : 0.6)) });
  return plans.slice(0, 3);
}

const DEFAULT_LABEL: Record<VariantPlan['strategy'], string> = { recommended: 'Lo esencial', gems: 'Joyas escondidas', finish_view: 'Final con vista', theme: 'A fondo' };

export type VariantsDeps = {
  llm: (call: { system: string; user: string; effort: Effort }) => Promise<{ value: VariantsOutputT; usage: Usage }>;
  summaries: (stops: Keyed[]) => Promise<Map<string, string>>;
};

export async function buildVariants(prep: PreparedTour, u: TourUnderstanding, conversationText: string, deps: VariantsDeps): Promise<TourVariantsResult> {
  const plans = planVariants(prep, u);
  if (!plans.length) return { variants: [] };
  const { byKey, mustNames, input } = prep;
  const allStops = [...new Set(plans.flatMap((p) => p.plan.keys))].map((k) => byKey.get(k)!);
  const summaries = await deps.summaries(allStops).catch(() => new Map<string, string>());

  const base: TourVariant[] = plans.map((p) => {
    const stops = p.plan.keys.map((k) => byKey.get(k)!);
    const included = mustNames.filter((m) => stops.some((s) => mustMatchScore(m, s.name) >= 0.45 || (s.must && prep.mustSet.has(s))));
    return {
      id: p.id,
      label: p.strategy === 'theme' && p.theme ? `${DEFAULT_LABEL.theme}: ${p.theme.replace('_', ' ')}` : DEFAULT_LABEL[p.strategy],
      pitch: '',
      tradeoffs: [],
      recommended: p.id === 'A',
      title: '',
      stops: stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, kind: KIND_LABEL[s.kind], google_place_id: s.google_place_id ?? null, wikidata_id: s.wikidata_id ?? null, why: null })),
      duration_min: input.duration_min,
      est_duration_min: p.plan.totalMin,
      walk_m: p.plan.walkM,
      must_included: included,
      must_missing: mustNames.filter((m) => !included.includes(m)),
    };
  });

  try {
    const user = [
      `LO QUE QUIERE (entrevista)\n${conversationText}`,
      `FICHA DEL GRUPO\n${prep.audience}`,
      ...base.map(
        (v) =>
          `### Variante ${v.id} (${v.label}) · ~${v.est_duration_min} min · ${(v.walk_m / 1000).toFixed(1)} km${v.must_missing.length ? ` · NO incluye: ${v.must_missing.join(', ')}` : ''}\n${v.stops
            .map((s, i) => `${i + 1}. ${s.name} (${s.kind})${summaries.get(s.name) ? `: ${summaries.get(s.name)!.slice(0, 220)}` : ''}`)
            .join('\n')}`,
      ),
    ].join('\n\n');
    const { value } = await deps.llm({ system: VARIANTS_SYSTEM, user, effort: 'low' });
    const byId = new Map(value.variants.map((v) => [v.id, v]));
    const hasRec = value.variants.some((v) => v.recommended && byId.has(v.id));
    for (const v of base) {
      const o = byId.get(v.id);
      if (!o) continue;
      v.label = o.label || v.label;
      v.title = o.title;
      v.pitch = o.pitch;
      v.tradeoffs = o.tradeoffs.slice(0, 3);
      if (hasRec) v.recommended = !!o.recommended;
      const why = new Map(o.stop_why.map((w) => [w.name.toLowerCase(), w.why]));
      v.stops = v.stops.map((s) => ({ ...s, why: why.get(s.name.toLowerCase()) ?? null }));
    }
  } catch (err) {
    console.warn('[tour_variants] sin nombres de Claude:', (err as Error).message);
  }
  // Una sola recomendada; si ninguna, la que más pedidos incluye.
  if (base.filter((v) => v.recommended).length !== 1) {
    const best = [...base].sort((a, b) => b.must_included.length - a.must_included.length)[0];
    base.forEach((v) => (v.recommended = v === best));
  }
  return { variants: base };
}

/** Distancia total en línea recta de un recorrido (para tests y chequeos). */
export function pathMeters(stops: { lat: number; lng: number }[]): number {
  return stops.slice(1).reduce((m, s, i) => m + distanceMeters(stops[i], s), 0);
}
