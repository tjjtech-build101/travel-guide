// Prompts y esquemas de la entrevista (trip_brief) y de las formas del viaje (trip_shapes) · PRD 31 v2.
// Lo estático (BRIEF_SYSTEM, SHAPES_SYSTEM, con los ejemplos few-shot) no lleva nada variable: el prefijo se cachea.
// Esquemas de salida estructurada: nada de min/max/regex ni records, y SIN enums (los valores van en la descripción y
// se validan en briefLlm.ts) y SIN nullables ("" / 0 = no se sabe): con enums y anyOf anidados la gramática compilada
// superaba el límite de la API (400 "compiled grammar is too large").
import { INTEREST_TAGS, TRIP_DIMENSIONS, TRIP_KINDS, type TripAnchor, type TripUnderstanding } from '@build101/shared';
import { z } from 'zod';
import { nextSaturday, weekdayLong } from '../dates';
import { SKELETON_SYSTEM } from '../prompts';
import { SkeletonLeg, SkeletonTransfer } from '../schemas';

// ───────────────────────── Esquemas

export const BriefAnchor = z.object({
  id: z.string().describe('Slug corto ("pumas-grupos", "final", "casamiento")'),
  name: z.string().describe('Qué es, con el equipo/fase que dijo: "Partidos de los Pumas en el Mundial de Rugby 2027"'),
  kind: z.string().describe('Uno de: sports | concert | festival | wedding | conference | other'),
  city: z.string(),
  country: z.string(),
  date: z.string().describe('YYYY-MM-DD SOLO si el usuario la dijo; si no, null (se investiga después)'),
  tickets: z.string().describe('Uno de: have | want | watch_out | unknown'),
  note: z.string().describe('Lo que dijo de equipo, fase o entradas ("siguen a los Pumas desde grupos")'),
});

export const BriefUnderstood = z.object({
  destinations: z.array(z.object({ city: z.string().describe('Ciudad en su idioma original'), country: z.string() })),
  start_date: z.string().describe('YYYY-MM-DD solo si el usuario dio la fecha (o se deduce sin dudas)'),
  end_date: z.string(),
  days: z.number().describe('Cantidad de días si la dijo ("una semana" = 7); 0 si no'),
  travelers: z.number().describe('Cantidad de viajeros; 0 si no se sabe'),
  party: z.string().describe('Uno de: solo | couple | friends | family'),
  names: z.array(z.string()).describe('Nombres propios mencionados, sin el organizador'),
  interests: z.array(z.object({ tag: z.string().describe(`Uno de: ${INTEREST_TAGS.join(' | ')}`), weight: z.number().describe('1-5') })),
  must: z.array(z.string()).describe('Lo que dijo que sí o sí (lugares o cosas)'),
  avoid: z.array(z.string()).describe('Lo que dijo que ni loco'),
  budget: z.string().describe('Uno de: low | mid | high | no_limit'),
  pace: z.string().describe('Uno de: relaxed | balanced | intense'),
  first_time: z.string().describe('yes | no | unknown (primera vez en el destino)'),
  kids_ages: z.array(z.string()),
  arrival: z.string().describe('Texto libre de cómo/cuándo llegan, si lo dijo'),
  departure: z.string(),
  lodging_booked: z.string().describe('Dónde se alojan si ya reservaron'),
  notes: z.array(z.string()).describe('Lo demás que importa: transporte elegido, extras, presupuesto en números'),
  trip_kind: z.string().describe(`Uno de: ${TRIP_KINDS.join(' | ')}. event si el viaje gira alrededor de algo con fecha (partido, recital, casamiento)`),
  anchors: z.array(BriefAnchor).describe('El motivo con fecha del viaje, tal como lo dijo el usuario'),
  origin: z.string().describe('Ciudad/país desde donde salen, si lo dijo'),
});

export const BriefQuestion = z.object({
  id: z.string().describe('Slug corto y estable para esta entrevista ("team", "phase", "tickets", "group_size")'),
  dimension: z.string().describe(`Uno de: ${TRIP_DIMENSIONS.join(' | ')}`),
  text: z.string().describe('Pregunta corta en voseo, con las palabras del usuario y el destino'),
  why: z.string().describe('Por qué cambia el plan (una línea)'),
  kind: z.string().describe('Uno de: single | multi | text | date'),
  options: z.array(z.object({ value: z.string(), label: z.string() })).describe('2-6 chips concretos del lugar (vacío solo si kind es text o date)'),
  default_values: z.array(z.string()).describe('value(s) por defecto sensatos; vacío si no hay'),
  optional: z.boolean(),
});

