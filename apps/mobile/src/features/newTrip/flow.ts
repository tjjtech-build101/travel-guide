// Llamadas del flujo "Nuevo viaje": trip_brief, trip_shapes y plan_trip. Leen y escriben el store, devuelven
// true/false (el demo de dev las encadena). Si el usuario cambió algo mientras volvía la respuesta, se descarta.
import type { PlanTripStart, TripBriefResult, TripShapesResult } from '@build101/shared';

import { callTool } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { tripKeys } from '../trips/keys';
import {
  baseConversation,
  conversationWithAnswers,
  defaultAnswers,
  effectiveStartDate,
  inputKey,
  planTripInput,
  type PlanMode,
  type Turn,
} from './model';
import { chosenShape, useNewTripStore } from './store';

const get = () => useNewTripStore.getState();

// Los errores se guardan enteros (ToolError: code, message, provider, detail) en el store: cada fase
// los muestra con ErrorNotice (lib/errors), que explica la causa real.

/** Lo que va a trip_brief. */
export function briefRequest(): { conversation: Turn[]; startDate: string | null } {
  const s = get();
  return { conversation: baseConversation(s.story, s.startDate), startDate: s.startDate };
}

/** Lo que va a trip_shapes y a plan_trip: lo contado + preguntas y respuestas. */
export function shapesRequest(): { conversation: Turn[]; startDate: string | null } {
  const s = get();
  const base = baseConversation(s.story, s.startDate);
  const questions = s.brief?.questions ?? [];
  return {
    conversation: conversationWithAnswers(base, questions, s.answers),
    startDate: effectiveStartDate(s.startDate, questions, s.answers),
  };
}

/** "Seguir" desde Contame. Reusa el brief si no cambió lo contado (salvo force). */
export async function requestBrief(force = false): Promise<boolean> {
  const { conversation, startDate } = briefRequest();
  const key = inputKey(conversation, startDate);
  const s = get();
  s.setPhase('brief');
  if (!force && s.brief && s.briefKey === key) return true;
  if (s.loading === 'brief') return false;
  s.setLoading('brief');
  s.setError('brief', null);
  const res = await callTool<'trip_brief', TripBriefResult>('trip_brief', {
    conversation,
    ...(startDate ? { start_date: startDate } : {}),
  });
  if (get().loading === 'brief') get().setLoading(null);
  // Mientras tanto la persona volvió y cambió lo contado: esta respuesta ya no sirve.
  if (inputKey(briefRequest().conversation, briefRequest().startDate) !== key) return false;
  if (!res.ok) {
    get().setError('brief', res.error);
    return false;
  }
  const prev = get().answers;
  const defaults = defaultAnswers(res.data.questions);
  // Lo que ya había contestado a una pregunta que se repite no se pisa.
  const kept = Object.fromEntries(Object.entries(prev).filter(([id]) => res.data.questions.some((q) => q.id === id)));
  get().setBrief(res.data, key, { ...defaults, ...kept });
  return true;
}

/** "Seguir" / "Saltar preguntas" desde Lo que entendí. */
export async function requestShapes(force = false): Promise<boolean> {
  const { conversation, startDate } = shapesRequest();
  const key = inputKey(conversation, startDate);
  const s = get();
  s.setPhase('shapes');
  if (!force && s.shapes?.length && s.shapesKey === key) return true;
  if (s.loading === 'shapes') return false;
  s.setLoading('shapes');
  s.setError('shapes', null);
  const res = await callTool<'trip_shapes', TripShapesResult>('trip_shapes', {
    conversation,
    ...(startDate ? { start_date: startDate } : {}),
  });
  if (get().loading === 'shapes') get().setLoading(null);
  const now = shapesRequest();
  if (inputKey(now.conversation, now.startDate) !== key) return false;
  if (!res.ok) {
    get().setError('shapes', res.error);
    return false;
  }
  if (!res.data.variants?.length) {
    get().setError('shapes', { code: 'no_shapes', message: 'No se me ocurrió ninguna forma con lo que me contaste.' });
    return false;
  }
  get().setShapes(res.data.variants, key);
  return true;
}

/**
 * Arranca plan_trip. `withShape` = con la forma elegida (Armémoslo juntos / Armalo vos);
 * sin forma = "Armalo ya/igual" con la conversación que haya (mode auto, como antes).
 */
export async function startPlan(mode: PlanMode, withShape = true): Promise<boolean> {
  const s = get();
  if (s.loading === 'plan') return false;
  if (!s.story.trim()) return false;
  const { conversation, startDate } = s.brief ? shapesRequest() : briefRequest();
  const shape = withShape ? chosenShape(s) : null;
  s.setLoading('plan');
  s.setError('plan', null);
  const res = await callTool<'plan_trip', PlanTripStart>(
    'plan_trip',
    planTripInput({ conversation, startDate, shape, mode: shape ? mode : 'auto', understanding: s.brief?.understood ?? null }),
  );
  get().setLoading(null);
  if (!res.ok) {
    get().setError('plan', res.error);
    return false;
  }
  void queryClient.invalidateQueries({ queryKey: tripKeys.mine() });
  get().setJob(res.data, shape ? mode : 'auto');
  return true;
}
