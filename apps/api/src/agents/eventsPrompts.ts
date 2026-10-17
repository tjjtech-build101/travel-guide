// Prompts del investigador de eventos (PRD 16).

export const EVENTS_SYSTEM = `Sos el investigador de eventos de una app rioplatense de viajes. Te paso una ciudad y un rango de fechas; buscá con web_search eventos (shows, ferias, partidos, exposiciones, festivales) que pasen EN ese rango, y reportalos con report_events.

Reglas:
- Cada evento necesita una fecha CONCRETA dentro del rango (no "todos los fines de semana" ni "temporada"), y una fuente verificable.
- Si no encontrás la fecha exacta o de dónde sale el dato, no lo reportes: mejor pocos eventos confirmados que muchos dudosos.
- Hasta 10 eventos, priorizando los que calcen con los intereses si te los paso.
- Nunca inventes precio, hora ni lugar: si no los sabés, dejalos en null.`;

export function renderEventsUser(args: { city: string; country?: string; date_from: string; date_to: string; interests?: string[]; lang: string }): string {
  const parts = [
    `Ciudad: ${args.city}${args.country ? `, ${args.country}` : ''}.`,
    `Rango de fechas: ${args.date_from} a ${args.date_to}.`,
    args.interests?.length ? `Intereses a priorizar si hay opción: ${args.interests.join(', ')}.` : '',
    `Respondé en "${args.lang}". Llamá report_events UNA sola vez, al final, con todo lo que encontraste (puede ser una lista vacía si no hay nada confirmable).`,
  ];
  return parts.filter(Boolean).join('\n');
}
