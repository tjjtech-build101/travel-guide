// Rutas de los sheets del Plan (registradas como formSheet en app/(app)/_layout.tsx).
import { router } from 'expo-router';

export function openBlock(tripId: string, blockId: string, opts: { schedule?: boolean } = {}) {
  router.push({ pathname: '/plan/block/[blockId]', params: { blockId, tripId, ...(opts.schedule ? { schedule: '1' } : {}) } });
}

export function openNewBlock(tripId: string, p: { legId?: string; dayId?: string | null; idea?: boolean } = {}) {
  router.push({
    pathname: '/plan/new',
    params: {
      tripId,
      ...(p.legId ? { legId: p.legId } : {}),
      ...(p.dayId ? { dayId: p.dayId } : {}),
      ...(p.idea ? { idea: '1' } : {}),
    },
  });
}

export function openProposals(tripId: string) {
  router.push({ pathname: '/plan/proposals', params: { tripId } });
}

export function openBank(tripId: string, legId: string, dayId: string) {
  router.push({ pathname: '/plan/bank', params: { tripId, legId, dayId } });
}
