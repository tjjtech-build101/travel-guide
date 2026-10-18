// Llamadas del flujo "Nuevo viaje": trip_brief (en rondas), trip_shapes y plan_trip. Leen y escriben el store, devuelven
// true/false (el demo de dev las encadena). Si el usuario cambió algo mientras volvía la respuesta, se descarta.
import type { PlanTripStart, TripBriefResult, TripShapesResult, ToolError } from '@build101/shared';

import { callTool } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { tripKeys } from '../trips/keys';
import {
  baseConversation,
  conversationWithAnswers,
  effectiveEndDate,
  effectiveStartDate,
  inputKey,
  mergeRoundAnswers,
  planTripInput,
  roundQuestions,
  skipRound,
  understandingForPlan,
  wantsAnotherRound,
  type PlanMode,
  type Turn,
} from './model';
import { chosenShape, currentBrief, useNewTripStore } from './store';

const get = () => useNewTripStore.getState();

export function friendlyError(e: Pick<ToolError, 'code' | 'message'>): string {
  if (e.code === 'network_error') return 'No me pude conectar. Revisá la conexión y probamos de nuevo.';
  // La API deployada todavía no tiene la entrevista/las formas (unknown_tool = 404 de /tools/:name).
  if (e.code === 'http_501' || e.code === 'not_implemented' || e.code === 'unknown_tool' || e.code === 'http_404')
    return 'Esta versión del servidor todavía no tiene las preguntas. Lo puedo armar igual con lo que me contaste.';
  if (e.code === 'unauthenticated') return 'Se cerró tu sesión. Volvé a entrar.';
  return 'No me salió esta vez.';
}

/**
 * Lo que va a trip_brief para la ronda `round` (1-based): lo contado + las preguntas y respuestas de las rondas
 * anteriores (cada pregunta como assistant, su respuesta como user; el agente las usa para no repetir).
 */
type Req = { conversation: Turn[]; startDate: string | null; endDate: string | null };

function tellBase(s: ReturnType<typeof get>): Turn[] {
  return baseConversation(s.story, s.startDate, { endDate: s.endDate, days: s.days });
}

export function briefRequest(round = 1): Req & { round: number } {
  const s = get();
  const base = tellBase(s);
  if (round <= 1) return { conversation: base, startDate: s.startDate, endDate: s.startDate ? s.endDate : null, round: 1 };
  const questions = roundQuestions(s.rounds, round - 2);
  return {
    conversation: conversationWithAnswers(base, questions, s.answers),
    startDate: effectiveStartDate(s.startDate, questions, s.answers),
    endDate: effectiveEndDate(s.startDate, s.endDate, questions, s.answers),
    round,
  };
}

/** Lo que va a trip_shapes y a plan_trip: lo contado + preguntas y respuestas hasta la ronda que se ve. */
export function shapesRequest(): Req {
  const s = get();
  const base = tellBase(s);
  const questions = roundQuestions(s.rounds, s.roundIndex);
  return {
    conversation: conversationWithAnswers(base, questions, s.answers),
    startDate: effectiveStartDate(s.startDate, questions, s.answers),
    endDate: effectiveEndDate(s.startDate, s.endDate, questions, s.answers),
  };
}

/** end_date solo si hay inicio y es posterior (el contrato pide fechas válidas). */
function datesFor(r: Pick<Req, 'startDate' | 'endDate'>) {
  if (!r.startDate) return {};
  return { start_date: r.startDate, ...(r.endDate && r.endDate >= r.startDate ? { end_date: r.endDate } : {}) };
}

const keyOf = (r: { conversation: Turn[]; startDate: string | null; round?: number }) => inputKey(r.conversation, r.startDate) + `#${r.round ?? 0}`;

async function fetchRound(round: number): Promise<{ ok: true; data: TripBriefResult; key: string } | { ok: false }> {
  const req = briefRequest(round);
  const key = keyOf(req);
  const res = await callTool<'trip_brief', TripBriefResult>('trip_brief', {
    conversation: req.conversation,
    ...datesFor(req),
    round,
  });
  // Mientras tanto la persona volvió y cambió algo: esta respuesta ya no sirve.
  if (keyOf(briefRequest(round)) !== key) return { ok: false };
  if (!res.ok) {
    get().setError(round === 1 ? 'brief' : 'round', friendlyError(res.error));
    return { ok: false };
  }
  return { ok: true, data: { ...res.data, questions: res.data.questions ?? [] }, key };
}

