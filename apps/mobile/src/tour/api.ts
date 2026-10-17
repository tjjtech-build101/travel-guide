// Herramientas del tour en vivo (PRD 07) desde la UI: mismo POST /tools/:name que usa la voz (actor 'user').
import type {
  SkipStopResult,
  StartTourResult,
  StopContentResult,
  StopLayer,
  TourProgress,
  TourStatusResult,
} from '@build101/shared';

import { callTool, callToolOrThrow } from '../lib/api';

export async function startTour(tourId: string): Promise<StartTourResult> {
  return (await callToolOrThrow<'start_tour', StartTourResult>('start_tour', { tour_id: tourId })).data;
}

export async function getStopContent(stopId: string, layer: StopLayer): Promise<StopContentResult> {
  return (await callToolOrThrow<'get_stop_content', StopContentResult>('get_stop_content', { stop_id: stopId, layer })).data;
}

export async function skipStopRemote(tourId: string, stopId: string): Promise<SkipStopResult | null> {
  const r = await callTool<'skip_stop', SkipStopResult>('skip_stop', { tour_id: tourId, stop_id: stopId });
  return r.ok ? r.data : null;
}

/** Sube el estado local (la verdad) a tours.progress. `end` = Terminar. Nunca tira. */
export async function syncProgress(tourId: string, progress: TourProgress, end = false): Promise<TourStatusResult | null> {
  const r = await callTool<'tour_status', TourStatusResult>('tour_status', { tour_id: tourId, progress, ...(end ? { end: true } : {}) });
  if (!r.ok) console.warn('[tour] tour_status', r.error.code, r.error.message);
  return r.ok ? r.data : null;
}
