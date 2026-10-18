// Prompts y esquemas de la entrevista (trip_brief) y de las formas del viaje (trip_shapes) · PRD 31.
// Lo estático (BRIEF_SYSTEM, SHAPES_SYSTEM) no lleva nada variable: el prefijo se cachea.
// Esquemas de salida estructurada: nada de min/max/regex ni records (se validan/convierten en briefLlm.ts).
import { INTEREST_TAGS, TRIP_QUESTION_IDS } from '@build101/shared';
import { z } from 'zod';
import { nextSaturday, weekdayLong } from '../dates';
import { renderConversation, SKELETON_SYSTEM } from '../prompts';
import { SkeletonLeg, SkeletonTransfer } from '../schemas';

// ───────────────────────── Esquemas

export const BriefUnderstood = z.object({
  destinations: z.array(z.object({ city: z.string().describe('Ciudad en su idioma original'), country: z.string().nullable() })),
  start_date: z.string().nullable().describe('YYYY-MM-DD solo si el usuario dio la fecha (o se deduce sin dudas)'),
  end_date: z.string().nullable(),
  days: z.number().nullable().describe('Cantidad de días si la dijo ("una semana" = 7)'),
  travelers: z.number().nullable(),
  party: z.enum(['solo', 'couple', 'friends', 'family']).nullable(),
  names: z.array(z.string()).describe('Nombres propios mencionados, sin el organizador'),
  interests: z.array(z.object({ tag: z.enum(INTEREST_TAGS), weight: z.number().describe('1-5') })),
  must: z.array(z.string()).describe('Lo que dijo que sí o sí (lugares o cosas)'),
  avoid: z.array(z.string()).describe('Lo que dijo que ni loco'),
  budget: z.enum(['low', 'mid', 'high', 'no_limit']).nullable(),
  pace: z.enum(['relaxed', 'balanced', 'intense']).nullable(),
  first_time: z.boolean().nullable(),
  kids_ages: z.array(z.string()),
  arrival: z.string().nullable().describe('Texto libre de cómo/cuándo llegan, si lo dijo'),
  departure: z.string().nullable(),
  lodging_booked: z.string().nullable().describe('Dónde se alojan si ya reservaron'),
  notes: z.array(z.string()),
});

export const BriefQuestion = z.object({
  id: z.enum(TRIP_QUESTION_IDS),
  text: z.string().describe('Pregunta corta en voseo'),
  why: z.string().describe('Por qué cambia el plan (una línea)'),
  kind: z.enum(['single', 'multi', 'text', 'date']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).describe('2-5 chips concretos (vacío solo si kind es text o date)'),
  default_values: z.array(z.string()).describe('value(s) por defecto sensatos; vacío si no hay'),
  optional: z.boolean(),
});

export const BriefOutput = z.object({
  summary: z.string().describe('1-2 frases en voseo: lo que entendí'),
  understood: BriefUnderstood,
  questions: z.array(BriefQuestion).describe('0-4, ordenadas por cuánto cambian el plan'),
});
export type BriefOutputT = z.infer<typeof BriefOutput>;

export const ShapeVariant = z.object({
  label: z.string().describe('Nombre corto: "Equilibrado", "Más Buenos Aires", "Con escapada a Colonia", "Lento"'),
  pitch: z.string().describe('Una frase de venta, en voseo'),
  tradeoffs: z.array(z.string()).describe('2-4 pros/contras concretos que empiezan con "+ " o "− "'),
  recommended: z.boolean(),
  title: z.string(),
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
  legs: z.array(SkeletonLeg),
  transfers: z.array(SkeletonTransfer),
  assumptions: z.array(z.string()),
});
export const ShapesOutput = z.object({ variants: z.array(ShapeVariant) });
export type ShapesOutputT = z.infer<typeof ShapesOutput>;
export type ShapeVariantT = z.infer<typeof ShapeVariant>;

// ───────────────────────── Prompts

