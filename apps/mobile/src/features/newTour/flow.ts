// Llamadas de "Nuevo tour": tour_interview (en rondas) → tour_variants → generate_tour con la variante elegida.
import { understandingToTourInput, type TourInterviewResult, type TourVariant, type TourVariantsResult } from '@build101/shared';

import { callTool } from '../../lib/api';
import { friendlyError } from '../newTrip/flow';
import { startNearbyTour } from '../tours/nearbyTour';
import { baseConversation, conversationWithAnswers, roundQuestions, wantsAnotherRound } from './model';
import { currentRound, useNewTourStore } from './store';

const get = () => useNewTourStore.getState();

/** Conversación hasta la ronda `upTo` (inclusive) con todo lo contestado. */
function conversation(upTo: number) {
  const s = get();
  return conversationWithAnswers(baseConversation(s.story, s.durationMin), roundQuestions(s.rounds, upTo), s.answers, s.free);
}

function base() {
  const s = get();
  return {
    start_lat: s.here!.lat,
    start_lng: s.here!.lng,
    ...(s.durationMin ? { duration_min: s.durationMin } : {}),
    ...(s.tripId ? { trip_id: s.tripId } : {}),
    ...(s.blockId ? { block_id: s.blockId } : {}),
  };
}

/** Ronda `round` (1-based) de la entrevista. */
export async function requestRound(round: number): Promise<boolean> {
  const s = get();
  if (!s.here) {
    s.setError('brief', 'Necesito tu ubicación para armar el tour desde donde estás.');
    return false;
  }
  const key = round === 1 ? 'brief' : 'round';
  if (s.loading) return false;
  s.setLoading(key);
  s.setError(key, null);
  if (round === 1) s.setPhase('brief');
  const res = await callTool<'tour_interview', TourInterviewResult>('tour_interview', { ...base(), conversation: conversation(round - 2), round });
  get().setLoading(null);
  if (!res.ok) {
    get().setError(key, friendlyError(res.error));
    return false;
  }
  get().setRound(round - 1, { ...res.data, questions: res.data.questions ?? [] });
  if (res.data.done && !res.data.questions?.length) return requestVariants();
  return true;
}

/** "Seguir": otra ronda de repreguntas, o las variantes si ya alcanza. */
export function next(): Promise<boolean> {
  const s = get();
  const cur = currentRound(s);
  if (!cur) return requestRound(1);
  if (!wantsAnotherRound(cur, s.roundIndex + 1)) return requestVariants();
  return requestRound(s.roundIndex + 2);
}

/** Recorridos posibles con todo lo contado hasta la ronda que se ve. */
export async function requestVariants(force = false): Promise<boolean> {
  const s = get();
  s.setPhase('variants');
  if (!force && s.variants?.length) return true;
  if (s.loading === 'variants') return false;
  s.setLoading('variants');
  s.setError('variants', null);
  const cur = currentRound(s);
  const res = await callTool<'tour_variants', TourVariantsResult>('tour_variants', {
    ...base(),
    conversation: conversation(s.roundIndex),
    ...(cur ? { understanding: cur.understood } : {}),
  });
  get().setLoading(null);
  if (!res.ok) {
    get().setError('variants', friendlyError(res.error));
    return false;
  }
  if (!res.data.variants.length) {
    get().setError('variants', 'No encontré lugares con historia suficientes acá. Probá con más tiempo o moviéndote un poco.');
    return false;
  }
  get().setVariants(res.data.variants);
  return true;
}

/** Arma el tour: con la variante elegida (sus paradas) o, sin variante, con lo que se contó ("Armalo ya"). */
export async function startTour(variant: TourVariant | null): Promise<boolean> {
  const s = get();
  if (!s.here || s.loading === 'start') return false;
  s.setLoading('start');
  s.setError('start', null);
  const cur = currentRound(s);
  const fields = cur ? understandingToTourInput(cur.understood) : s.story.trim() ? { notes: s.story.trim().slice(0, 500) } : {};
  const res = await startNearbyTour({
    lat: s.here.lat,
    lng: s.here.lng,
    ...(s.tripId ? { trip_id: s.tripId } : {}),
    ...(s.blockId ? { block_id: s.blockId } : {}),
    ...fields,
    duration_min: (cur?.understood.duration_min ?? s.durationMin ?? 60) as number,
    ...(variant ? { variant_stops: variant.stops.map((st) => ({ name: st.name, lat: st.lat, lng: st.lng, google_place_id: st.google_place_id ?? null, wikidata_id: st.wikidata_id ?? null })) } : {}),
  });
  get().setLoading(null);
  if (!res.ok) {
    get().setError('start', res.message);
    return false;
  }
  return true;
}
