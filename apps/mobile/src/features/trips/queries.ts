// Lecturas directas a Supabase (RLS manda). Las escrituras van por la API de herramientas (lib/api.ts).
import type {
  ActivityFeedRow,
  BlockVisibleRow,
  DayRow,
  LegRow,
  ProfileRow,
  TripMemberRow,
  TripRow,
} from '@build101/shared';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../lib/supabase';
import { tripKeys } from './keys';

export type Person = Pick<ProfileRow, 'id' | 'display_name' | 'avatar_url'>;

async function fetchProfiles(ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', unique);
  if (error) throw error;
  return new Map((data as Person[]).map((p) => [p.id, p]));
}

function personFor(map: Map<string, Person>, id: string): Person {
  return map.get(id) ?? { id, display_name: null, avatar_url: null };
}

// ───────────────────────── Mis viajes

export type TripCard = TripRow & {
  destinations: string[];
  members: (Person & { role: TripMemberRow['role'] })[];
};

type TripListRow = TripRow & {
  legs: Pick<LegRow, 'city' | 'country' | 'sort_order' | 'start_date'>[] | null;
  trip_members: Pick<TripMemberRow, 'user_id' | 'role'>[] | null;
};

export function useMyTrips() {
  return useQuery({
    queryKey: tripKeys.mine(),
    queryFn: async (): Promise<TripCard[]> => {
      const { data, error } = await supabase
        .from('trips')
        .select('*, legs(city, country, sort_order, start_date), trip_members(user_id, role)')
        .order('start_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      const rows = (data ?? []) as TripListRow[];
      const profiles = await fetchProfiles(rows.flatMap((r) => (r.trip_members ?? []).map((m) => m.user_id)));
      return rows.map(({ legs, trip_members, ...trip }) => {
        const sortedLegs = [...(legs ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.start_date.localeCompare(b.start_date));
        return {
          ...trip,
          destinations: [...new Set(sortedLegs.map((l) => l.city))],
          members: (trip_members ?? []).map((m) => ({ ...personFor(profiles, m.user_id), role: m.role })),
        };
      });
    },
  });
}

// ───────────────────────── Shell del viaje

export function useTrip(tripId: string) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'trips'),
    queryFn: async (): Promise<TripRow | null> => {
      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
      // 22P02 = uuid inválido: lo tratamos como "no existe".
      if (error && error.code !== '22P02') throw error;
      return (data as TripRow | null) ?? null;
    },
  });
}

export type LegWithDays = LegRow & { days: DayRow[] };

export function useTripLegs(tripId: string) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'days'),
    queryFn: async (): Promise<LegWithDays[]> => {
      const { data, error } = await supabase
        .from('legs')
        .select('*, days(*)')
        .eq('trip_id', tripId)
        .order('start_date', { ascending: true })
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as LegWithDays[]).map((l) => ({
        ...l,
        days: [...(l.days ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
      }));
    },
  });
}

export function useTripBlocks(tripId: string) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'blocks'),
    queryFn: async (): Promise<BlockVisibleRow[]> => {
      const { data, error } = await supabase
        .from('blocks_visible')
        .select('*')
        .eq('trip_id', tripId)
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BlockVisibleRow[];
    },
  });
}

export type MemberWithProfile = Person & Pick<TripMemberRow, 'role' | 'joined_at'>;

export function useTripMembers(tripId: string) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'trip_members'),
    queryFn: async (): Promise<MemberWithProfile[]> => {
      const { data, error } = await supabase
        .from('trip_members')
        .select('user_id, role, joined_at')
        .eq('trip_id', tripId)
        .order('joined_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Pick<TripMemberRow, 'user_id' | 'role' | 'joined_at'>[];
      const profiles = await fetchProfiles(rows.map((r) => r.user_id));
      return rows.map((r) => ({ ...personFor(profiles, r.user_id), role: r.role, joined_at: r.joined_at }));
    },
  });
}

export function useActivityFeed(tripId: string, limit = 20) {
  return useQuery({
    queryKey: tripKeys.table(tripId, 'activity_feed'),
    queryFn: async (): Promise<ActivityFeedRow[]> => {
      const { data, error } = await supabase
        .from('activity_feed')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ActivityFeedRow[];
    },
  });
}

/** Mensaje de error legible para dev. */
export function errorDetail(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'object' && e && 'message' in e) {
    const code = 'code' in e ? ` (${String((e as { code: unknown }).code)})` : '';
    return `${String((e as { message: unknown }).message)}${code}`;
  }
  return String(e);
}
