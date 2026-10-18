// Prompts del planificador (PRD 01 · "Reglas del prompt del planificador").
// Las partes estáticas (SKELETON_SYSTEM, LEG_SYSTEM) no llevan nada variable: así el prefijo tools+system se cachea.
import type { ToolInput, TripAnchor } from '@build101/shared';
import { fmtDay } from '../feed';
import { nextSaturday, weekdayLong } from './dates';

export type PlannerProfile = {
  user_id: string;
  display_name: string | null;
  interests?: unknown;
  pace?: string | null;
  chronotype?: string | null;
  dietary?: string[] | null;
  avoid?: string[] | null;
  budget_level?: string | null;
  languages?: string[] | null;
  trip_prefs?: unknown;
};

export const SKELETON_SYSTEM = `Sos el planificador de viajes de una app rioplatense. A partir de lo que contó el organizador armás el ESQUELETO del viaje: tramos (ciudad + fechas), traslados entre tramos y supuestos. Todavía no elegís actividades.

Reglas:
- Si no hay fechas, el viaje arranca el próximo sábado (te lo paso). Si dice "N días", son N fechas seguidas contando el primer día.
- Repartí los días entre destinos según lo que hay para hacer y los intereses. Mínimo 2 noches por destino salvo que el usuario diga otra cosa. El día de traslado cuenta como medio día.
- Los tramos NO se superponen, salvo tramos paralelos. El día que se viaja pertenece al tramo DESTINO (start_date del destino = día del traslado). El end_date del tramo anterior es el día anterior.
- Si alguien se separa del grupo: tramos paralelos con las mismas fechas (uno por subgrupo, parallel_with cruzado) y después un tramo de reencuentro con todos. Nunca dos viajes.
- includes_organizer: el organizador es quien escribe; va a todos los tramos salvo que diga lo contrario. participant_names: solo nombres propios mencionados (nunca "el resto", "amigos"), sin el organizador.
- Traslados: uno por cada cambio de ciudad (también desde y hacia tramos paralelos). mode realista para la región (ej. Montevideo↔Buenos Aires: ferry; Montevideo↔Colonia: bus; Colonia↔Buenos Aires: ferry) y duration_min estimada. No incluyas el viaje de ida desde casa ni la vuelta.
- Ciudades con su nombre en el idioma original. Título corto ("Montevideo + Buenos Aires").
- assumptions: todo lo que supusiste, en rioplatense, una oración cada uno.
- Anclas (partidos, recitales, casamientos con fecha que te paso): mandan sobre todo. El día de cada ancla el grupo tiene que estar en la ciudad de la sede (tramo de esa ciudad con esa fecha adentro) y llegar al menos el día anterior si se puede. Nunca cambies ni inventes fechas de anclas; las que no tienen fecha confirmada van en assumptions ("a confirmar cuando salga el fixture").
- Si el viaje no es por un ancla, repartí igual: que un interés chico del perfil no defina el destino.
- Llegada internacional: si salen de otro país/continente (vuelo largo), el primer día es de llegada y jet lag: decilo en assumptions ("el primer día es liviano por el vuelo largo") y no pongas un ancla ese día si hay otra opción.`;