export const BRIEF_SYSTEM = `Sos el planificador de viajes de una app rioplatense. Antes de armar un viaje hacés una entrevista CORTA: leés lo que contó el organizador (y las respuestas a preguntas anteriores, si las hay) y devolvés lo que entendiste + las pocas preguntas que de verdad cambian el plan.

Lo que entendiste (understood):
- Solo lo que el usuario dijo o se deduce sin dudas. Nunca inventes fechas, nombres ni preferencias. Lo que no sabés va en null o vacío.
- Ciudades en su idioma original, con país si es claro.
- Intereses solo de la lista (tag) con peso 1-5 según cuánto insistió.

Preguntas (máximo 4, mejor menos; 0 si ya está todo):
- Solo lo que FALTA y CAMBIA el plan. Candidatas, en este orden de importancia: fechas o duración (si no hay), cómo llegan y se van (hora/aeropuerto/terminal), si ya tienen alojamiento, presupuesto, ritmo, si es la primera vez, si van chicos (edades), si alguien se separa del grupo.
- NUNCA preguntes algo que ya dijo (si dijo "4 días", no preguntes duración; si dijo "con mis hijos de 5 y 8", no preguntes por chicos).
- Cada pregunta con opciones concretas en chips (2-5, label corto en voseo) y un default sensato en default_values. kind "single" para elegir una, "multi" para varias, "date" para fechas, "text" solo si no hay opciones posibles.
- why: una línea de por qué importa ("Para no agendar nada antes de que lleguen").
- Si no hay ningún destino, la primera pregunta es a dónde quieren ir (id "other").

summary: 1-2 frases en voseo, cálidas y concretas ("Entendí: 5 días entre Montevideo y Buenos Aires con Sofi, con mucha comida y nada de boliches").`;

export const SHAPES_SYSTEM = `${SKELETON_SYSTEM}

Ahora no armás UN esqueleto sino 2-3 FORMAS distintas del viaje para que el grupo elija.
- Distintas de verdad: cambian el reparto de días entre destinos, suman o sacan una escapada de un día, o bajan el ritmo (menos ciudades, más días por ciudad). Nunca dos variantes con los mismos tramos y fechas.
- Ejemplos de labels: "Equilibrado", "Más {la ciudad que más rinde para este grupo}", "Con escapada a {lugar cercano}", "Lento".
- Todas respetan lo que dijo el usuario (fechas, destinos obligatorios, quiénes van) y las reglas de arriba.
- pitch: una frase en voseo. tradeoffs: 2-4 bullets concretos que empiezan con "+ " o "− " ("+ 1 día más en Colonia", "− menos tiempo en Palermo").
- Exactamente UNA con recommended=true: la que mejor encaja con el grupo.`;

export type BriefProfileLine = { name: string; organizer: boolean; bits: string[] };

export function renderBriefUser(args: {
  today: string;
  start_date?: string;
  end_date?: string;
  profiles: BriefProfileLine[];
  existingLegs: { city: string; start_date: string; end_date: string }[];
  conversation: { role: 'user' | 'assistant'; text: string }[];
  ask: 'brief' | 'shapes';
}): string {
  const lines = [
    `Hoy es ${weekdayLong(args.today)} ${args.today}. Próximo sábado: ${nextSaturday(args.today)}.`,
    args.start_date || args.end_date
      ? `Fechas elegidas en el selector: desde ${args.start_date ?? '?'} hasta ${args.end_date ?? '?'}.`
      : 'No eligió fechas en el selector.',
    args.profiles.length
      ? `Perfiles de quienes ya están en el viaje:\n${args.profiles
          .map((p) => `- ${p.name}${p.organizer ? ' (organizador)' : ''}${p.bits.length ? `: ${p.bits.join('; ')}` : ''}`)
          .join('\n')}`
      : '',
    args.existingLegs.length
      ? `El viaje ya tiene tramos: ${args.existingLegs.map((l) => `${l.city} (${l.start_date} a ${l.end_date})`).join(', ')}.`
      : '',
    `Conversación:\n${renderConversation(args.conversation)}`,
    args.ask === 'brief' ? 'Devolvé lo que entendiste y las preguntas.' : 'Proponé las formas del viaje.',
  ];
  return lines.filter(Boolean).join('\n\n');
}
