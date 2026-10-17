// PRD 07 · Reglas del scout en modo `tour` (se suman con VoiceDeps.modeRules al armado de instrucciones de PRD 05).
import { formatVoiceEvent } from '@build101/shared';
import { serviceClient, type Db } from '../supabase';
import { stopName, type StopRow } from '../tourLive';

/** Reglas fijas del modo tour (PRD 07 → "Reglas para el prompt del guía en modo tour"). */
export const TOUR_RULES: string[] = [
  'MODO TOUR EN VIVO: estás guiando a la persona a pie por un tour. El celu te avisa con eventos cuando llega a una parada, se desvía o se acorta el tiempo. Entre eventos, quedate callado salvo que te hablen.',
  `- arrived_stop (ej. ${formatVoiceEvent('arrived_stop', { stop_id: '…', name: 'Puerta de la Ciudadela', layers_told: [] })}): si layers_told está vacío, llamá get_stop_content(stop_id, layer:'short') y narrala (3-4 frases) + qué mirar (look_at). Si ya se contó la corta, ofrecé la siguiente capa (more, después secret) en una frase. Si order_changed es true, no lo corrijas: contá esta parada y seguimos.`,
  '- dwell (sigue en la parada): ofrecé contar más en UNA frase ("¿Querés que te cuente algo más de acá?"). Si acepta: get_stop_content con la capa que falte (more; a los 4 min, secret). No repitas lo que está en layers_told.',
  '- Cuando la persona dice que sigue o se va de la parada: next_stop y narrá transition_to_next en 1-2 frases; después nav_to_next en frases cortas ("doblamos a la derecha en la esquina").',
  '- left_route: preguntá "¿volvemos a la ruta o exploramos un rato?". Volver = guiala a nearest_pending_stop (route_eta a pie si hace falta). Explorar = callate hasta el próximo aviso.',
  '- time_warning: decí cuánto tiempo queda y proponé saltear lo de suggest_skip (por nombre). Si acepta, skip_stop por cada una y confirmá en una frase.',
  '- Para saber dónde está o cuánto falta: tour_status. Si te piden saltear una parada: skip_stop.',
  '- get_stop_content con already_told=true: no la repitas entera; resumila en 1 frase o pasá a otra capa.',
  '- Si text viene vacío o dice PENDIENTE: decí que de esa parada todavía no tenés la historia verificada y contá solo qué mirar. Nunca inventes datos: solo lo que viene de get_stop_content o sus fuentes; si no sabés, decilo.',
];

type Loader = (tourId: string) => Promise<{ title: string | null; stops: StopRow[] } | null>;

async function defaultLoader(tourId: string, db: Db = serviceClient()) {
  const [{ data: tour }, { data: stops }] = await Promise.all([
    db.from('tours').select('title').eq('id', tourId).maybeSingle(),
    db.from('tour_stops').select('id,sort_order,place_id,place_library(name)').eq('tour_id', tourId).order('sort_order'),
  ]);
  if (!tour) return null;
  return { title: (tour.title as string | null) ?? null, stops: (stops ?? []) as unknown as StopRow[] };
}

/** Reglas del modo tour + datos del tour (ids para las herramientas). En modo chat no agrega nada. */
export function makeTourModeRules(load: Loader = (id) => defaultLoader(id)) {
  return async (mode: 'chat' | 'tour', tourId?: string): Promise<string[]> => {
    if (mode !== 'tour') return [];
    const rules = [...TOUR_RULES];
    if (!tourId) return rules;
    try {
      const t = await load(tourId);
      if (t) {
        const list = t.stops.map((s) => `${s.sort_order}. ${stopName(s)} (stop_id=${s.id})`).join('; ');
        rules.push(`Tour activo (interno, no leas ids): tour_id=${tourId}, "${t.title ?? 'Tour'}". Paradas: ${list}.`);
      }
    } catch (e) {
      console.warn('[voice] tour rules', (e as Error).message);
    }
    return rules;
  };
}

export const tourModeRules = makeTourModeRules();
