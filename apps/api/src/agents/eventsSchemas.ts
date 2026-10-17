// Salida estructurada del investigador de eventos (PRD 16). Sin min/max/regex (se valida después),
// mismo criterio que tourSchemas.ts.
import { z } from 'zod';

export const EventItem = z.object({
  title: z.string(),
  date: z.string().describe('YYYY-MM-DD, fecha concreta dentro del rango pedido'),
  start_time: z.string().nullable().describe('HH:MM si se sabe, si no null'),
  venue: z.string().describe('Nombre del lugar'),
  address: z.string().nullable(),
  price_text: z.string().nullable().describe('Texto libre ("gratis", "$500", "desde USD 20"); null si no se sabe'),
  url: z.string().describe('Página del evento'),
  source_url: z.string().describe('De dónde sale el dato (puede ser la misma url)'),
});
export const EventsSearchOutput = z.object({ events: z.array(EventItem) });
export type EventItemT = z.infer<typeof EventItem>;
export type EventsSearchOutputT = z.infer<typeof EventsSearchOutput>;
