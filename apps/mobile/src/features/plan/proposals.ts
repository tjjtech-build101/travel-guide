// Propuestas del Scout (PRD 11), lógica pura: si una pendiente sigue vigente y cómo contar sus cambios.
// La API es la que decide (decide_proposal marca expired); esto solo adelanta en la UI lo que va a pasar.
import { PROPOSAL_TTL_MS, type AgentProposalRow } from '@build101/shared';

type BlockLite = { id: string; title: string; updated_at: string; masked?: boolean };

export type Freshness = { stale: false } | { stale: true; reason: string };

/** Vencida: más de 24 h, o un bloque que toca ya no está o cambió después de crearla. */
export function proposalFreshness(p: Pick<AgentProposalRow, 'ops' | 'created_at'>, blocks: BlockLite[], now = Date.now()): Freshness {
  const created = Date.parse(p.created_at);
  if (now - created > PROPOSAL_TTL_MS) return { stale: true, reason: 'Pasaron más de 24 horas.' };
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const op of p.ops ?? []) {
    if (!('block_id' in op)) continue;
    const b = byId.get(op.block_id);
    if (!b) return { stale: true, reason: 'Uno de los bloques ya no está en el plan.' };
    if (Date.parse(b.updated_at) > created) {
      return { stale: true, reason: b.masked ? 'Cambió un bloque después de la propuesta.' : `Cambió «${b.title}» después de la propuesta.` };
    }
  }
  return { stale: false };
}

export function changesLabel(n: number): string {
  return `${n} ${n === 1 ? 'cambio' : 'cambios'}`;
}

/** Separa vigentes (para decidir) de vencidas (gris, para descartar). Las vigentes, la más nueva primero. */
export function splitProposals<P extends Pick<AgentProposalRow, 'ops' | 'created_at'>>(
  list: P[],
  blocks: BlockLite[],
  now = Date.now(),
): { fresh: P[]; stale: { proposal: P; reason: string }[] } {
  const fresh: P[] = [];
  const stale: { proposal: P; reason: string }[] = [];
  for (const p of list) {
    const f = proposalFreshness(p, blocks, now);
    if (f.stale) stale.push({ proposal: p, reason: f.reason });
    else fresh.push(p);
  }
  fresh.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return { fresh, stale };
}
