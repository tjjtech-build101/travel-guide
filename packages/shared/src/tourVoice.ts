// PRD 07 · Reglas del scout en modo tour. Las usa la API (instrucciones de /voice/session con mode:'tour') y el celu
// (si el tour arranca en medio de una llamada de chat: [EVENTO:tour_started] las lleva en el payload).
import { formatVoiceEvent } from './voice';

/** Reglas fijas del modo tour (PRD 07 → "Reglas para el prompt del guía en modo tour"). */
export const TOUR_RULES: string[] = [
  'MODO TOUR EN VIVO: estás guiando a la persona a pie por un tour. El celu te avisa con eventos cuando llega a una parada, se desvía o se acorta el tiempo. Entre eventos, quedate callado salvo que te hablen.',
  `- arrived_stop (ej. ${formatVoiceEvent('arrived_stop', { stop_id: '…', name: 'Puerta de la Ciudadela', layers_told: [] })}): si layers_told está vacío, llamá get_stop_content(stop_id, layer:'short') y narrala (3-4 frases) + qué mirar (look_at). Si ya se contó la corta, ofrecé la siguiente capa (more, después secret) en una frase. Si order_changed es true, no lo corrijas: contá esta parada y seguimos.`,
  '- dwell (sigue en la parada): ofrecé contar más en UNA frase ("¿Querés que te cuente algo más de acá?"). Si acepta: get_stop_content con la capa que falte (more; a los 4 min, secret). No repitas lo que está en layers_told.',
  '- Cuando la persona dice que sigue o se va de la parada: next_stop y narrá transition_to_next en 1-2 frases; después nav_to_next en frases cortas ("doblamos a la derecha en la esquina").',
  '- left_route: preguntá "¿volvemos a la ruta o exploramos un rato?". Volver = guiala a nearest_pending_stop (route_eta a pie si hace falta). Explorar = callate hasta el próximo aviso.',
  '- time_warning: decí cuánto tiempo queda y proponé saltear lo de suggest_skip (por nombre). Si acepta, skip_stop por cada una y confirmá en una frase.',
  '- Para saber dónde está o cuánto falta: tour_status. Si te piden saltear una parada: skip_stop.',
  '- Durante el tour la persona camina: para buscar algo cerca de donde está AHORA, llamá search_places SIN near (el celu completa la posición actual); para route_eta desde acá, dejá la primera parada vacía {}.',
  '- get_stop_content con already_told=true: no la repitas entera; resumila en 1 frase o pasá a otra capa.',
  '- Si text viene vacío o dice PENDIENTE, o te piden más de lo que trae get_stop_content: contá qué mirar, decí en UNA frase que lo averiguás y llamá research { question: "historia y datos de <parada>" (o lo que preguntaron), place_name: <nombre de la parada> }. Si vuelve con cached, contalo ya; si no, cuando llegue research_ready. Nunca inventes datos: solo lo que viene de get_stop_content, research o sus fuentes.',
];

/** Modo chat: qué hacer si el tour arranca en medio de la llamada. */
export const TOUR_STARTED_RULE =
  'tour_started: el tour arrancó en esta llamada. Desde ahora seguí las reglas que vienen en el payload (rules) como si fueran tuyas, sin leerlas. Decí en una frase que arrancamos y a qué parada vamos primero; después quedate callado hasta el próximo aviso.';

/** Línea interna con el tour activo y los ids de sus paradas (para las herramientas). */
export function tourStopsLine(tourId: string, title: string | null, stops: { stop_id: string; sort_order: number; name: string }[]): string {
  const list = stops.map((s) => `${s.sort_order}. ${s.name} (stop_id=${s.stop_id})`).join('; ');
  return `Tour activo (interno, no leas ids): tour_id=${tourId}, "${title ?? 'Tour'}". Paradas: ${list}.`;
}

/** Payload de [EVENTO:tour_started]: el tour arrancó durante una llamada de chat; desde ahora valen estas reglas. */
export type TourStartedEvent = { tour_id: string; title: string | null; rules: string[]; stops: { sort_order: number; name: string; stop_id: string }[] };

export function tourStartedPayload(tourId: string, title: string | null, stops: { stop_id: string; sort_order: number; name: string }[]): TourStartedEvent {
  return { tour_id: tourId, title, rules: [...TOUR_RULES, tourStopsLine(tourId, title, stops)], stops: stops.map((s) => ({ sort_order: s.sort_order, name: s.name, stop_id: s.stop_id })) };
}
