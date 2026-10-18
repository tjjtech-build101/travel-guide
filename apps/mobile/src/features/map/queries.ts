// Tours (con paradas y coordenadas de place_library) de los bloques `tour` que se ven en el mapa.
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../lib/supabase';
import type { MapTour } from './model';

type Row = {
  id: string;
  title: string | null;
  thesis?: string | null;
  tour_stops: {
    id: string;
    sort_order: number | null;
    place_library: { name: string | null; lat: number | null; lng: number | null; google_place_id: string | null } | null;
  }[];
};

export function useMapTours(tourIds: string[]) {
  const ids = [...new Set(tourIds)].sort();
  return useQuery({
    queryKey: ['map', 'tours', ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<MapTour[]> => {
      const stops = 'tour_stops(id, sort_order, place_library(name, lat, lng, google_place_id))';
      const load = (cols: string) => supabase.from('tours').select(cols).in('id', ids);
      let { data, error } = await load(`id, title, thesis, ${stops}`);
      // Sin la migración del tour director (tours.thesis) el mapa sale igual, sin tesis.
      if (error && (error.code === '42703' || /thesis/.test(error.message))) ({ data, error } = await load(`id, title, ${stops}`));
      if (error) throw error;
      return ((data ?? []) as unknown as Row[]).map((t) => ({
        id: t.id,
        title: t.title ?? 'Tour',
        thesis: t.thesis ?? null,
        stops: [...t.tour_stops]
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .filter((s) => s.place_library?.lat != null && s.place_library?.lng != null)
          .map((s) => ({
            id: s.id,
            name: s.place_library!.name ?? 'Parada',
            lat: s.place_library!.lat!,
            lng: s.place_library!.lng!,
            google_place_id: s.place_library!.google_place_id,
          })),
      }));
    },
  });
}
