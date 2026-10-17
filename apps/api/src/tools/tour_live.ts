// PRD 07 · Herramientas del tour en vivo. Las llama el modelo de voz (x-actor: agent) y la UI del celu.
// El progreso vive en tours.progress (Contratos v1.1); el celu manda su estado local en tour_status (es la verdad).
import {
  SCOUT,
  type NextStopResult,
  type SkipStopResult,
  type StartTourResult,
  type StopContentResult,
  type ToolInput,
  type TourProgress,
  type TourStatusResult,
} from '@build101/shared';
import { conflict, dbError } from '../errors';
import { computeRoute } from '../google/routes';
import {
  advance,
  initialProgress,
  layerText,
  loadStop,
  loadStops,
  loadTold,
  loadTour,
  pendingStops,
  remainingMin,
  saveProgress,
  skip,
  stopName,
  stopSources,
  stopView,
  tourDurationMin,
  type StopRow,
  type TourRow,
} from '../tourLive';
import type { ToolCtx, ToolOk } from './types';

function assertPlayable(tour: TourRow) {
  if (tour.status === 'generating') throw conflict('tour_not_ready', 'El tour todavía se está armando.');
  if (tour.status === 'failed') throw conflict('tour_failed', 'Este tour no se pudo armar.');
}

async function stopsOrFail(ctx: ToolCtx, tourId: string): Promise<StopRow[]> {
  const stops = await loadStops(ctx, tourId);
  if (!stops.length) throw conflict('tour_empty', 'Este tour no tiene paradas.');
  return stops;
}

const progressOf = (tour: TourRow, stops: StopRow[]): TourProgress =>
  tour.progress ?? initialProgress(stops, tourDurationMin(tour));

export async function start_tour(input: ToolInput<'start_tour'>, ctx: ToolCtx): Promise<ToolOk<StartTourResult>> {
  const tour = await loadTour(ctx, input.tour_id);
  assertPlayable(tour);
  const stops = await stopsOrFail(ctx, tour.id);
  const alreadyActive = tour.status === 'active' && !!tour.progress;
  const progress = alreadyActive ? tour.progress! : initialProgress(stops, tourDurationMin(tour));
  if (!alreadyActive) await saveProgress(ctx, tour.id, progress, 'active');
  const told = await loadTold(ctx, ctx.userId, stops.map((s) => s.place_id).filter((x): x is string => !!x));
  return {
    ok: true,
    data: {
      tour: {
        id: tour.id,
        trip_id: tour.trip_id,
        block_id: tour.block_id,
        title: tour.title,
        mode: tour.mode,
        status: 'active',
        duration_min: tourDurationMin(tour),
        route: tour.route,
        progress,
      },
      stops: stops.map((s) => stopView(s, s.place_id ? (told.get(s.place_id) ?? []) : [])),
      persona: { name: SCOUT.name, voice: SCOUT.voice },
      already_active: alreadyActive,
    },
  };
}

export async function tour_status(input: ToolInput<'tour_status'>, ctx: ToolCtx): Promise<ToolOk<TourStatusResult>> {
  const tour = await loadTour(ctx, input.tour_id);
  const stops = await loadStops(ctx, tour.id);
  let progress = input.progress ?? tour.progress;
  let status = tour.status;
  if (input.end) {
    progress = progress ?? initialProgress(stops, tourDurationMin(tour));
    status = 'done';
    await saveProgress(ctx, tour.id, progress, 'done');
  } else if (input.progress) {
    const known = new Set(stops.map((s) => s.id));
    // Ids que no son del tour: se ignoran (no rompen el estado guardado).
    progress = {
      ...input.progress,
      current_stop_id: input.progress.current_stop_id && known.has(input.progress.current_stop_id) ? input.progress.current_stop_id : null,
      visited: input.progress.visited.filter((v) => known.has(v.stop_id)),
      skipped: input.progress.skipped.filter((id) => known.has(id)),
    };
    await saveProgress(ctx, tour.id, progress);
  }
  const byId = new Map(stops.map((s) => [s.id, s]));
  const current = progress?.current_stop_id ? byId.get(progress.current_stop_id) : undefined;
  const pending = progress ? pendingStops(stops, progress) : stops;
  const nextRow = pending.find((s) => s.id !== current?.id) ?? null;
  let eta: { eta_min: number | null; distance_m: number | null } = { eta_min: null, distance_m: null };
  const lat = nextRow?.place_library?.lat;
  const lng = nextRow?.place_library?.lng;
  if (nextRow && input.lat != null && input.lng != null && lat != null && lng != null) {
    try {
      const r = await computeRoute([{ lat: input.lat, lng: input.lng }, { lat, lng }], 'walk');
      eta = { eta_min: r.segments[0]?.duration_min ?? null, distance_m: r.segments[0]?.distance_m ?? null };
    } catch (e) {
      console.warn('[tour_status] route_eta', (e as Error).message);
    }
  }
  return {
    ok: true,
    data: {
      tour_id: tour.id,
      status,
      current: current ? { stop_id: current.id, name: stopName(current), sort_order: current.sort_order ?? 0 } : null,
      next: nextRow ? { stop_id: nextRow.id, name: stopName(nextRow), sort_order: nextRow.sort_order ?? 0, ...eta } : null,
      remaining_min: progress ? remainingMin(progress) : tourDurationMin(tour),
      visited: progress?.visited.map((v) => v.stop_id) ?? [],
      skipped: progress?.skipped ?? [],
      pending: pending.length,
      progress: progress ?? null,
    },
  };
}

