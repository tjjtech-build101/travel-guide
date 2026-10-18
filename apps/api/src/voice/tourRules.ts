// PRD 07 · Reglas del scout en modo `tour` (se suman con VoiceDeps.modeRules al armado de instrucciones de PRD 05).
import { INDOOR_TOUR_RULES, isManualTour, TOUR_RULES, TOUR_STARTED_RULE, tourStopsLine, type TourRoute } from '@build101/shared';
import { serviceClient, type Db } from '../supabase';
import { stopName, type StopRow } from '../tourLive';

export { TOUR_RULES };

type Loader = (tourId: string) => Promise<{ title: string | null; route?: TourRoute | null; stops: StopRow[] } | null>;

async function defaultLoader(tourId: string, db: Db = serviceClient()) {
  const [{ data: tour }, { data: stops }] = await Promise.all([
    db.from('tours').select('title,route').eq('id', tourId).maybeSingle(),
    db.from('tour_stops').select('id,sort_order,place_id,place_library(name)').eq('tour_id', tourId).order('sort_order'),
  ]);
  if (!tour) return null;
  return { title: (tour.title as string | null) ?? null, route: (tour.route as TourRoute | null) ?? null, stops: (stops ?? []) as unknown as StopRow[] };
}

/** Reglas del modo tour (+ las del tour interno si positioning es manual) + datos del tour (ids para las herramientas). En modo chat, solo cómo tomar [EVENTO:tour_started]. */
export function makeTourModeRules(load: Loader = (id) => defaultLoader(id)) {
  return async (mode: 'chat' | 'tour', tourId?: string): Promise<string[]> => {
    if (mode !== 'tour') return [TOUR_STARTED_RULE];
    const rules = [...TOUR_RULES];
    if (!tourId) return rules;
    try {
      const t = await load(tourId);
      if (t) {
        if (isManualTour(t.route)) rules.push(...INDOOR_TOUR_RULES);
        rules.push(tourStopsLine(tourId, t.title, t.stops.map((s) => ({ stop_id: s.id, sort_order: s.sort_order ?? 0, name: stopName(s) }))));
      }
    } catch (e) {
      console.warn('[voice] tour rules', (e as Error).message);
    }
    return rules;
  };
}

export const tourModeRules = makeTourModeRules();
