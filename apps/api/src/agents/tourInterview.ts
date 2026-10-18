// tour_interview (planificador de tours, paso 1 — como trip_brief): entrevista en rondas 1-4.
// Lee lo que contó la persona + preguntas/respuestas anteriores + el brief del grupo (perfiles, viaje, clima, hora) +
// los lugares con historia que hay realmente cerca, y devuelve lo que entendió, "lo que tengo en cuenta" y 0-4
// preguntas con opciones concretas. Ronda 1: lo básico; 2-4: repreguntas que profundizan lo que contestó.
import { distanceMeters, SCOUT, TOUR_DIMENSIONS, TOUR_THEMES, type TourInterviewQuestion, type TourInterviewResult, type TourUnderstanding, type ToolInput } from '@build101/shared';
import { z } from 'zod';
import type { Effort } from './llm';
import { briefContextBullets, groupProfile, type TourBrief } from './tourContext';
import { renderBriefCard } from './tourContext';
import type { Usage } from './schemas';

export const MAX_INTERVIEW_ROUNDS = 4;

const Understood = z.object({
  duration_min: z.number().nullable().describe('Minutos del tour si los dijo o se infieren con seguridad; si no, null'),
  must_include: z.array(z.string()).describe('Lugares concretos que no se quiere perder, con el nombre real de la lista de cercanos si lo identificás'),
  avoid: z.array(z.string()),
  themes: z.array(z.string()).describe(`Solo de: ${TOUR_THEMES.join(', ')}`),
  energy: z.enum(['tranqui', 'normal', 'a_full']).nullable(),
  finish: z.enum(['view', 'food', 'start', 'any']).nullable(),
  food_stop: z.boolean().nullable(),
  kids: z.array(z.enum(['menores_5', '5_a_9', '10_a_13', 'adolescentes'])),
  indoor: z.enum(['outdoor', 'mixed', 'indoor']).nullable(),
  familiarity: z.enum(['first_time', 'returning', 'local']).nullable(),
  include_paid_entries: z.boolean().nullable(),
  storyline: z.boolean().nullable().describe('true si quiere una trama/misterio que hilvane el tour'),
  wishes: z.array(z.string()).describe('Deseos con sus palabras, concretos ("historias de las quintas de veraneo", "casas con jardín")'),
});

const Question = z.object({
  id: z.string().describe('Id corto y estable (ej. "portones", "epoca", "final")'),
  dimension: z.enum(TOUR_DIMENSIONS),
  text: z.string().describe('Pregunta en voseo rioplatense, corta y concreta'),
  why: z.string().describe('Por qué preguntás (una frase chiquita)'),
  kind: z.enum(['single', 'multi', 'text']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).describe('3-6 opciones concretas (lugares reales de la lista cuando aplica); vacío si kind=text'),
  default: z.union([z.string(), z.array(z.string())]).nullable(),
  optional: z.boolean(),
});

export const InterviewOutput = z.object({
  summary: z.string().describe('1-2 frases en voseo: lo que entendí del tour que quiere'),
  understood: Understood,
  context: z.array(z.string()).describe('0-3 bullets extra de contexto que estás teniendo en cuenta (clima, hora, cercanía de algo)'),
  questions: z.array(Question).describe('0-4 preguntas, ordenadas por importancia'),
  done: z.boolean().describe('true si ya sabés lo suficiente para proponer recorridos'),
  coverage: z.object(Object.fromEntries(TOUR_DIMENSIONS.map((d) => [d, z.enum(['known', 'assumed', 'unknown'])])) as Record<(typeof TOUR_DIMENSIONS)[number], z.ZodEnum<{ known: 'known'; assumed: 'assumed'; unknown: 'unknown' }>>),
});
export type InterviewOutputT = z.infer<typeof InterviewOutput>;