export const BriefCoverage = z.object({
  dimension: z.string().describe(`Uno de: ${TRIP_DIMENSIONS.join(' | ')}`),
  status: z.string().describe('Uno de: known | assumed | unknown'),
});

export const BriefOutput = z.object({
  summary: z.string().describe('1-2 frases en voseo: lo que entendí'),
  understood: BriefUnderstood,
  coverage: z.string().describe('Una entrada por dimensión relevante para ESTE viaje, separadas por coma: "dates=known, budget=unknown, pace=assumed"'),
  questions: z.array(BriefQuestion).describe('0-4 para esta ronda, ordenadas por cuánto cambian el plan'),
  done: z.boolean().describe('true si ya sé lo suficiente para proponer las formas del viaje'),
});
export type BriefOutputT = z.infer<typeof BriefOutput>;

export const ShapeVariant = z.object({
  label: z.string().describe('Nombre corto: "Siguiendo a los Pumas", "Equilibrado", "Con escapada a Colonia", "Lento"'),
  pitch: z.string().describe('Una frase de venta, en voseo'),
  tradeoffs: z.array(z.string()).describe('2-4 pros/contras concretos que empiezan con "+ " o "− "'),
  recommended: z.boolean(),
  title: z.string(),
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
  legs: z.array(SkeletonLeg),
  transfers: z.array(SkeletonTransfer),
  assumptions: z.array(z.string()),
  anchor_ids: z.array(z.string()).describe('ids de las anclas (de la lista que te paso) que esta forma cubre; vacío si no hay'),
});
export const ShapesOutput = z.object({ variants: z.array(ShapeVariant) });
export type ShapesOutputT = z.infer<typeof ShapesOutput>;
export type ShapeVariantT = z.infer<typeof ShapeVariant>;

// ───────────────────────── Prompts

