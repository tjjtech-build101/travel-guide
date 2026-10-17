// Tours con sus paradas (lat/lng de place_library) para "Saltar a parada" y el track sintético del simulador.
import type { NamedPoint } from '@build101/shared';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../lib/supabase';

export type TourWithStops = { id: string; title: string; status: string; created_at: string; stops: NamedPoint[] };

type Row = {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  tour_stops: { sort_order: number | null; place_library: { name: string | null; lat: number | null; lng: number | null } | null }[];
};

export async function fetchToursWithStops(limit = 15): Promise<TourWithStops[]> {
  const { data, error } = await supabase
    .from('tours')
    .select('id, title, status, created_at, tour_stops(sort_order, place_library(name, lat, lng))')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map((t) => ({
    id: t.id,
    title: t.title ?? 'Tour sin título',
    status: t.status,
    created_at: t.created_at,
    stops: [...t.tour_stops]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .filter((s) => s.place_library?.lat != null && s.place_library?.lng != null)
      .map((s) => ({ name: s.place_library!.name ?? 'Parada', lat: s.place_library!.lat!, lng: s.place_library!.lng! })),
  }));
}

export function useToursWithStops(enabled: boolean) {
  return useQuery({ queryKey: ['gps', 'tours'], queryFn: () => fetchToursWithStops(), enabled });
}