export const INTERVIEW_SYSTEM = `Sos ${SCOUT.name}, un guía rioplatense experto, y estás entrevistando a alguien que quiere un tour a pie para HOY. Como el mejor guía del mundo, antes de armar nada querés entender de verdad qué tiene que tener ese tour para esa persona (y su grupo).

Te paso: la ficha del grupo (perfiles, viaje, clima, hora), los lugares con historia que hay cerca (reales, con distancia), la conversación hasta ahora (lo que contó + preguntas y respuestas anteriores) y el número de ronda (máx. 4).

Cómo entrevistás:
- Nunca preguntes lo que ya sabés (por la ficha o por la conversación). Leé todo antes de preguntar.
- Ronda 1: lo básico que falte, en este orden de importancia: qué espera del tour (qué lo entusiasma, qué quiere sentir/aprender/ver), si hay algún lugar que no se quiere perder, cuánto tiempo tiene, con quién va, cómo quiere terminar. 2-4 preguntas.
- Rondas 2-4: REPREGUNTAS que profundizan lo que contestó, como un guía curioso. Ejemplos: dijo "historia" → ¿de qué época o qué tipo de historias (personajes, crímenes, arquitectura, inmigración)?; nombró un lugar ambiguo ("los portones") → desambiguá con opciones concretas ("¿Portones Shopping?", "¿la entrada histórica de Carrasco?"); dijo "algo lindo" → ¿vistas, casas, naturaleza, arte?; dijo que va con chicos → ¿qué edades y qué les copa? 1-3 preguntas.
- Opciones CONCRETAS (3-6) siempre que se pueda, y cuando hablás de lugares usá los de la lista de cercanos (el nombre real). Siempre hay "Otra cosa…" en la app: no lo agregues vos. kind=text solo para preguntas realmente abiertas.
- Preguntas cortas, en voseo, cálidas, sin tecnicismos. "why" explica en una frase chiquita para qué te sirve.
- done=true cuando ya sabés lo suficiente para proponer recorridos que le encanten: qué espera, cuánto tiempo, lugares pedidos resueltos (sin ambigüedad) y cómo terminar. En la ronda 4, siempre done=true y sin preguntas.
- understood: todo lo que sabés hasta ahora (lo dicho en la conversación manda sobre el perfil). must_include con el nombre real del lugar de la lista si lo identificás; si no está, tal cual lo dijo. wishes con sus palabras, concretas. No inventes nada que no dijo: si no lo sabés, null o vacío.
- coverage: known = lo dijo · assumed = lo suponés por el perfil/contexto · unknown = falta.`;

