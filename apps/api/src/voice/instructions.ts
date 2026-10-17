// Instrucciones del scout para OpenAI Realtime (PRD 05). Función pura: el contexto lo carga context.ts.
// Nombre y personalidad salen de SCOUT (packages/shared/src/scout.ts): un solo personaje para todos.
import { SCOUT, voiceLangLine } from '@build101/shared';

export type InstructionsInput = {
  mode: 'chat' | 'tour';
  lang: string;
  /** "sábado 17/10, 15:42" en la zona del viaje. */
  nowText: string;
  user: { name: string | null; interests: string[]; avoid: string[]; dietary: string[]; pace: string | null };
  trip: { summary: string; upcoming: string[]; companions: string[] } | null;
  memories: string[];
  /** Dónde está el celu (para herramientas con `near`). */
  location: { lat: number; lng: number } | null;
  /** Apertura con contexto ("Hablar de esto"): texto ya resuelto del bloque o lugar. */
  focus: string | null;
  /** Reglas extra por modo (PRD 07 agrega las del tour). */
  extraRules?: string[];
};

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

/** Todo menos la línea de idioma (ver voiceLangLine). */
export function buildInstructionsBase(i: InstructionsInput): string {
  const lines: string[] = [
    `Sos ${SCOUT.name}. ${SCOUT.persona}`,
    `Sos el mismo personaje en todo: planificás, guiás y respondés. No hay otros guías.`,
    'Respuestas cortas (1-2 frases) salvo que te pidan más. Te pueden interrumpir: si pasa, cortá y respondé a lo nuevo, natural.',
    'Nunca inventes fechas, nombres, horarios ni cifras: usá herramientas o decí que no sabés.',
    'Para cualquier cosa del plan usá herramientas. En lo compartido tus cambios quedan como propuesta: decilo así ("te lo dejo propuesto al grupo"). En lo personal se aplican.',
    'Antes de una herramienta lenta, avisá en 3-4 palabras ("Dale, lo busco").',
    `Hoy es ${i.nowText}.`,
  ];
  if (i.trip) {
    lines.push(`Viaje: ${i.trip.summary}`);
    lines.push(i.trip.upcoming.length ? `Hoy sigue:\n${bullets(i.trip.upcoming)}` : 'Hoy no hay nada más en el plan.');
    if (i.trip.companions.length) lines.push(`Con la persona en este tramo: ${i.trip.companions.join(', ')}.`);
  } else {
    lines.push('No hay un viaje abierto: ayudá con lo que pida donde esté.');
  }
  if (i.location) lines.push(`Ubicación actual del celu: ${i.location.lat.toFixed(5)}, ${i.location.lng.toFixed(5)} (usala como "near" en las búsquedas).`);

  const about: string[] = [];
  if (i.user.name) about.push(`se llama ${i.user.name}`);
  if (i.user.interests.length) about.push(`le interesa ${i.user.interests.join(', ')}`);
  if (i.user.avoid.length) about.push(`evita ${i.user.avoid.join(', ')}`);
  if (i.user.dietary.length) about.push(`dieta: ${i.user.dietary.join(', ')}`);
  if (i.user.pace) about.push(`ritmo ${i.user.pace}`);
  if (about.length) lines.push(`Lo que sabés de la persona: ${about.join('; ')}.`);
  if (i.memories.length) lines.push(`Memoria:\n${bullets(i.memories)}`);

  lines.push(
    'Eventos: te llegan mensajes de sistema "[EVENTO:tipo] json". No los leas en voz alta. proposal_decided: contá en una frase qué se decidió.',
  );
  if (i.extraRules?.length) lines.push(...i.extraRules);
  lines.push(
    i.focus
      ? `Apertura: la persona abrió la llamada desde ${i.focus}. Empezá hablando de eso en una frase.`
      : 'Apertura: saludá en una frase corta y preguntá en qué ayudás.',
  );
  return lines.join('\n');
}

export function buildInstructions(i: InstructionsInput): { base: string; full: string } {
  const base = buildInstructionsBase(i);
  return { base, full: `${base}\n${voiceLangLine(i.lang)}` };
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "sábado 17/10, 15:42" en la zona dada. */
export function nowText(now = new Date(), timeZone = 'America/Montevideo'): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(parts.weekday);
  return `${WEEKDAYS[wd] ?? ''} ${parts.day}/${parts.month}, ${parts.hour}:${parts.minute}`.trim();
}

/** "HH:MM" en la zona dada (para filtrar los bloques que siguen hoy). */
export function nowHHMM(now = new Date(), timeZone = 'America/Montevideo'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}
