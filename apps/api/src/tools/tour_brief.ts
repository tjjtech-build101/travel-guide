import type { ToolInput, TourBriefResult } from '@build101/shared';
import { buildBriefResult } from '../agents/tourBrief';
import { briefContextBullets, groupProfile, loadTourBrief } from '../agents/tourContext';
import { resolveParticipants, resolveStart } from '../agents/tourGenerator';
import { tourWeather } from '../google/openMeteo';
import { reverseGeocode } from '../google/osm';
import type { ToolCtx, ToolOk } from './types';

/** Entrevista previa a generate_tour: resumen del contexto + 0-3 preguntas que cambian el tour. Síncrona (< 3 s). */
export async function tour_brief(input: ToolInput<'tour_brief'>, ctx: ToolCtx): Promise<ToolOk<TourBriefResult>> {
  const { block, participantIds } = await resolveParticipants(ctx.admin, input, ctx.userId);
  const brief = await loadTourBrief(
    ctx.admin,
    {
      participantIds,
      tripId: input.trip_id ?? block?.trip_id ?? null,
      start: resolveStart(new Date(), input.start_at ?? block?.start_at ?? null),
      durationMin: input.duration_min,
      lat: input.start_lat,
      lng: input.start_lng,
      answers: {},
    },
    {
      // Tope de tiempo: la hoja no puede quedar esperando a un servicio lento.
      weather: (a) => Promise.race([tourWeather(a), new Promise<null>((r) => setTimeout(() => r(null), 2500))]),
      reverseGeocode: (lat, lng) => Promise.race([reverseGeocode(lat, lng), new Promise<null>((r) => setTimeout(() => r(null), 2500))]),
    },
  );
  const group = groupProfile(brief);
  return { ok: true, data: buildBriefResult(brief, group, input, briefContextBullets(brief, group)) };
}