export function renderInterviewUser(a: {
  audience: string;
  nearby: string[];
  conversation: { role: 'user' | 'assistant'; text: string }[];
  round: number;
  durationMin: number | undefined;
}): string {
  const conv = a.conversation.map((t) => `${t.role === 'user' ? 'PERSONA' : SCOUT.name.toUpperCase()}: ${t.text}`).join('\n');
  return [
    `RONDA ${a.round} de ${MAX_INTERVIEW_ROUNDS}`,
    `FICHA DEL GRUPO\n${a.audience}`,
    a.durationMin ? `Duración elegida en la app: ${a.durationMin} min.` : '',
    `LUGARES CON HISTORIA CERCA\n${a.nearby.length ? a.nearby.map((n) => `- ${n}`).join('\n') : '(no encontré lugares documentados cerca)'}`,
    `CONVERSACIÓN\n${conv}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const THEMES = new Set<string>(TOUR_THEMES);

/** Lo que devolvió el LLM → TourUnderstanding saneado. */
export function sanitizeUnderstanding(u: Partial<InterviewOutputT['understood']> | null | undefined, durationFallback?: number): TourUnderstanding {
  const strs = (x: unknown, max = 10) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()).slice(0, max) : []);
  const oneOf = <T extends string>(v: unknown, vals: readonly T[]): T | null => (typeof v === 'string' && (vals as readonly string[]).includes(v) ? (v as T) : null);
  const dur = typeof u?.duration_min === 'number' && u.duration_min >= 15 ? Math.min(240, Math.round(u.duration_min)) : (durationFallback ?? null);
  return {
    duration_min: dur,
    must_include: strs(u?.must_include, 5),
    avoid: strs(u?.avoid),
    themes: strs(u?.themes).filter((t) => THEMES.has(t)),
    energy: oneOf(u?.energy, ['tranqui', 'normal', 'a_full'] as const),
    finish: oneOf(u?.finish, ['view', 'food', 'start', 'any'] as const),
    food_stop: typeof u?.food_stop === 'boolean' ? u.food_stop : null,
    kids: strs(u?.kids, 4).filter((k): k is TourUnderstanding['kids'][number] => ['menores_5', '5_a_9', '10_a_13', 'adolescentes'].includes(k)),
    indoor: oneOf(u?.indoor, ['outdoor', 'mixed', 'indoor'] as const),
    familiarity: oneOf(u?.familiarity, ['first_time', 'returning', 'local'] as const),
    include_paid_entries: typeof u?.include_paid_entries === 'boolean' ? u.include_paid_entries : null,
    storyline: typeof u?.storyline === 'boolean' ? u.storyline : null,
    wishes: strs(u?.wishes, 8),
  };
}

export function sanitizeQuestions(qs: InterviewOutputT['questions'] | undefined, round: number): TourInterviewQuestion[] {
  if (round >= MAX_INTERVIEW_ROUNDS) return [];
  const seen = new Set<string>();
  return (qs ?? [])
    .filter((q) => q.text?.trim() && !seen.has(q.id) && seen.add(q.id))
    .slice(0, 4)
    .map((q) => ({
      ...q,
      kind: q.kind === 'text' || !q.options?.length ? 'text' : q.kind,
      options: (q.options ?? []).filter((o) => o.value && o.label).slice(0, 6),
      default: q.default ?? null,
    }));
}

export type InterviewDeps = {
  llm: (call: { system: string; user: string; effort: Effort }) => Promise<{ value: InterviewOutputT; usage: Usage }>;
  /** Lugares con historia cerca: nombres ya formateados ("Iglesia de Carrasco (a 400 m)"). */
  nearby: (lat: number, lng: number) => Promise<string[]>;
};

/** Lugares con historia cerca, para la entrevista (Wikipedia geosearch + biblioteca), ordenados por distancia. */
export function formatNearby(start: { lat: number; lng: number }, places: { name: string; lat: number; lng: number }[], max = 18): string[] {
  const seen = new Set<string>();
  return places
    .map((p) => ({ ...p, d: distanceMeters(start, p) }))
    .sort((a, b) => a.d - b.d)
    .filter((p) => {
      const k = p.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max)
    .map((p) => `${p.name} (a ${p.d < 1000 ? `${Math.round(p.d / 50) * 50} m` : `${(p.d / 1000).toFixed(1).replace('.', ',')} km`})`);
}

export async function runTourInterview(input: ToolInput<'tour_interview'>, brief: TourBrief, deps: InterviewDeps): Promise<TourInterviewResult> {
  const round = Math.min(MAX_INTERVIEW_ROUNDS, input.round ?? 1);
  const group = groupProfile(brief);
  const audience = renderBriefCard(brief, group);
  const nearby = await deps.nearby(input.start_lat, input.start_lng).catch(() => []);
  const { value } = await deps.llm({
    system: INTERVIEW_SYSTEM,
    user: renderInterviewUser({ audience, nearby, conversation: input.conversation, round, durationMin: input.duration_min }),
    effort: round === 1 ? 'low' : 'medium',
  });
  const questions = sanitizeQuestions(value.questions, round);
  return {
    summary: value.summary,
    understood: sanitizeUnderstanding(value.understood, input.duration_min),
    context: [...briefContextBullets(brief, group), ...(value.context ?? []).slice(0, 3)],
    nearby: nearby.map((n) => n.replace(/ \(a .*\)$/, '')),
    questions,
    done: round >= MAX_INTERVIEW_ROUNDS || value.done || !questions.length,
    round,
    coverage: value.coverage,
  };
}
