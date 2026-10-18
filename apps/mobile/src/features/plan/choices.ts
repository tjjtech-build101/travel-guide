// Lugares "elegí 1 de N" (PRD 31): bloques agendados del mismo día con el mismo choice_group.
// Un grupo pendiente (≥ 2 opciones en el día) se muestra como UNA tarjeta en el Plan y cuenta como un solo bloque
// (el de menor sort_order = la recomendada) en Mapa, Ahora y el vigilante de horarios. Puro, sin React.

type ChoiceLike = { id: string; choice_group?: string | null; day_id: string | null; sort_order: number | null };

const keyOf = (b: ChoiceLike) => (b.choice_group && b.day_id ? `${b.day_id}|${b.choice_group}` : null);

const bySort = (a: ChoiceLike, b: ChoiceLike) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id);

/** Grupos pendientes: choice_group → opciones del día ordenadas por sort_order (la primera es la recomendada). */
export function pendingChoiceGroups<T extends ChoiceLike>(blocks: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const b of blocks) {
    const k = keyOf(b);
    if (k) m.set(k, [...(m.get(k) ?? []), b]);
  }
  const out = new Map<string, T[]>();
  for (const list of m.values()) if (list.length > 1) out.set(list[0].choice_group!, [...list].sort(bySort));
  return out;
}

/** Saca las opciones no recomendadas de cada grupo pendiente (mantiene el orden original del resto). */
export function collapseChoices<T extends ChoiceLike>(blocks: T[]): T[] {
  const groups = pendingChoiceGroups(blocks);
  if (!groups.size) return blocks;
  const drop = new Set<string>();
  for (const list of groups.values()) for (const b of list.slice(1)) drop.add(b.id);
  return blocks.filter((b) => !drop.has(b.id));
}

/** Cantidad de lugares con opciones para elegir. */
export function pendingChoiceCount(blocks: ChoiceLike[]): number {
  return pendingChoiceGroups(blocks).size;
}
