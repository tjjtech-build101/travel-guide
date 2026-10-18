// Investigador de eventos (PRD 16): Claude + web_search, con caché en agent_jobs (misma ciudad+fechas
// responde en ≤1s por 6h, como pide el PRD). No es un job asincrónico: responde todo en la misma llamada
// (≤25s), agent_jobs se usa acá solo como tabla de caché persistente entre invocaciones serverless.
import type { ToolInput } from '@build101/shared';
import { searchPlaces } from '../google/places';
import { captureViaTool, type TourLlmConfig } from './tourLlm';
import { EVENTS_SYSTEM, renderEventsUser } from './eventsPrompts';
import { EventsSearchOutput, type EventItemT } from './eventsSchemas';
import type { Db } from '../supabase';

const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONFIG: TourLlmConfig = { effort: 'medium', maxTokens: 4000, maxIterations: 6, fallbacks: true };

export function eventsCacheKey(args: { city: string; country?: string; date_from: string; date_to: string }): string {
  return [args.city, args.country ?? '', args.date_from, args.date_to].map((s) => s.trim().toLowerCase()).join('|');
}

/** Elimina eventos sin fecha en rango o sin fuente (regla dura, no solo prompt). */
export function sanitizeEvents(events: EventItemT[], dateFrom: string, dateTo: string): EventItemT[] {
  return events
    .filter((e) => e.date >= dateFrom && e.date <= dateTo)
    .filter((e) => e.source_url?.trim())
    .slice(0, 10);
}

async function readCache(admin: Db, key: string): Promise<EventItemT[] | null> {
  const { data } = await admin
    .from('agent_jobs')
    .select('result,created_at')
    .eq('kind', 'events_search')
    .contains('progress', [{ text: key }])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || Date.now() - Date.parse(data.created_at as string) >= CACHE_FRESH_MS) return null;
  const result = data.result as { events?: EventItemT[] } | null;
  return result?.events ?? null;
}

async function writeCache(admin: Db, key: string, userId: string, events: EventItemT[]): Promise<void> {
  const { error } = await admin.from('agent_jobs').insert({
    kind: 'events_search',
    trip_id: null,
    user_id: userId,
    status: 'done',
    progress: [{ at: new Date().toISOString(), text: key }],
    result: { events },
  });
  if (error) console.warn('[events_search] no pude cachear:', error.message);
}

/**
 * Eventos de una fecha que ya están en la caché de events_search para esa ciudad (cualquier rango que la incluya).
 * No llama a Claude: lo usa gap_suggestions, que tiene que responder rápido. Sin caché → [].
 */
export async function cachedEventsOn(admin: Db, args: { city: string; country?: string | null; date: string }): Promise<EventItemT[]> {
  const prefix = `${args.city.trim().toLowerCase()}|${(args.country ?? '').trim().toLowerCase()}|`;
  const { data, error } = await admin
    .from('agent_jobs')
    .select('result,progress,created_at')
    .eq('kind', 'events_search')
    .gte('created_at', new Date(Date.now() - CACHE_FRESH_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data) return [];
  const seen = new Set<string>();
  const out: EventItemT[] = [];
  for (const row of data) {
    const key = (row.progress as { text?: string }[] | null)?.[0]?.text ?? '';
    if (!key.startsWith(prefix)) continue;
    for (const e of (row.result as { events?: EventItemT[] } | null)?.events ?? []) {
      const id = `${e.title}|${e.date}|${e.start_time ?? ''}`;
      if (e.date !== args.date || seen.has(id)) continue;
      seen.add(id);
      out.push(e);
    }
  }
  return out;
}

/** Completa lat/lng geocodificando el venue cuando el modelo no lo sabe (PRD 16, Notas técnicas). */
async function geocodeMissing(events: EventItemT[], city: string): Promise<(EventItemT & { lat: number | null; lng: number | null })[]> {
  return Promise.all(
    events.map(async (e) => {
      try {
        const [place] = await searchPlaces({ query: `${e.venue}, ${city}`, max_results: 1, radius_m: 20_000 });
        return { ...e, lat: place?.lat ?? null, lng: place?.lng ?? null };
      } catch {
        return { ...e, lat: null, lng: null };
      }
    }),
  );
}

export async function runEventsSearch(input: ToolInput<'events_search'>, admin: Db, userId: string): Promise<(EventItemT & { lat: number | null; lng: number | null })[]> {
  const key = eventsCacheKey(input);
  const cached = await readCache(admin, key);
  if (cached) return geocodeMissing(cached, input.city);

  const r = await captureViaTool<{ events: EventItemT[] }>({
    system: EVENTS_SYSTEM,
    user: renderEventsUser(input),
    captureName: 'report_events',
    captureDescription: 'Reportá los eventos confirmados que encontraste (puede ser una lista vacía).',
    captureSchema: EventsSearchOutput,
    serverTools: ['web_search'],
    config: DEFAULT_CONFIG,
  });
  const events = sanitizeEvents(r.value?.events ?? [], input.date_from, input.date_to);
  await writeCache(admin, key, userId, events);
  return geocodeMissing(events, input.city);
}
