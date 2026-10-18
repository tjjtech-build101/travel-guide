// Cobertura de imperdibles de un tramo (PRD 31). Puro: cuenta qué imperdibles quedaron en el plan (como bloque
// principal o como una de las opciones de un "elegí 1 de N": si el grupo lo elige, se hace) y cuáles no, con el
// motivo que dejó el armado. `choices` = cuántos lugares del plan quedan para decidir.
import type { CatalogItem, PlanCoverage } from '@build101/shared';
import type { ComposedBlock } from './types';

export function coverageFor(
  leg: { id: string; city: string },
  mustItems: { item: CatalogItem; option_id: string | null }[],
  blocks: ComposedBlock[],
  unplaced: { item: CatalogItem; option_id: string | null; reason: string }[],
): PlanCoverage {
  const inPlan = new Set(blocks.filter((b) => b.day_id != null && b.item_id).map((b) => b.item_id!));
  const seen = new Set<string>();
  const musts = mustItems.filter((m) => (seen.has(m.item.id) ? false : (seen.add(m.item.id), true)));
  const missing = musts
    .filter((m) => !inPlan.has(m.item.id))
    .map((m) => ({
      option_id: m.option_id,
      item_id: m.item.id,
      name: m.item.name,
      reason: unplaced.find((u) => u.item.id === m.item.id)?.reason ?? 'quedó afuera del armado',
    }));
  const choices = new Set(blocks.map((b) => b.choice_key).filter((k): k is string => !!k)).size;
  return {
    leg_id: leg.id,
    city: leg.city,
    must_total: musts.length,
    must_covered: musts.length - missing.length,
    missing,
    choices,
  };
}
