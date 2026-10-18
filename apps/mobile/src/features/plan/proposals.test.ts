// Tests de propuestas (PRD 11). Sin dependencias: `pnpm --filter mobile test:proposals` (tsx).
import type { ProposalOp } from '@build101/shared';

import { changesLabel, proposalFreshness, splitProposals } from './proposals';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`);
}

const now = Date.parse('2026-10-18T15:00:00Z');
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const block = (id: string, updatedAgo: number) => ({ id, title: `Bloque ${id}`, updated_at: iso(updatedAgo) });
const prop = (id: string, createdAgo: number, ops: ProposalOp[]) => ({ id, created_at: iso(createdAgo), ops });

test('vigente: los bloques no cambiaron desde la propuesta', () => {
  eq(proposalFreshness(prop('p', 60_000, [{ op: 'update', block_id: 'a', patch: { title: 'x' } }]), [block('a', 120_000)], now), { stale: false });
});

test('vencida: bloque cambiado después, bloque que no está, o más de 24 h', () => {
  const ops: ProposalOp[] = [{ op: 'remove', block_id: 'a' }];
  eq(proposalFreshness(prop('p', 60_000, ops), [block('a', 1_000)], now).stale, true);
  eq(proposalFreshness(prop('p', 60_000, ops), [], now).stale, true);
  eq(proposalFreshness(prop('p', 25 * 3600_000, [{ op: 'add', block: { title: 'x' } }]), [], now).stale, true);
});

test('splitProposals: vigentes primero la más nueva; vencidas aparte con motivo', () => {
  const list = [
    prop('vieja', 120_000, [{ op: 'add', block: {} }]),
    prop('nueva', 10_000, [{ op: 'add', block: {} }]),
    prop('rota', 60_000, [{ op: 'move', block_id: 'z', patch: {} }]),
  ];
  const r = splitProposals(list, [], now);
  eq(r.fresh.map((p) => p.id), ['nueva', 'vieja']);
  eq(r.stale.map((s) => s.proposal.id), ['rota']);
});

test('changesLabel', () => {
  eq([changesLabel(1), changesLabel(3)], ['1 cambio', '3 cambios']);
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('ok');
