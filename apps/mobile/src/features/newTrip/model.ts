// Lógica pura del flujo "Nuevo viaje" (PRD 31): conversación con respuestas, defaults de las preguntas y
// el esqueleto que va a plan_trip desde la forma elegida. Sin React ni red: se testea con tsx (model.test.ts).
import type {
  TripAnchor,
  TripBriefResult,
  TripDimension,
  TripKind,
  ToolInput,
  TripQuestion,
  TripShape,
  TripShapeLeg,
  TripUnderstanding,
} from '@build101/shared';

import { formatDay } from '../../lib/format';

export type Turn = { role: 'user' | 'assistant'; text: string };
/** Respuesta a una TripQuestion: value (single/text/date) o lista de values (multi). */
export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;
export type PlanMode = 'auto' | 'menu';
type Skeleton = NonNullable<ToolInput<'plan_trip'>['skeleton']>;

export const TELL_PROMPT = '¡Buenas! Contame el viaje: a dónde, cuándo, con quién y qué les copa. Con lo que sepas alcanza.';

export const TELL_EXAMPLES = [
  'Montevideo y Buenos Aires, 8 días desde el 24/10, somos 4 amigos, nos copa comer y caminar',
  'Lisboa y Oporto 10 días en noviembre, en pareja, vino, miradores y nada de museos',
  'Ruta por el norte argentino una semana en familia con dos nenes, naturaleza y peñas',
];

/** Frase del deep link de dev ?demo=1. */
export const DEMO_STORY =
  'Montevideo y Colonia del Sacramento, 4 días, somos 3 amigos y nadie se separa. Nos copa comer, la historia y caminar. Sí o sí el Mercado del Puerto, ni loco boliche.';

const MAX_TEXT = 2000;
const MAX_TURNS = 40;

/** Conversación base: el saludo, lo que contó la persona y la fecha si la eligió. */
export function baseConversation(story: string, startDate: string | null): Turn[] {
  const conv: Turn[] = [{ role: 'assistant', text: TELL_PROMPT }];
  const clean = story.trim();
  if (clean) conv.push({ role: 'user', text: clean.slice(0, MAX_TEXT) });
  if (startDate) conv.push({ role: 'user', text: `Fecha de inicio elegida: ${startDate}` });
  return conv;
}

/** Defaults de cada pregunta (lo que se preselecciona y lo que usa "Saltar preguntas"). */
export function defaultAnswers(questions: TripQuestion[]): Answers {
  const out: Answers = {};
  for (const q of questions) {
    if (q.default == null) continue;
    if (q.kind === 'multi') out[q.id] = Array.isArray(q.default) ? q.default : [q.default];
    else out[q.id] = Array.isArray(q.default) ? (q.default[0] ?? '') : q.default;
  }
  return out;
}

/** Selección de un chip: single reemplaza, multi alterna. */
export function toggleAnswer(q: TripQuestion, current: AnswerValue | undefined, value: string): AnswerValue {
  if (q.kind !== 'multi') return value;
  const cur = Array.isArray(current) ? current : current ? [current] : [];
  return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
}

export function isAnswered(v: AnswerValue | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v?.trim();
}