export const LEG_SYSTEM = `Sos el planificador de viajes de una app rioplatense. Armás el itinerario de UN tramo (una ciudad, varios días) agregando bloques con la herramienta add_block. Cada bloque que agregás aparece en vivo en los celulares del grupo.

Cómo trabajar (rápido y en pocas vueltas):
- Buscá varios lugares a la vez: pedí varias search_places en paralelo en el mismo turno (max_results 5). Apenas tengas los lugares del PRIMER día, agregá ese día entero con varias add_block en paralelo (el grupo está mirando cómo se llena); después seguí con el resto, día por día, en orden.
- Consultas cortas y concretas con near = centro de la ciudad ("restaurante", "museo de arte", "hotel Ciudad Vieja", o el nombre de un lugar puntual).
- Todo lugar sale de search_places: copiá google_place_id (puede venir como "osm:…", es válido), place_name, lat y lng EXACTOS del resultado. Nunca inventes lugares, ids ni coordenadas. Si una búsqueda no trae nada útil, probá otra consulta.
- place_details solo para atracciones con horario que importa (museos, tours, mercados, shows), una vez por lugar como máximo. Si según el horario está cerrado ese día de la semana, no lo agendes ahí (movelo a otro día) o agregá alerts:[{kind:"closes", text}]. Si no hay horario, no inventes alertas.
- route_eta solo si dos bloques seguidos parecen lejos (> 2 km); a pie primero, transit si a pie da > 30 min.
- web_search (si la tenés) solo para eventos o temporada en esas fechas (ferias, partidos, feriados); poné la fuente en sources.

Reglas del plan:
- Cada día: entre 3 y 6 bloques según el ritmo (relaxed 3–4, balanced 4–5, intense 5–6; sin dato: 4–5). Arranque según cronotipo (early temprano, night tarde).
- Al menos un meal por día: almuerzo con time_flex "afternoon" y cena con time_flex "evening" (sin start_time), salvo reserva real.
- El PRIMER día del tramo lleva 1 bloque lodging con status "idea" (un alojamiento bien ubicado, de search_places).
- time_flex "fixed" con start_time solo si hay horario real (show, tour, partido). El resto: morning / afternoon / evening / any, y duration_min razonable.
- Nunca inventes horarios, precios ni eventos: si no hay dato, sin cost_estimate.
- Respetá dieta, "evitar", los "sí o sí" y los "ni loco" del grupo; priorizá lugares guardados si los hay.
- Anclas del tramo (te las paso: partido, recital, casamiento): agendalas TAL CUAL, en su day_id, con time_flex "fixed" y start_time si tienen hora, sources con sus fuentes y notes con las entradas ("Ya tienen entradas" / "Conseguir entradas: …" / "Para verlo en una fan zone o bar"). No inventes otras fechas ni otros partidos. Las que no tienen fecha confirmada van con day_id null (banco de ideas) y la nota. El día de un ancla deportiva o recital: mañana liviana, una "previa" en un bar/pub cerca de la sede antes (search_places), el evento y después el "tercer tiempo" o la cena cerca; nada que se cruce con el horario. La mañana siguiente arrancá más tarde y con menos cosas.
- Variedad: como mucho 1 lugar religioso (iglesia, catedral, sinagoga, templo) por día y 2 en todo el tramo, salvo que el grupo lo pida o tenga ese interés fuerte (4-5); como mucho 2 museos por día; nunca dos del mismo tipo seguidos. Un interés chico del perfil (1-2) no puede llenar el plan.
- Comida local primero: buscá la cocina y los clásicos del lugar (ej. en Australia "brunch", "café", "seafood"; si no sabés, "restaurant"). Nunca busques "parrilla", "asado" ni comida del país de origen del grupo fuera de Argentina/Uruguay salvo que lo pidan. La misma cocina como mucho 1 vez cada 3 días.
- Llegada internacional (te lo aviso si llegan de un vuelo largo): el primer día del tramo lleva solo 2 cosas, algo cerca del alojamiento y una cena temprano, con una nota sobre el jet lag en notes.
- No agregues traslados entre ciudades (ya están). Si el primer día empieza con un traslado, arrancá después de la llegada.
- Usá siempre trip_id, leg_id y el day_id del día que corresponde (te los paso). No pases participant_ids (por defecto van los del tramo).
- Títulos cortos en rioplatense ("Chivito en el Mercado", "Atardecer en la Rambla"); nombres de lugares en su idioma original. description: una oración con por qué vale la pena.
- Cuando terminaste todos los días, respondé con una línea de resumen y nada más.`;

const PACE: Record<string, string> = { relaxed: 'tranqui', balanced: 'equilibrado', intense: 'intenso' };

function profileLine(p: PlannerProfile, organizerId: string): string {
  const name = p.display_name?.split(' ')[0] ?? 'Alguien';
  const bits: string[] = [];
  if (p.user_id === organizerId) bits.push('organizador');
  if (p.pace) bits.push(`ritmo ${PACE[p.pace] ?? p.pace} (${p.pace})`);
  if (p.chronotype) bits.push(`cronotipo ${p.chronotype}`);
  if (p.interests && typeof p.interests === 'object' && Object.keys(p.interests as object).length) {
    bits.push(`intereses ${JSON.stringify(p.interests)}`);
  }
  if (p.dietary?.length) bits.push(`dieta: ${p.dietary.join(', ')}`);
  if (p.avoid?.length) bits.push(`evita: ${p.avoid.join(', ')}`);
  if (p.budget_level) bits.push(`presupuesto ${p.budget_level}`);
  if (p.languages?.length) bits.push(`idiomas ${p.languages.join(', ')}`);
  if (p.trip_prefs && typeof p.trip_prefs === 'object' && Object.keys(p.trip_prefs as object).length) {
    bits.push(`preferencias del viaje ${JSON.stringify(p.trip_prefs)}`);
  }
  return `- ${name}${bits.length ? `: ${bits.join('; ')}` : ''}`;
}

export function renderConversation(conversation: ToolInput<'plan_trip'>['conversation']): string {
  return conversation.map((m) => `${m.role === 'user' ? 'Organizador' : 'Compañero'}: ${m.text}`).join('\n');
}

/** Mensaje de usuario del esqueleto: hoy, fechas elegidas, perfiles y la conversación. Todo lo variable va acá. */
export function renderSkeletonRequest(args: {
  input: ToolInput<'plan_trip'>;
  today: string;
  organizerId: string;
  profiles: PlannerProfile[];
  /** PRD 31 v2: anclas que dijo el usuario en la entrevista. */
  anchors?: TripAnchor[];
}): string {
  const { input, today } = args;
  const origin = input.understanding?.origin;
  const lines = [
    `Hoy es ${weekdayLong(today)} ${today}. Próximo sábado: ${nextSaturday(today)}.`,
    input.start_date || input.end_date
      ? `Fechas elegidas en el selector: desde ${input.start_date ?? '?'} hasta ${input.end_date ?? '?'}.`
      : 'No eligió fechas en el selector.',
    input.title ? `Título que eligió: ${input.title}` : '',
    args.profiles.length ? `Perfiles de quienes ya están en el viaje:\n${args.profiles.map((p) => profileLine(p, args.organizerId)).join('\n')}` : '',
    origin ? `Salen desde: ${origin}.` : '',
    args.anchors?.length ? `Anclas del viaje (mandan sobre todo; no cambies sus fechas):\n${anchorLines(args.anchors)}` : '',
    `Conversación:\n${renderConversation(input.conversation)}`,
    'Armá el esqueleto.',
  ];
  return lines.filter(Boolean).join('\n\n');
}

