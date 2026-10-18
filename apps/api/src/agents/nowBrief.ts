// Frase de Scout para Ahora (now_brief). Claude chico (BRIEF_MODEL), sin thinking, 4 s de timeout, caché 10 min.
// Cualquier problema (sin key, sin saldo, timeout, frase rara) → nowBriefRules. Nunca tira.
import { createHash } from 'node:crypto';
import { clampBrief, NOW_BRIEF_MAX, nowBriefRules, SCOUT, type NowBriefOutput, type NowBriefSnapshotT } from '@build101/shared';
import { anthropicClient, textOf, type AnyBlock } from './llm';

export const BRIEF_DEFAULT_MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 4000;
const CACHE_MS = 10 * 60 * 1000;
/** Después de un error, cuánto tiempo responder directo con reglas (sin esperar 4 s por llamada). */
const COOLDOWN_MS = 2 * 60 * 1000;

/** Llamada al modelo: devuelve el texto crudo. Inyectable para tests. */
export type BriefLlm = (args: { model: string; system: string; user: string; signal: AbortSignal }) => Promise<string>;

export const anthropicBrief: BriefLlm = async ({ model, system, user, signal }) => {
  const client = anthropicClient();
  const msg = (await client.messages.create(
    { model, max_tokens: 120, system, messages: [{ role: 'user', content: user }] },
    { signal, maxRetries: 0 },
  )) as unknown as { content: AnyBlock[] };
  return textOf(msg.content);
};

export function briefSystem(): string {
  return [
    `Sos ${SCOUT.name}, el guía de viaje de la app. ${SCOUT.persona}`,
    'Escribí UNA sola frase para la pantalla "Ahora": qué conviene hacer ya.',
    `Máximo ${NOW_BRIEF_MAX} caracteres. Sin comillas, sin emojis, sin saludos, sin markdown.`,
    'Usá solo los datos del snapshot (horas, minutos, nombres). No inventes lugares, horarios ni números.',
    'Si escribís en español, usá voseo rioplatense ("salí", "tenés").',
    'No repitas lo que la pantalla ya muestra con el reloj (cuánto falta para salir, cuánto tiempo libre queda, la hora):',
    'esos números cambian cada minuto. Aportá otra cosa: una idea concreta, quién del grupo está cerca, el clima.',
    'hero: leave = hay que salir hacia next (leave_in_min negativo = va tarde); tour = un tour listo; current = algo en curso;',
    'free = tiempo libre (gap_min); state = antes/después del viaje o sin plan.',
  ].join('\n');
}

export function briefUser(language: string, snapshot: NowBriefSnapshotT): string {
  return `Idioma: ${language}\nSnapshot:\n${JSON.stringify(snapshot)}`;
}

/** Limpia la respuesta; null si no sirve (vacía, larga o con números que no están en el snapshot). */
export function sanitizeBrief(raw: string, snapshot: NowBriefSnapshotT): string | null {
  const t = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'«“]+|["'»”]+$/g, '')
    .trim();
  if (!t || t.length > NOW_BRIEF_MAX + 10) return null;
  const known = new Set(JSON.stringify(snapshot).match(/\d+/g) ?? []);
  for (const n of t.match(/\d+/g) ?? []) {
    // "-7" en el snapshot se dice "7 min tarde"; "08" de una hora también vale como "8".
    if (!known.has(n) && !known.has(String(Number(n))) && !known.has(n.padStart(2, '0'))) return null;
  }
  return clampBrief(t);
}

export function briefCacheKey(language: string, snapshot: NowBriefSnapshotT): string {
  return createHash('sha1').update(JSON.stringify([language, snapshot])).digest('hex');
}

const cache = new Map<string, { text: string; at: number }>();
let cooldownUntil = 0;

export function clearBriefCache(): void {
  cache.clear();
  cooldownUntil = 0;
}

export async function nowBrief(
  args: { language: string; snapshot: NowBriefSnapshotT },
  deps: { llm?: BriefLlm; model?: string; now?: () => number } = {},
): Promise<NowBriefOutput> {
  const now = deps.now ?? Date.now;
  const rules: NowBriefOutput = { text: nowBriefRules(args.snapshot), source: 'rules' };
  const key = briefCacheKey(args.language, args.snapshot);
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return { text: hit.text, source: 'llm' };
  if (now() < cooldownUntil) return rules;

  const model = deps.model ?? (process.env.BRIEF_MODEL?.trim() || BRIEF_DEFAULT_MODEL);
  const llm = deps.llm ?? anthropicBrief;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const raw = await Promise.race([
      llm({ model, system: briefSystem(), user: briefUser(args.language, args.snapshot), signal: ctrl.signal }),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    const text = sanitizeBrief(raw, args.snapshot);
    if (!text) return rules;
    if (cache.size > 500) cache.clear();
    cache.set(key, { text, at: now() });
    return { text, source: 'llm' };
  } catch (err) {
    cooldownUntil = now() + COOLDOWN_MS;
    console.warn('[now_brief] uso reglas:', (err as Error)?.message ?? err);
    return rules;
  } finally {
    clearTimeout(timer);
  }
}