/** "Seguir" desde Contame: ronda 1. Reusa la ronda si no cambió lo contado (salvo force). */
export async function requestBrief(force = false): Promise<boolean> {
  const key = keyOf(briefRequest(1));
  const s = get();
  s.setPhase('brief');
  if (!force && s.rounds[0] && s.roundKeys[0] === key) {
    s.setRoundIndex(0);
    return true;
  }
  if (s.loading === 'brief') return false;
  s.setLoading('brief');
  s.setError('brief', null);
  s.setError('round', null);
  const res = await fetchRound(1);
  if (get().loading === 'brief') get().setLoading(null);
  if (!res.ok) return false;
  // Lo que ya había contestado a una pregunta que se repite no se pisa.
  get().setRound(0, res.data, res.key, mergeRoundAnswers(get().answers, [], res.data.questions));
  return true;
}

/**
 * "Seguir" desde Lo que entendí: pide la ronda siguiente con todo lo contestado (hasta 4; ver wantsAnotherRound);
 * si ya no hay más para preguntar, pasa a las formas. Si la siguiente ya estaba pedida con las mismas respuestas, la reusa.
 */
export async function requestNextRound(force = false): Promise<boolean> {
  const s = get();
  const cur = s.roundIndex;
  const brief = s.rounds[cur];
  if (!brief) return requestBrief(force);
  if (!wantsAnotherRound(brief, cur + 1)) return requestShapes(force);
  const next = cur + 2;
  const key = keyOf(briefRequest(next));
  const cached = s.rounds[cur + 1];
  if (!force && cached && s.roundKeys[cur + 1] === key) {
    s.setRoundIndex(cur + 1);
    return skipRound(cached) ? requestShapes() : true;
  }
  if (s.loading === 'round') return false;
  s.setLoading('round');
  s.setError('round', null);
  const res = await fetchRound(next);
  if (get().loading === 'round') get().setLoading(null);
  if (!res.ok) return false;
  // Puede haber vuelto atrás mientras cargaba: solo avanza si sigue en la misma ronda.
  if (get().roundIndex !== cur || get().phase !== 'brief') return false;
  const keep = roundQuestions(get().rounds, cur);
  get().setRound(cur + 1, res.data, res.key, mergeRoundAnswers(get().answers, keep, res.data.questions));
  return skipRound(res.data) ? requestShapes() : true;
}

/** "Pasemos a las opciones con lo que ya sabés": a las formas con lo que haya (hasta la ronda que se ve). */
export function finishInterview(): Promise<boolean> {
  return requestShapes();
}

/** Formas del viaje con la entrevista hasta la ronda que se ve. */
export async function requestShapes(force = false): Promise<boolean> {
  const req = shapesRequest();
  const { conversation, startDate } = req;
  const key = inputKey(conversation, startDate);
  const s = get();
  s.setPhase('shapes');
  if (!force && s.shapes?.length && s.shapesKey === key) return true;
  if (s.loading === 'shapes') return false;
  s.setLoading('shapes');
  s.setError('shapes', null);
  const understood = currentBrief(get())?.understood;
  const res = await callTool<'trip_shapes', TripShapesResult>('trip_shapes', {
    conversation,
    ...datesFor(req),
    ...(understood ? { understanding: understandingForPlan(understood) } : {}),
  });
  if (get().loading === 'shapes') get().setLoading(null);
  const now = shapesRequest();
  if (inputKey(now.conversation, now.startDate) !== key) return false;
  if (!res.ok) {
    get().setError('shapes', friendlyError(res.error));
    return false;
  }
  if (!res.data.variants?.length) {
    get().setError('shapes', 'No se me ocurrió ninguna forma con lo que me contaste.');
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
  const brief = currentBrief(s);
  const { conversation, startDate, endDate } = brief ? shapesRequest() : briefRequest(1);
  const shape = withShape ? chosenShape(s) : null;
  s.setLoading('plan');
  s.setError('plan', null);
  const res = await callTool<'plan_trip', PlanTripStart>(
    'plan_trip',
    planTripInput({ conversation, startDate, endDate, shape, mode: shape ? mode : 'auto', understanding: brief?.understood ?? null }),
  );
  get().setLoading(null);
  if (!res.ok) {
    get().setError('plan', friendlyError(res.error));
    return false;
  }
  void queryClient.invalidateQueries({ queryKey: tripKeys.mine() });
  get().setJob(res.data, shape ? mode : 'auto');
  return true;
}