/** Lo que "dice" la persona al contestar: los labels de las opciones (no los values). */
export function answerText(q: TripQuestion, v: AnswerValue | undefined): string | null {
  if (!isAnswered(v)) return null;
  const label = (value: string) => q.options.find((o) => o.value === value)?.label ?? value;
  if (q.kind === 'date') {
    const iso = Array.isArray(v) ? v[0]! : v!;
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${formatDay(iso)} (${iso})` : label(iso);
  }
  if (Array.isArray(v)) return v.map(label).join(', ');
  return q.kind === 'text' ? v!.trim() : label(v!);
}

/**
 * Conversación + cada pregunta (assistant) y su respuesta (user). Las que quedan sin contestar no van.
 * Si un id se repite (otra ronda volvió a preguntar lo mismo), va una sola vez: la primera.
 */
export function conversationWithAnswers(base: Turn[], questions: TripQuestion[], answers: Answers): Turn[] {
  const conv = [...base];
  for (const q of uniqueQuestions(questions)) {
    const text = answerText(q, answers[q.id]);
    if (!text) continue;
    // Marca [q:id/dimensión]: la API reconoce lo ya preguntado sin depender de memoria del servidor (briefPrompts.questionMessage).
    conv.push({ role: 'assistant', text: `[q:${q.id}/${q.dimension}] ${q.text}`.slice(0, MAX_TEXT) });
    conv.push({ role: 'user', text: text.slice(0, MAX_TEXT) });
  }
  return clampConversation(conv);
}

// ───────────────────────── Entrevista en rondas (trip_brief v2)

/** Máximo de rondas de la entrevista (TripBriefInput.round 1-3). */
export const MAX_ROUNDS = 3;

/** Preguntas sin repetir id (gana la primera aparición). */
export function uniqueQuestions(questions: TripQuestion[]): TripQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)));
}

/** Todas las preguntas de las rondas 1..upTo (índice 0-based incluido), en orden y sin duplicar. */
export function roundQuestions(rounds: Pick<TripBriefResult, 'questions'>[], upTo = rounds.length - 1): TripQuestion[] {
  return uniqueQuestions(rounds.slice(0, upTo + 1).flatMap((r) => r.questions));
}

/**
 * Respuestas al llegar una ronda nueva: lo ya contestado en las rondas que quedan (`keep`) no se toca; las
 * preguntas nuevas arrancan con su default. Se descartan respuestas a preguntas que ya no están en ninguna ronda.
 */
export function mergeRoundAnswers(prev: Answers, keep: TripQuestion[], incoming: TripQuestion[]): Answers {
  const ids = new Set([...keep, ...incoming].map((q) => q.id));
  const kept = Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id)));
  return { ...defaultAnswers(incoming), ...kept };
}

/** ¿Después de esta ronda (1-based) va otra o ya pasamos a las formas? */
export function wantsAnotherRound(brief: Pick<TripBriefResult, 'done' | 'questions'>, round: number): boolean {
  return !brief.done && round < MAX_ROUNDS && brief.questions.length > 0;
}

/** Ronda que llegó sin nada para preguntar (o done sin preguntas): se salta directo a las formas. */
export function skipRound(brief: Pick<TripBriefResult, 'done' | 'questions'>): boolean {
  return brief.questions.length === 0;
}

/** Indicador sutil arriba de las preguntas. */
export function roundLabel(round: number, brief: Pick<TripBriefResult, 'done'>): string {
  if (round <= 1) return brief.done ? 'Con esto ya casi lo tengo' : `Ronda 1 de ${MAX_ROUNDS} · lo básico`;
  return brief.done || round >= MAX_ROUNDS ? 'Últimas preguntas para afinar' : `Ronda ${round} de ${MAX_ROUNDS} · unas preguntas más para afinar`;
}

export const TRIP_KIND_LABEL: Record<TripKind, string> = {
  event: 'Viaje a un evento',
  city: 'Viaje de ciudad',
  road_trip: 'Road trip',
  beach: 'Playa',
  nature: 'Naturaleza',
  family: 'En familia',
  couple: 'En pareja',
  backpacking: 'Mochilero',
  mixed: 'Un poco de todo',
};

export const DIMENSION_LABEL: Record<TripDimension, string> = {
  anchor: 'el evento',
  dates: 'fechas',
  duration: 'duración',
  travelers: 'el grupo',
  origin: 'desde dónde salen',
  arrival: 'llegada',
  departure: 'vuelta',
  lodging: 'alojamiento',
  budget: 'presupuesto',
  pace: 'ritmo',
  first_time: 'si ya fueron',
  interests: 'gustos',
  extras: 'extras',
  transport: 'transporte',
  food: 'comida',
  kids: 'chicos',
  mobility: 'movilidad',
  must: 'imperdibles',
  avoid: 'lo que no',
  other: 'otros',
};

/** coverage → "Sé" (known + assumed, con las supuestas marcadas) y "Me falta". Score 0-1 para la barrita. */
export function coverageSummary(coverage: TripBriefResult['coverage']): { known: string[]; assumed: string[]; missing: string[]; score: number } | null {
  if (!coverage) return null;
  const known: string[] = [];
  const assumed: string[] = [];
  const missing: string[] = [];
  for (const [dim, v] of Object.entries(coverage) as [TripDimension, 'known' | 'assumed' | 'unknown' | undefined][]) {
    const label = DIMENSION_LABEL[dim] ?? dim;
    if (v === 'known') known.push(label);
    else if (v === 'assumed') assumed.push(label);
    else if (v === 'unknown') missing.push(label);
  }
  const total = known.length + assumed.length + missing.length;
  if (!total) return null;
  return { known, assumed, missing, score: (known.length + assumed.length * 0.5) / total };
}

export const TICKETS_LABEL: Record<TripAnchor['tickets'], string> = {
  have: 'Ya tienen entradas',
  want: 'Quieren conseguir entradas',
  watch_out: 'Lo ven afuera',
  unknown: 'Entradas: a definir',
};

/** "sáb 9 oct · 16:45" / "a confirmar". */
export function anchorWhen(a: Pick<TripAnchor, 'date' | 'time'>): string {
  if (!a.date) return a.time ? a.time : 'Fecha a confirmar';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? formatDay(a.date) : a.date;
  return a.time ? `${d} · ${a.time}` : d;
}

/** Las herramientas aceptan hasta 40 mensajes de hasta 2000 caracteres: nos quedamos con los últimos. */
export function clampConversation(conv: Turn[]): Turn[] {
  return conv.map((t) => ({ role: t.role, text: t.text.slice(0, MAX_TEXT) })).slice(-MAX_TURNS);
}

/** Fecha de inicio: la elegida al contar o, si no, la que contestó en una pregunta de fecha. */
export function effectiveStartDate(startDate: string | null, questions: TripQuestion[], answers: Answers): string | null {
  if (startDate) return startDate;
  for (const q of questions) {
    if (q.kind !== 'date') continue;
    const v = answers[q.id];
    const iso = Array.isArray(v) ? v[0] : v;
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return null;
}

/** La forma elegida tal como la espera plan_trip (sin id/label/pitch/tradeoffs/recommended). */
export function skeletonFromShape(shape: TripShape): Skeleton {
  return {
    title: shape.title.slice(0, 80),
    start_date: shape.start_date,
    end_date: shape.end_date,
    legs: shape.legs.map((l) => ({
      key: l.key,
      city: l.city,
      country: l.country ?? '',
      start_date: l.start_date,
      end_date: l.end_date,
      includes_organizer: l.includes_organizer,
      participant_names: l.participant_names,
      parallel_with: l.parallel_with,
      why: l.why.slice(0, 400),
    })),
    transfers: shape.transfers.map((t) => ({
      from_key: t.from_key,
      to_key: t.to_key,
      date: t.date,
      mode: t.mode,
      duration_min: t.duration_min,
      participant_names: t.participant_names,
    })),
    assumptions: shape.assumptions.slice(0, 12),
    ...(shape.anchors?.length ? { anchors: shape.anchors.slice(0, 12).map(anchorForSkeleton) } : {}),
  };
}

/** TripAnchor recortado a los límites de TripAnchorInput. */
function anchorForSkeleton(a: TripAnchor): TripAnchor {
  return {
    id: a.id.slice(0, 60),
    name: a.name.slice(0, 200),
    kind: a.kind,
    city: a.city?.slice(0, 120) ?? null,
    country: a.country?.slice(0, 80) ?? null,
    date: a.date ?? null,
    time: a.time ?? null,
    venue: a.venue?.slice(0, 200) ?? null,
    tickets: a.tickets,
    researched: a.researched,
    sources: (a.sources ?? []).slice(0, 6).map((src) => ({ url: src.url.slice(0, 500), title: src.title?.slice(0, 200) ?? null })),
    note: a.note?.slice(0, 400) ?? null,
  };
}

/** Lo entendido tal como va a plan_trip: anclas recortadas a los límites del contrato. */
export function understandingForPlan(u: TripUnderstanding): TripUnderstanding {
  return u.anchors ? { ...u, anchors: u.anchors.slice(0, 12).map(anchorForSkeleton) } : u;
}

export function planTripInput(opts: {
  conversation: Turn[];
  startDate: string | null;
  shape: TripShape | null;
  mode: PlanMode;
  /** Lo que entendió trip_brief en la ÚLTIMA ronda (gustos, anclas, tipo de viaje, origen). */
  understanding?: TripUnderstanding | null;
}): ToolInput<'plan_trip'> {
  return {
    conversation: clampConversation(opts.conversation),
    ...(opts.understanding ? { understanding: understandingForPlan(opts.understanding) } : {}),
    ...(opts.startDate ? { start_date: opts.startDate } : {}),
    ...(opts.shape ? { skeleton: skeletonFromShape(opts.shape), ...(opts.shape.title ? { title: opts.shape.title.slice(0, 80) } : {}) } : {}),
    mode: opts.mode,
  };
}

/** La recomendada (o la primera). */
export function recommendedShape(variants: TripShape[]): TripShape | null {
  return variants.find((v) => v.recommended) ?? variants[0] ?? null;
}

/** Clave estable de un input: si no cambió, se reusa la respuesta anterior al volver atrás y adelante. */
export function inputKey(conversation: Turn[], startDate: string | null): string {
  return JSON.stringify([conversation, startDate]);
}

// ───────────────────────── Formato de la línea de tiempo

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}

export function nights(start: string, end: string): number {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.UTC(...b) - Date.UTC(...a)) / 86_400_000));
}

/** "24–27 oct" o "30 oct – 2 nov". */
export function shortRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return '';
  if (start === end) return `${a[2]} ${MONTHS[a[1]]}`;
  if (a[1] === b[1]) return `${a[2]}–${b[2]} ${MONTHS[a[1]]}`;
  return `${a[2]} ${MONTHS[a[1]]} – ${b[2]} ${MONTHS[b[1]]}`;
}

export function nightsLabel(n: number): string {
  return n === 0 ? 'en el día' : n === 1 ? '1 noche' : `${n} noches`;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

export const MODE_LABEL: Record<TripShape['transfers'][number]['mode'], string> = {
  walk: 'A pie',
  transit: 'Transporte',
  bus: 'Micro',
  ferry: 'Ferry',
  flight: 'Vuelo',
  car: 'Auto',
};

/** Tramos en orden, con el traslado que sale de cada uno (si hay). */
export function timeline(shape: TripShape): { leg: TripShapeLeg; nights: number; transfer: TripShape['transfers'][number] | null }[] {
  const legs = [...shape.legs].sort((a, b) => a.start_date.localeCompare(b.start_date));
  return legs.map((leg) => ({
    leg,
    nights: nights(leg.start_date, leg.end_date),
    transfer: shape.transfers.find((t) => t.from_key === leg.key) ?? null,
  }));
}

/** "+ 1 día en Colonia" → { sign: '+', text: '1 día en Colonia' }. */
export function parseTradeoff(raw: string): { sign: '+' | '−' | null; text: string } {
  const m = /^\s*([+\-−–])\s*(.*)$/.exec(raw);
  if (!m) return { sign: null, text: raw.trim() };
  return { sign: m[1] === '+' ? '+' : '−', text: m[2]!.trim() };
}