export const BRIEF_SYSTEM = `Sos el planificador de viajes de una app rioplatense, de nivel mundial. Antes de armar un viaje hacés una entrevista CORTA en rondas (máximo 3): leés lo que contó el organizador y las respuestas a preguntas anteriores, y devolvés lo que entendiste, qué sabés de cada dimensión y las pocas preguntas que de verdad cambian el plan.

Lo que entendiste (understood):
- Solo lo que el usuario dijo o se deduce sin dudas. Nunca inventes fechas, nombres ni preferencias. Lo que no sabés va en null o vacío.
- Ciudades en su idioma original, con país si es claro. Si dijo solo un país o región ("Australia", "el norte argentino") y no nombró ciudades, poné el país o la región como destino (city = el país o la región) y armá las preguntas para definirlo.
- Intereses solo de la lista (tag) con peso 1-5 según cuánto insistió.
- trip_kind: event si el viaje gira alrededor de algo con fecha (partido, torneo, recital, festival, casamiento, conferencia); si no, el que mejor lo describa.
- anchors: el motivo con fecha, como lo dijo el usuario, con el equipo, la fase y las entradas en name/note/tickets. date SOLO si el usuario la dijo (aunque la sepas de memoria: se investiga después con fuentes). Si todavía no dijo a quién sigue o qué fase, igual creá el ancla del evento y preguntalo.
- origin: desde dónde salen, si lo dijo. notes: transporte elegido, extras, presupuesto en números y todo lo demás que importa.

coverage: un texto "dimensión=estado" separado por comas, para cada dimensión que importa en ESTE tipo de viaje: known (lo dijo), assumed (lo supusiste con confianza) o unknown (falta). Ej: "anchor=known, dates=assumed, budget=unknown".

Preguntas (máximo 4 por ronda, mejor menos):
- Generadas para ESTE viaje: usá las palabras del usuario y el destino, con opciones concretas del lugar (nombres reales de equipos, fases, regiones, excursiones), nunca genéricas tipo "Cultura / Naturaleza / Gastronomía".
- Prioridad: 1) el ancla si hay evento (a quién siguen, qué fase o partidos, si ya tienen entradas), 2) grupo, fechas/duración, desde dónde salen, presupuesto, 3) cómo se mueven, extras y gustos.
- NUNCA preguntes algo que ya está known ni repitas una pregunta de una ronda anterior (te paso la lista de lo ya preguntado con id y dimensión). Si alguien contestó "no sé" o dejó el default, tomalo como assumed y seguí.
- Si los perfiles del grupo son flojos (pocos intereses o pesos bajos) o no hay perfiles, preguntá los gustos explícitamente (multi, con opciones del destino) en vez de suponer.
- id: slug corto y estable ("team", "phase", "tickets", "group_size", "budget_pp", "transport", "extras"). dimension: la que completa.
- kind "single" para elegir una, "multi" para varias (gustos, extras), "date" para fechas, "text" solo si no hay opciones posibles. 2-6 opciones con label corto en voseo y un default sensato en default_values.
- why: una línea de por qué cambia el plan.
- Si no hay ningún destino, la primera pregunta es a dónde quieren ir (dimension "other").

done: true cuando las dimensiones críticas para ESTE viaje están known o assumed con confianza (para un evento: el ancla con equipo/fase, fechas o duración, grupo y origen; para una escapada de finde alcanza con destino y fechas). En la ronda 1 casi nunca es true, salvo que haya contado mucho detalle. En la ronda 3 siempre es true (lo que quede, assumed). Si done es true, las preguntas que devuelvas son las últimas (opcionales o de ajuste fino).

summary: 1-2 frases en voseo, cálidas y concretas.

Ejemplos (para entender el patrón; no copies textos ni opciones, adaptalos a cada viaje):

1) Evento deportivo. "Me quiero ir a Australia con amigos a ver el mundial de rugby de 2027". Ronda 1: trip_kind event; anchors [{id "mundial-rugby-2027", name "Mundial de Rugby 2027", kind sports, country "Australia", date null, tickets unknown}]; destinations [{city "Australia", country "Australia"}]; party friends. Preguntas: "¿A quién siguen en el Mundial?" (team, anchor: Los Pumas / Los Teros / Los Pumas y Los Teros / Neutrales, el mejor rugby) · "¿Qué parte del Mundial quieren ver?" (phase, anchor: Fase de grupos siguiendo al equipo / De cuartos a la final / Solo la final / Todo) · "¿Ya tienen entradas?" (tickets, anchor: Sí, para algunos partidos / Todavía no, queremos conseguir / Lo vemos en fan zones y pubs) · "¿Cuántos son?" (group_size, travelers: 2-3 / 4-6 / 7 o más). done false. Ronda 2 (siguen a los Pumas desde grupos, 5 amigos): "¿Desde dónde salen?" (origin: Buenos Aires / Montevideo / Córdoba / Rosario) · "Presupuesto por persona, sin vuelos" (budget_pp, budget: Mochilero, hostels / Medio, hoteles 3★ / Cómodo, sin mirar mucho) · "¿Cómo se quieren mover entre sedes?" (transport: Vuelos internos / Road trip en auto / Campervan) · "Además del rugby, ¿qué les copa?" (extras, multi: Gran Barrera de Coral / Great Ocean Road / Uluru / Gold Coast y surf / Vinos en el Barossa / Pubs y vida nocturna). Ronda 3 o done.

2) Luna de miel. "Luna de miel en Italia en mayo, 15 días". Ronda 1: party couple, trip_kind couple. Preguntas: "¿Qué onda buscan: más ciudad y arte, más costa, o mitad y mitad?" (interests: Roma, Florencia y Venecia / Costa Amalfitana y Capri / Toscana con viñedos / Un poco de todo) · "¿Ya tienen la fecha exacta de salida?" (dates) · "¿Para algún día especial quieren algo top (cena con vista, hotel boutique)?" (budget). Nada de preguntar por chicos.

3) Familia con chicos. "Disney y Miami con los chicos en julio". Ronda 1: party family. Preguntas: "¿Qué edades tienen los chicos?" (kids, text) · "¿Cuántos días de parques?" (extras: 2 / 4 / 6 con Universal) · "¿Alquilan auto o se mueven en Uber?" (transport). No preguntes ritmo si con chicos chicos es obvio (assumed relaxed).

4) Road trip. "Ruta 40 en el norte, 10 días". Ronda 1: trip_kind road_trip. Preguntas: "¿Arrancan en Salta o en Jujuy?" (arrival: Salta / Jujuy / Tucumán) · "¿Auto propio o alquilado, 4x4?" (transport) · "¿Cuántas horas de manejo por día bancan?" (pace: Hasta 3 h / 3-5 h / Lo que haga falta) · "¿Qué no se pierden?" (extras, multi: Quebrada de Humahuaca / Salinas Grandes / Cafayate y bodegas / Cachi / Hornocal).

5) Escapada de finde. "Finde largo en Colonia con mi novia, salimos el viernes". Ronda 1: destino, pareja y fechas known. Una o dos preguntas como mucho ("¿Ya tienen el ferry?" (arrival), "¿Más relax o recorrer?" (pace)) y done true.`;

