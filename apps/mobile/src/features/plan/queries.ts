// Lecturas del Plan (Supabase directo, RLS manda). Realtime invalida por tabla (useTripRealtime):
//   overview  → ['trip', id, 'days', 'overview']        (se invalida con 'days': legs, agent_jobs, feed member_*/trip_planned)
//   blocks    → ['trip', id, 'blocks', 'plan']           (blocks, block_participants, feed block_* / busy_changed / undo)
//               (sub-key: ['trip', id, 'blocks'] lo usa useTripBlocks con otra forma de datos, sin participantes)
//   proposals → ['trip', id, 'agent_proposals', 'pending']
import type { AgentProposalRow, BlockVisibleRow, DayRow, LegRow, TripMemberRow, TripRole } from '@build101/shared';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { tripKeys } from '../trips/keys';
import { supabase } from '../../lib/supabase';
import type { PlanBlock, PlanLeg, PlanMember, PlanOverview } from './selectors';

export const planKeys = {
  overview: (tripId: string) => [...tripKeys.table(tripId, 'days'), 'overview'] as const,
  blocks: (tripId: string) => [...tripKeys.table(tripId, 'blocks'), 'plan'] as const,
  proposals: (tripId: string) => [...tripKeys.table(tripId, 'agent_proposals'), 'pending'] as const,
};

type LegQueryRow = LegRow & { days: DayRow[] | null; leg_members: { user_id: string }[] | null };

async function fetchOverview(tripId: string): Promise<PlanOverview> {
  const [legsRes, membersRes] = await Promise.all([
    supabase
      .from('legs')
      .select('*, days(*), leg_members(user_id)')
      .eq('trip_id', tripId)
      .order('start_date', { ascending: true })
      .order('sort_order', { ascending: true }),
    supabase.from('trip_members').select('user_id, role').eq('trip_id', tripId).order('joined_at', { ascending: true }),
  ]);
  if (legsRes.error) throw legsRes.error;
  if (membersRes.error) throw membersRes.error;
  const memberRows = (membersRes.data ?? []) as Pick<TripMemberRow, 'user_id' | 'role'>[];
  const ids = memberRows.map((m) => m.user_id);
  const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  if (ids.length) {
    const { data, error } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids);
    if (error) throw error;
    for (const p of (data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) profiles.set(p.id, p);
  }
  const legs: PlanLeg[] = ((legsRes.data ?? []) as LegQueryRow[]).map(({ days, leg_members, ...leg }) => ({
    ...leg,
    days: [...(days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    member_ids: (leg_members ?? []).map((m) => m.user_id),
  }));
  const members: PlanMember[] = memberRows.map((m) => ({
    id: m.user_id,
    display_name: profiles.get(m.user_id)?.display_name ?? null,
    avatar_url: profiles.get(m.user_id)?.avatar_url ?? null,
    role: m.role,
  }));
  return { legs, members };
}

export function usePlanOverview(tripId: string) {
  return useQuery({ queryKey: planKeys.overview(tripId), queryFn: () => fetchOverview(tripId) });
}

async function fetchBlocks(tripId: string): Promise<PlanBlock[]> {
  const { data, error } = await supabase
    .from('blocks_visible')
    .select('*')
    .eq('trip_id', tripId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as BlockVisibleRow[];
  const parts = new Map<string, string[]>();
  // block_participants: RLS solo devuelve los de bloques que puedo ver (los privados ajenos quedan sin participantes).
  for (let i = 0; i < rows.length; i += 150) {
    const ids = rows.slice(i, i + 150).map((r) => r.id);
    if (!ids.length) continue;
    const res = await supabase.from('block_participants').select('block_id, user_id').in('block_id', ids);
    if (res.error) throw res.error;
    for (const p of (res.data ?? []) as { block_id: string; user_id: string }[]) {
      parts.set(p.block_id, [...(parts.get(p.block_id) ?? []), p.user_id]);
    }
  }
  return rows.map((r) => ({ ...r, participant_ids: parts.get(r.id) ?? [] }));
}

export function usePlanBlocks(tripId: string) {
  return useQuery({ queryKey: planKeys.blocks(tripId), queryFn: () => fetchBlocks(tripId) });
}

export function usePendingProposals(tripId: string) {
  return useQuery({
    queryKey: planKeys.proposals(tripId),
    queryFn: async (): Promise<AgentProposalRow[]> => {
      const { data, error } = await supabase
        .from('agent_proposals')
        .select('*')
        .eq('trip_id', tripId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AgentProposalRow[];
    },
  });
}

export function useMe(): string {
  const { session } = useAuth();
  return session?.user.id ?? '';
}

export type Permissions = {
  role: TripRole | null;
  isFollower: boolean;
  canPropose: boolean;
  canEditLeg: (legId: string) => boolean;
  /** Puede editar este bloque (privado ajeno: nunca). */
  canEditBlock: (b: Pick<PlanBlock, 'leg_id' | 'masked'>) => boolean;
};

/** Permisos en UI (el backend igual responde 403 si se fuerza). Lo reusa PRD 04. */
export function usePermissions(tripId: string): Permissions {
  const me = useMe();
  const overview = usePlanOverview(tripId);
  const role = overview.data?.members.find((m) => m.id === me)?.role ?? null;
  const legs = overview.data?.legs;
  const canEditLeg = useCallback(
    (legId: string) => {
      if (role === 'organizer') return true;
      if (role !== 'traveler') return false;
      return !!legs?.find((l) => l.id === legId)?.member_ids.includes(me);
    },
    [role, legs, me],
  );
  return useMemo(
    () => ({
      role,
      isFollower: role === 'follower',
      canPropose: role === 'organizer' || role === 'traveler',
      canEditLeg,
      canEditBlock: (b) => !b.masked && canEditLeg(b.leg_id),
    }),
    [role, canEditLeg],
  );
}

/** Lectura sincrónica del caché (para sheets que se abren sobre el Plan). */
export function cachedBlock(qc: QueryClient, tripId: string, blockId: string): PlanBlock | undefined {
  return qc.getQueryData<PlanBlock[]>(planKeys.blocks(tripId))?.find((b) => b.id === blockId);
}
