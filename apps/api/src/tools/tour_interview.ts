import type { ToolInput, TourInterviewResult } from '@build101/shared';
import { loadTourBrief } from '../agents/tourContext';
import { resolveParticipants, resolveStart } from '../agents/tourGenerator';
import { formatNearby, InterviewOutput, runTourInterview } from '../agents/tourInterview';
import { structured } from '../agents/tourLlm';
import { tourWeather } from '../google/openMeteo';
import { reverseGeocode } from '../google/osm';
import { wikipediaGeosearch } from '../google/wikipedia';
import type { ToolCtx, ToolOk } from './types';

const capped = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/** Planificador de tours, paso 1: entrevista en rondas (como trip_brief). Síncrona (~10-20 s con Claude). */
export async function tour_interview(input: ToolInput<'tour_interview'>, ctx: ToolCtx): Promise<ToolOk<TourInterviewResult>> {
  const { block, participantIds } = await resolveParticipants(ctx.admin, input, ctx.userId);
  const brief = await loadTourBrief(
    ctx.admin,
    {
      participantIds,
      tripId: input.trip_id ?? block?.trip_id ?? null,
      start: resolveStart(new Date(), input.start_at ?? block?.start_at ?? null),
      durationMin: input.duration_min ?? 60,
      lat: input.start_lat,
      lng: input.start_lng,
      answers: {},
    },
    { weather: (a) => capped(tourWeather(a), 2500, null), reverseGeocode: (lat, lng) => capped(reverseGeocode(lat, lng), 2500, null) },
  );
  const data = await runTourInterview(input, brief, {
    llm: async ({ system, user, effort }) => structured(InterviewOutput, { system, user, config: { effort, maxTokens: 8000, maxIterations: 1, fallbacks: true } }, 'la entrevista'),
    nearby: async (lat, lng) => {
      const [wiki, lib] = await Promise.all([
        capped(wikipediaGeosearch({ lat, lng, radius_m: 1500, limit: 40 }), 5000, []),
        capped(Promise.resolve(ctx.admin.rpc('nearby_place_library', { center_lat: lat, center_lng: lng, radius_m: 1500 })).then((r) => (r.data ?? []) as { name: string; lat: number; lng: number }[]), 3000, []),
      ]);
      return formatNearby({ lat, lng }, [...lib.filter((p) => p.name), ...wiki.map((w) => ({ name: w.title.replace(/\s*\(.*\)$/, ''), lat: w.lat, lng: w.lng }))]);
    },
  });
  return { ok: true, data };
}