/** Participantes de la llamada de tour abierta (grupo en un celu); si no hay, solo la persona. */
async function sessionParticipants(ctx: ToolCtx, tourId: string): Promise<string[]> {
  const { data, error } = await ctx.admin
    .from('voice_sessions')
    .select('participants')
    .eq('tour_id', tourId)
    .is('ended_at', null)
    .contains('participants', [ctx.userId])
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw dbError(error, 'voice_sessions');
  const ids = ((data?.[0]?.participants as string[] | null | undefined) ?? []).filter(Boolean);
  return [...new Set([ctx.userId, ...ids])];
}

export async function get_stop_content(input: ToolInput<'get_stop_content'>, ctx: ToolCtx): Promise<ToolOk<StopContentResult>> {
  const { stop, tour } = await loadStop(ctx, input.stop_id);
  const layer = input.layer;
  const text = layerText(stop, layer);
  let alreadyTold = false;
  if (stop.place_id) {
    const { data, error } = await ctx.admin
      .from('content_told')
      .select('layer')
      .eq('user_id', ctx.userId)
      .eq('place_id', stop.place_id)
      .eq('layer', layer)
      .maybeSingle();
    if (error) throw dbError(error, 'content_told');
    alreadyTold = !!data;
    if (text) {
      const participants = await sessionParticipants(ctx, tour.id);
      const told_at = new Date().toISOString();
      const { error: e2 } = await ctx.admin
        .from('content_told')
        .upsert(
          participants.map((user_id) => ({ user_id, place_id: stop.place_id, layer, told_at })),
          { onConflict: 'user_id,place_id,layer', ignoreDuplicates: true },
        );
      if (e2) throw dbError(e2, 'content_told');
    }
  }
  return {
    ok: true,
    data: {
      stop_id: stop.id,
      place_id: stop.place_id,
      name: stopName(stop),
      layer,
      text,
      sources: stopSources(stop),
      already_told: alreadyTold,
    },
  };
}

export async function next_stop(input: ToolInput<'next_stop'>, ctx: ToolCtx): Promise<ToolOk<NextStopResult>> {
  const tour = await loadTour(ctx, input.tour_id);
  assertPlayable(tour);
  const stops = await stopsOrFail(ctx, tour.id);
  const near = tour.mode === 'explorer' && input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
  const { progress, previousId, next } = advance(stops, progressOf(tour, stops), { near });
  const done = next == null;
  await saveProgress(ctx, tour.id, progress, done ? 'done' : tour.status === 'ready' ? 'active' : undefined);
  const prev = previousId ? stops.find((s) => s.id === previousId) : undefined;
  return {
    ok: true,
    data: {
      done,
      previous: prev ? { stop_id: prev.id, name: stopName(prev) } : null,
      transition_to_next: prev && next ? prev.transition_to_next : null,
      nav_to_next: prev && next ? prev.nav_to_next : null,
      next: next
        ? {
            stop_id: next.id,
            name: stopName(next),
            sort_order: next.sort_order ?? 0,
            lat: next.place_library?.lat ?? null,
            lng: next.place_library?.lng ?? null,
            look_at: next.look_at,
          }
        : null,
      progress,
    },
  };
}

export async function skip_stop(input: ToolInput<'skip_stop'>, ctx: ToolCtx): Promise<ToolOk<SkipStopResult>> {
  const tour = await loadTour(ctx, input.tour_id);
  assertPlayable(tour);
  const stops = await stopsOrFail(ctx, tour.id);
  const progress = skip(stops, progressOf(tour, stops), input.stop_id);
  await saveProgress(ctx, tour.id, progress);
  return {
    ok: true,
    data: {
      skipped: progress.skipped,
      current_stop_id: progress.current_stop_id,
      pending: pendingStops(stops, progress).length,
      progress,
    },
  };
}