export const SHAPES_SYSTEM = `${SKELETON_SYSTEM}

Ahora no armás UN esqueleto sino 2-3 FORMAS distintas del viaje para que el grupo elija.
- Distintas de verdad: cambian el reparto de días entre destinos, suman o sacan una escapada de un día, o bajan el ritmo (menos ciudades, más días por ciudad). Nunca dos variantes con los mismos tramos y fechas.
- Ejemplos de labels: "Equilibrado", "Más {la ciudad que más rinde para este grupo}", "Con escapada a {lugar cercano}", "Lento".
- Todas respetan lo que dijo el usuario (fechas, destinos obligatorios, quiénes van, presupuesto, transporte elegido) y las reglas de arriba.
- pitch: una frase en voseo. tradeoffs: 2-4 bullets concretos que empiezan con "+ " o "− " ("+ 1 día más en Colonia", "− menos tiempo en Palermo").
- Exactamente UNA con recommended=true: la que mejor encaja con el grupo.
- anchor_ids vacío si no te paso anclas.

Si te paso ANCLAS (eventos con fecha y sede):
- Las anclas mandan: cada forma se arma ALREDEDOR de ellas. El día de cada ancla el grupo está en la ciudad de la sede (mejor llegar el día anterior). Las fechas del viaje salen de las anclas, no del "próximo sábado".
- Los días entre anclas se usan para los extras que le copan al grupo (costa, naturaleza, escapadas) cerca de la ruta entre sedes.
- Las formas se diferencian en qué anclas cubren y qué extras suman (ej. "Siguiendo a los Pumas" = todos sus partidos; "Grupos + costa" = 2 partidos y una semana de playa; "Solo la final" = viaje corto). anchor_ids: los ids de las anclas que esa forma cubre.
- tradeoffs mencionan las anclas: "+ ves los 3 partidos de los Pumas", "− te perdés la semifinal".
- Si un ancla está NO verificada o con fecha a confirmar, no inventes su fecha: armá alrededor de lo que sí está confirmado y decilo en assumptions.
- Llegada internacional (salen de otro país o continente): el primer día va liviano por el viaje largo y el jet lag; decilo en assumptions.
- Distancias grandes (ej. Australia): usá el transporte que eligieron (vuelos internos, auto, campervan) con duraciones realistas.`;

export type BriefProfileLine = { name: string; organizer: boolean; bits: string[] };

/** Pregunta ya hecha en una ronda anterior (reconocida en la conversación). */
export type AskedQuestion = { id: string | null; dimension: string | null; text: string; answer: string | null };

function anchorLine(a: TripAnchor): string {
  const where = [a.venue, a.city, a.country].filter(Boolean).join(', ');
  const when = a.date ? `${a.date}${a.time ? ` ${a.time}` : ''}` : 'fecha a confirmar';
  const src = a.sources.length ? ` · fuente: ${a.sources.map((s) => s.url).join(' ')}` : '';
  return `- [${a.id}] ${a.name} · ${when}${where ? ` · ${where}` : ''} · entradas: ${a.tickets}${a.researched ? ' · verificada' : ' · NO verificada'}${a.note ? ` · ${a.note}` : ''}${src}`;
}

