// Vista previa del tour del bloque (hero tour): paradas, duración, km y puntos para el minimapa.
// Lee tours + tour_stops(place_library) como features/gps/tours.ts. null mientras carga o si no hay tour.
import { useQuery } from '@tanstack/react-query';

import { supabase } from '../../../../lib/supabase';
import { summarizeTour, type TourPreview, type TourPreviewRow } from './pure';

export type { TourPreview };

export function useTourPreview(tourId: string | null | undefined): TourPreview | null {
  const q = useQuery({
    queryKey: ['tour', tourId, 'preview'],
    enabled: !!tourId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<TourPreview | null> => {
      const { data, error } = await supabase
        .from('tours')
        .select('duration_min, route, tour_stops(sort_order, place_library(name, lat, lng))')
        .eq('id', tourId!)
        .maybeSingle();
      if (error) throw error;
      return data ? summarizeTour(data as unknown as TourPreviewRow) : null;
    },
  });
  return q.data ?? null;
}