export type LegPromptArgs = {
  trip_id: string;
  leg: { id: string; city: string; country: string | null; start_date: string; end_date: string; lat: number | null; lng: number | null };
  days: { id: string; date: string }[];
  conversation: ToolInput<'plan_trip'>['conversation'];
  organizerId: string;
  profiles: PlannerProfile[];
  participantNames: string[];
  arrivals: { day_id: string; text: string }[];
  savedPlaces: { name: string; google_place_id: string | null; note: string | null }[];
  webSearch: boolean;
  /** PRD 31 v2: anclas que caen en este tramo (runtime.anchorsForLeg). */
  anchors?: TripAnchor[];
  /** El grupo llega de un vuelo largo a este tramo (primer día liviano). */
  longHaulArrival?: boolean;
  origin?: string | null;
};

const TICKETS: Record<TripAnchor['tickets'], string> = {
  have: 'ya tienen entradas',
  want: 'quieren conseguir entradas',
  watch_out: 'lo ven en una fan zone o bar',
  unknown: 'entradas a confirmar',
};

/** Una línea por ancla para los prompts. */
export function anchorLines(anchors: TripAnchor[], days: { id: string; date: string }[] = []): string {
  return anchors
    .map((a) => {
      const day = a.date ? days.find((d) => d.date === a.date) : undefined;
      const when = a.date ? `${a.date}${a.time ? ` ${a.time}` : ' (hora a confirmar)'}${day ? ` → day_id ${day.id}` : ''}` : 'sin fecha confirmada → banco de ideas (day_id null)';
      const where = [a.venue, a.city].filter(Boolean).join(', ');
      const src = a.sources?.length ? ` · fuentes: ${a.sources.slice(0, 2).map((x) => x.url).join(' ')}` : '';
      return `- ${a.name} (${a.kind}) · ${when}${where ? ` · ${where}` : ''} · ${TICKETS[a.tickets] ?? a.tickets}${a.note ? ` · ${a.note}` : ''}${src}`;
    })
    .join('\n');
}

/** Contexto variable del tramo (segundo bloque de system, después del cacheado). */
export function legContext(a: LegPromptArgs): string {
  const days = a.days.map((d) => `- ${fmtDay(d.date)} (${weekdayLong(d.date)} ${d.date}): day_id ${d.id}`).join('\n');
  const parts = [
    `Tramo: ${a.leg.city}${a.leg.country ? `, ${a.leg.country}` : ''} del ${a.leg.start_date} al ${a.leg.end_date}.`,
    `trip_id: ${a.trip_id}\nleg_id: ${a.leg.id}` + (a.leg.lat != null && a.leg.lng != null ? `\nCentro de la ciudad: lat ${a.leg.lat}, lng ${a.leg.lng} (usalo como near en search_places)` : ''),
    `Días:\n${days}`,
    a.arrivals.length ? `Traslados ya agendados:\n${a.arrivals.map((x) => `- ${x.text}`).join('\n')}` : '',
    a.anchors?.length
      ? `Anclas de este tramo (agendalas tal cual, no inventes otras fechas):\n${anchorLines(a.anchors, a.days)}`
      : '',
    a.longHaulArrival
      ? `Llegan de un vuelo largo${a.origin ? ` desde ${a.origin}` : ''}: el primer día (${a.days[0]?.date ?? a.leg.start_date}) es liviano (algo cerca del alojamiento + cena temprano) con una nota sobre el jet lag.`
      : '',
    a.profiles.length ? `Viajeros de este tramo:\n${a.profiles.map((p) => profileLine(p, a.organizerId)).join('\n')}` : '',
    a.participantNames.length ? `También van (todavía no están en la app): ${a.participantNames.join(', ')}.` : '',
    a.savedPlaces.length
      ? `Lugares guardados por el organizador en esta zona (priorizalos):\n${a.savedPlaces.map((s) => `- ${s.name}${s.note ? ` (${s.note})` : ''}`).join('\n')}`
      : '',
    a.webSearch ? 'Tenés web_search: máximo 4 búsquedas en este tramo.' : 'No tenés web search en este trabajo.',
    `Lo que contó el organizador:\n${renderConversation(a.conversation)}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function legUserMessage(leg: { city: string; start_date: string; end_date: string }): string {
  return `Armá los días ${leg.start_date} a ${leg.end_date} en ${leg.city}.`;
}
