// Esquemas Zod de las llamadas a Claude del generador de tours (PRD 06).
// Salida estructurada → nada de min/max/regex (mismo criterio que TripSkeleton en ./schemas):
// las validaciones duras (largo de narración, fechas respaldadas, etc.) se hacen después en código.
import { z } from 'zod';

// ---------- Investigación (pasada 1, por lugar) ----------
export const ResearchFact = z.object({
  text: z.string().describe('Afirmación atómica: un dato por fact (ej. "El Teatro Solís se inauguró en 1856")'),
  source_url: z.string().describe('URL exacta de la página donde aparece ese dato'),
});
export const ResearchOutput = z.object({ facts: z.array(ResearchFact) });
export type ResearchOutputT = z.infer<typeof ResearchOutput>;

// ---------- Verificación (pasada 2, por fact, llamada independiente) ----------
export const VerifyOutput = z.object({
  supported: z.boolean().describe('true solo si el texto de la URL respalda el fact tal cual está escrito'),
  quote: z.string().describe('Frase textual de la fuente que respalda el fact; vacío si supported=false'),
});
export type VerifyOutputT = z.infer<typeof VerifyOutput>;

// ---------- Generación de paradas (pasada 3, todos los lugares de una) ----------
export const GeneratedStop = z.object({
  place_key: z.string().describe('La clave del lugar (stop_1, stop_2, ...) tal como te la pasé'),
  look_at: z.string().describe('Qué mirar en el lugar, una o dos oraciones'),
  narration_short: z.string().describe('Capa corta: 40-80 palabras, ~20-30s hablado'),
  narration_more: z.string().describe('Capa "contame más": 80-150 palabras'),
  narration_secret: z.string().describe('Capa "lo que nadie sabe": 40-100 palabras'),
  myth_vs_fact: z.string().nullable().describe('Mito vs realidad si hay uno conocido y respaldado; si no, null'),
  photo_spot: z.string().nullable().describe('Dónde pararse para la foto, si aplica; si no, null'),
  kid_mission: z.string().nullable().describe('Misión corta para chicos, si aplica; si no, null'),
  transition_to_next: z.string().nullable().describe('Frase que lleva a la siguiente parada; null si es la última'),
  nav_to_next: z.string().nullable().describe('Indicación corta de cómo llegar a la siguiente; null si es la última'),
});
export const GenerateStopsOutput = z.object({
  stops: z.array(GeneratedStop),
  storyline: z.string().nullable().describe('Premisa de la trama si se pidió; si no, null'),
});
export type GenerateStopsOutputT = z.infer<typeof GenerateStopsOutput>;