function understandingLine(u: TripUnderstanding): string {
  return [
    u.trip_kind ? `tipo: ${u.trip_kind}` : '',
    u.origin ? `salen desde: ${u.origin}` : '',
    u.travelers ? `viajan ${u.travelers}` : '',
    u.party ? `grupo: ${u.party}` : '',
    u.budget ? `presupuesto: ${u.budget}` : '',
    u.pace ? `ritmo: ${u.pace}` : '',
    u.days ? `días: ${u.days}` : '',
    u.start_date || u.end_date ? `fechas: ${u.start_date ?? '?'} a ${u.end_date ?? '?'}` : '',
    u.must.length ? `sí o sí: ${u.must.join('; ')}` : '',
    u.avoid.length ? `ni loco: ${u.avoid.join('; ')}` : '',
    u.notes.length ? `notas: ${u.notes.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function renderBriefUser(args: {
  today: string;
  start_date?: string;
  end_date?: string;
  profiles: BriefProfileLine[];
  existingLegs: { city: string; start_date: string; end_date: string }[];
  conversation: { role: 'user' | 'assistant'; text: string }[];
  ask: 'brief' | 'shapes' | 'understand';
  round?: number;
  /** Preguntas de rondas anteriores (para no repetir). */
  asked?: AskedQuestion[];
  /** Solo shapes: lo entendido y las anclas investigadas. */
  understanding?: TripUnderstanding | null;
  anchors?: TripAnchor[];
  anchorNotes?: string[];
}): string {
  const round = args.round ?? 1;
  const asked = args.asked ?? [];
  const shapes = args.ask === 'shapes';
  const lines = [
    `Hoy es ${weekdayLong(args.today)} ${args.today}. Próximo sábado: ${nextSaturday(args.today)}.`,
    args.start_date || args.end_date
      ? `Fechas elegidas en el selector: desde ${args.start_date ?? '?'} hasta ${args.end_date ?? '?'}.`
      : 'No eligió fechas en el selector.',
    args.profiles.length
      ? `Perfiles de quienes ya están en el viaje:\n${args.profiles
          .map((p) => `- ${p.name}${p.organizer ? ' (organizador)' : ''}${p.bits.length ? `: ${p.bits.join('; ')}` : ' (perfil vacío)'}`)
          .join('\n')}`
      : 'No hay perfiles cargados del grupo.',
    args.existingLegs.length
      ? `El viaje ya tiene tramos: ${args.existingLegs.map((l) => `${l.city} (${l.start_date} a ${l.end_date})`).join(', ')}.`
      : '',
    `Conversación:\n${renderBriefConversation(args.conversation)}`,
    args.ask === 'brief' && asked.length
      ? `Ya preguntado en rondas anteriores (NO repetir ni preguntar lo mismo con otras palabras):\n${asked
          .map((q) => `- ${q.id ? `[${q.id}${q.dimension ? ` · ${q.dimension}` : ''}] ` : ''}${q.text}${q.answer ? ` → ${q.answer}` : ' → (sin respuesta)'}`)
          .join('\n')}`
      : '',
    shapes && args.understanding ? `Lo que entendí: ${understandingLine(args.understanding)}` : '',
    shapes && args.anchors?.length ? `ANCLAS del viaje:\n${args.anchors.map(anchorLine).join('\n')}` : '',
    shapes && args.anchorNotes?.length ? `Avisos de la investigación:\n${args.anchorNotes.map((n) => `- ${n}`).join('\n')}` : '',
    args.ask === 'brief'
      ? `Ronda ${round} de 3.${round >= 3 ? ' Es la última: done=true y como mucho preguntas opcionales de ajuste fino.' : ''} Devolvé lo que entendiste, coverage, las preguntas de esta ronda y done.`
      : args.ask === 'understand'
        ? 'Devolvé solo lo que entendiste y coverage (questions vacío, done true).'
        : 'Proponé las formas del viaje.',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** Conversación con las preguntas marcadas: "Planificador [id · dimensión]: …" / "Organizador: …". */
export function renderBriefConversation(conversation: { role: 'user' | 'assistant'; text: string }[]): string {
  return conversation
    .map((m) => {
      if (m.role === 'user') return `Organizador: ${m.text}`;
      const tag = parseQuestionTag(m.text);
      return tag ? `Planificador [${tag.id}${tag.dimension ? ` · ${tag.dimension}` : ''}]: ${tag.text}` : `Planificador: ${m.text}`;
    })
    .join('\n');
}

// ───────────────────────── Formato de las preguntas en la conversación

/**
 * Formato estable de una pregunta ya hecha (mensaje `assistant`): `[q:<id>/<dimension>] <texto de la pregunta>`.
 * Ej.: `[q:team/anchor] ¿A quién siguen en el Mundial?`. El `/dimension` es opcional. La respuesta va en el
 * mensaje `user` siguiente (labels de las opciones, separados por coma si es multi).
 * Sin la marca (formato v1 de mobile: solo el texto) también se reconoce, por el registro en memoria de preguntas
 * emitidas o por texto (ver parseAskedQuestions en briefLlm.ts).
 */
export const QUESTION_TAG_RE = /^\s*\[q:([a-z0-9_-]{1,40})(?:\/([a-z_]{2,20}))?\]\s*/i;

export function parseQuestionTag(text: string): { id: string; dimension: string | null; text: string } | null {
  const m = QUESTION_TAG_RE.exec(text);
  if (!m) return null;
  const dim = m[2]?.toLowerCase() ?? null;
  return {
    id: m[1]!.toLowerCase(),
    dimension: dim && (TRIP_DIMENSIONS as readonly string[]).includes(dim) ? dim : null,
    text: text.slice(m[0].length).trim(),
  };
}

/** El mensaje assistant que representa una pregunta en la conversación (lo que debería mandar mobile). */
export function questionMessage(q: { id: string; dimension: string; text: string }): string {
  return `[q:${q.id}/${q.dimension}] ${q.text}`;
}
