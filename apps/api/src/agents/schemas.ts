// Tipos internos del planificador (PRD 01). No son herramientas ni tablas.
// Ojo: el esquema va como salida estructurada → nada de min/max/regex (se validan en normalizeSkeleton).
import { TRANSFER_MODES } from '@build101/shared';
import { z } from 'zod';

export const SkeletonLeg = z.object({
  key: z.string().describe('Id corto y único del tramo, ej. "mvd", "colonia", "bsas-sofi", "bsas"'),
  city: z.string().describe('Ciudad, en el idioma original (ej. "Montevideo", "Colonia del Sacramento")'),
  country: z.string(),
  start_date: z.string().describe('YYYY-MM-DD, primer día en esa ciudad (el día que se llega)'),
  end_date: z.string().describe('YYYY-MM-DD, último día completo en esa ciudad (inclusive)'),
  includes_organizer: z.boolean().describe('true si quien escribe (el organizador) está en este tramo'),
  participant_names: z
    .array(z.string())
    .describe('Nombres propios mencionados que están en este tramo, sin el organizador. Vacío si no se nombró a nadie.'),
  parallel_with: z.array(z.string()).describe('keys de tramos con fechas superpuestas (el grupo se separa)'),
  why: z.string().describe('Por qué esos días (una oración)'),
});

export const SkeletonTransfer = z.object({
  from_key: z.string(),
  to_key: z.string(),
  date: z.string().describe('YYYY-MM-DD; normalmente el start_date del tramo destino'),
  mode: z.enum(TRANSFER_MODES),
  duration_min: z.number().describe('Duración estimada puerta a puerta en minutos'),
  participant_names: z.array(z.string()),
});

export const TripSkeleton = z.object({
  title: z.string().describe('Título corto del viaje en rioplatense, ej. "Montevideo + Buenos Aires"'),
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
  legs: z.array(SkeletonLeg),
  transfers: z.array(SkeletonTransfer),
  assumptions: z.array(z.string()).describe('Todo lo que supusiste, en rioplatense ("Asumí 3 noches en Montevideo porque…")'),
});
export type TripSkeleton = z.infer<typeof TripSkeleton>;
export type SkeletonLegT = z.infer<typeof SkeletonLeg>;
export type SkeletonTransferT = z.infer<typeof SkeletonTransfer>;

/** Consumo de tokens acumulado (para el reporte de costo). */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  web_search_requests: number;
};

export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  web_search_requests: 0,
});

type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
} | null | undefined;

export function addUsage(acc: Usage, u: RawUsage): Usage {
  if (!u) return acc;
  acc.input_tokens += u.input_tokens ?? 0;
  acc.output_tokens += u.output_tokens ?? 0;
  acc.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
  acc.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  acc.web_search_requests += u.server_tool_use?.web_search_requests ?? 0;
  return acc;
}

/** Costo estimado en USD (Opus 5.5: $4/MTok in, $20/MTok out, cache read $0.20, cache write 1.25×, web search $10/1000). */
export function estimateCostUsd(u: Usage): number {
  const cost =
    (u.input_tokens * 4 + u.output_tokens * 20 + u.cache_read_input_tokens * 0.2 + u.cache_creation_input_tokens * 5) / 1e6 +
    u.web_search_requests * 0.01;
  return Math.round(cost * 10000) / 10000;
}
