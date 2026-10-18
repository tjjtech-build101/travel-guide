import { understandingToTourInput, type ToolInput, type TourVariantsResult } from '@build101/shared';
import { loadTourBrief } from '../agents/tourContext';
import { answersFromInput, defaultDeps, prepareTour, resolveParticipants, resolveStart } from '../agents/tourGenerator';
import { sanitizeUnderstanding } from '../agents/tourInterview';
import { structured } from '../agents/tourLlm';
import { buildVariants, VariantsOutput } from '../agents/tourVariants';
import { tourWeather } from '../google/openMeteo';
import { reverseGeocode } from '../google/osm';
import { wikipediaIntros } from '../google/wikipedia';
import type { ToolCtx, ToolOk } from './types';

const capped = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** Planificador de tours, paso 2: 2-3 recorridos reales para elegir (como trip_shapes). Síncrona (~20-40 s). */
export async function tour_variants(input: ToolInput<'tour_variants'>, ctx: ToolCtx): Promise<ToolOk<TourVariantsResult>> {
  const u = sanitizeUnderstanding(input.understanding as never, input.duration_min);
  const gen: ToolInput<'generate_tour'> = {
    mode: 'spontaneous',
    start_lat: input.start_lat,
    start_lng: input.start_lng,
    duration_min: u.duration_min ?? input.duration_min ?? 60,
    storyline: false,
    language: 'es',
    ...(input.trip_id ? { trip_id: input.trip_id } : {}),
    ...understandingToTourInput(u),
  };
  const { block, participantIds } = await resolveParticipants(ctx.admin, input, ctx.userId);
  const brief = await loadTourBrief(
    ctx.admin,
    {
      participantIds,
      tripId: input.trip_id ?? block?.trip_id ?? null,
      start: resolveStart(new Date(), input.start_at ?? block?.start_at ?? null),
      durationMin: gen.duration_min,
      lat: input.start_lat,
      lng: input.start_lng,
      answers: answersFromInput(gen),
    },
    { weather: (a) => capped(tourWeather(a), 3000, null), reverseGeocode: (lat, lng) => capped(reverseGeocode(lat, lng), 3000, null) },
  );
  const deps = defaultDeps(ctx.admin, ctx.userId);
  const prep = await prepareTour({ input: gen, brief, progress: () => {}, startedAt: Date.now() }, deps);
  const conversationText = input.conversation.map((t) => `${t.role === 'user' ? 'Persona' : 'Scout'}: ${t.text}`).join('\n');
  const data = await buildVariants(prep, u, conversationText, {
    llm: async ({ system, user, effort }) => structured(VariantsOutput, { system, user, config: { effort, maxTokens: 6000, maxIterations: 1, fallbacks: true } }, 'las variantes'),
    summaries: async (stops) => {
      const titled = stops.filter((s) => s.wiki_title);
      const intros = await capped(wikipediaIntros(titled.map((s) => s.wiki_title!), 'es'), 5000, new Map<string, string>());
      return new Map(stops.map((s) => [s.name, (s.wiki_title && intros.get(s.wiki_title)) || s.summary || ''] as const).filter(([, v]) => v));
    },
  });
  return { ok: true, data };
}
