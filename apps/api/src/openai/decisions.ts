// OpenAI Decisions API (lanzada 6/10/2026, gpt-6-luna): preguntas con respuesta tipada en vez de texto
// libre. Acá solo el tipo "predicate" (probabilidad de que una condición sea cierta), 150ms, $0.10/1M
// tokens de entrada, sin cargo de salida. https://developers.openai.com/api/docs/guides/decisions
import { env } from '../env';
import { notConfigured, upstream } from '../errors';

const ENDPOINT = 'https://api.openai.com/v1/decisions';
const MODEL = 'gpt-6-luna';

type DecisionsResponse = { answers: { type: string; name: string; probability: number }[] };

/** Probabilidad (0-1) de que `instructions` sea cierto para `input`. */
export async function predicate(input: string, name: string, instructions: string): Promise<number> {
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) throw notConfigured('OpenAI (OPENAI_API_KEY)');
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input, questions: [{ type: 'predicate', name, instructions }] }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw upstream(`OpenAI Decisions no respondió: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw upstream(`OpenAI Decisions respondió ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as DecisionsResponse;
  const answer = body.answers.find((a) => a.name === name);
  if (!answer) throw upstream('OpenAI Decisions no devolvió la pregunta esperada.');
  return answer.probability;
}
