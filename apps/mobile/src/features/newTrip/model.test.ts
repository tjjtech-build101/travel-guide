// Tests del modelo de "Nuevo viaje" (PRD 31). `npx tsx src/features/newTrip/model.test.ts` desde apps/mobile.
import { PlanTripInput, TripBriefInput, type TripAnchor, type TripQuestion, type TripShape } from '@build101/shared';

import {
  anchorWhen,
  answerText,
  baseConversation,
  coverageSummary,
  MAX_ROUNDS,
  daysOf,
  DAYS_PREFIX,
  effectiveEndDate,
  FREE_PREFIX,
  freeTextOf,
  isAnswered,
  isDurationQuestion,
  isSelected,
  roundLabel,
  setDays,
  setFreeText,
  withDateAnswer,
  mergeRoundAnswers,
  roundQuestions,
  skipRound,
  wantsAnotherRound,
  clampConversation,
  conversationWithAnswers,
  defaultAnswers,
  effectiveStartDate,
  inputKey,
  nights,
  parseTradeoff,
  planTripInput,
  recommendedShape,
  shortRange,
  skeletonFromShape,
  TELL_PROMPT,
  timeline,
  toggleAnswer,
} from './model';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(a: unknown, b: unknown) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`esperaba ${sb}\n    obtuve    ${sa}`);
}

const q = (over: Partial<TripQuestion>): TripQuestion => ({
  id: 'pace',
  dimension: 'pace',
  text: '¿Qué ritmo?',
  why: 'Para no matarlos',
  kind: 'single',
  options: [
    { value: 'relaxed', label: 'Tranqui' },
    { value: 'balanced', label: 'Equilibrado' },
  ],
  default: 'balanced',
  optional: false,
  ...over,
});

const interests = q({
  id: 'interests',
  dimension: 'interests',
  text: '¿Qué les copa?',
  kind: 'multi',
  options: [
    { value: 'food', label: 'Comida' },
    { value: 'walk', label: 'Caminar' },
    { value: 'museums', label: 'Museos' },
  ],
  default: ['food'],
});
const must = q({ id: 'must', dimension: 'must', text: '¿Algo sí o sí?', kind: 'text', options: [], default: null, optional: true });
const dates = q({ id: 'dates', dimension: 'dates', text: '¿Cuándo arrancan?', kind: 'date', options: [], default: null });

const shape: TripShape = {
  id: 'a',
  label: 'Equilibrado',
  pitch: 'Lo mejor de las dos',
  tradeoffs: ['+ 1 día en Colonia', '− menos Palermo'],
  recommended: true,
  title: 'Río de la Plata',
  start_date: '2026-10-24',
  end_date: '2026-11-01',
  legs: [
    { key: 'bue', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-28', end_date: '2026-11-01', includes_organizer: true, participant_names: [], parallel_with: [], why: 'Cierre' },
    { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-24', end_date: '2026-10-28', includes_organizer: true, participant_names: [], parallel_with: [], why: 'Arranque' },
  ],
  transfers: [{ from_key: 'mvd', to_key: 'bue', date: '2026-10-28', mode: 'ferry', duration_min: 135, participant_names: [] }],
  assumptions: ['Llegan a Montevideo en avión'],
};

// Caso Mundial de Rugby 2027: ronda 1 (lo básico) y ronda 2 (afinar).
const team = q({
  id: 'team',
  dimension: 'anchor',
  text: '¿A quién siguen?',
  options: [
    { value: 'arg', label: 'Los Pumas' },
    { value: 'nz', label: 'All Blacks' },
  ],
  default: 'arg',
});
const phase = q({
  id: 'phase',
  dimension: 'anchor',
  text: '¿Qué fase quieren ver?',
  kind: 'multi',
  options: [
    { value: 'groups', label: 'Fase de grupos' },
    { value: 'final', label: 'La final' },
  ],
  default: ['groups'],
});
const budget = q({
  id: 'budget',
  dimension: 'budget',
  text: '¿Qué presupuesto manejan?',
  options: [
    { value: 'mid', label: 'Medio' },
    { value: 'high', label: 'Alto' },
  ],
  default: 'mid',
});
const origin = q({ id: 'origin', dimension: 'origin', text: '¿Desde dónde salen?', kind: 'text', options: [], default: null });

const anchor: TripAnchor = {
  id: 'arg-nz',
  name: 'Argentina vs Nueva Zelanda (fase de grupos)',
  kind: 'sports',
  city: 'Perth',
  country: 'Australia',
  date: '2027-10-09',
  time: '18:00',
  venue: 'Perth Stadium',
  tickets: 'want',
  researched: true,
  sources: [{ url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' }],
  note: 'La venta oficial abre en 2026.',
};

console.log('newTrip/model');

test('baseConversation: saludo + historia + fecha', () => {
  eq(baseConversation('  Montevideo 4 días ', '2026-10-24'), [
    { role: 'assistant', text: TELL_PROMPT },
    { role: 'user', text: 'Montevideo 4 días' },
    { role: 'user', text: 'Fecha de inicio elegida: 2026-10-24' },
  ]);
  eq(baseConversation('x', null).length, 2);
});

test('defaultAnswers: single string, multi lista, sin default se omite', () => {
  eq(defaultAnswers([q({}), interests, must]), { pace: 'balanced', interests: ['food'] });
  eq(defaultAnswers([q({ kind: 'multi', default: 'relaxed' })]), { pace: ['relaxed'] });
});

test('toggleAnswer: single reemplaza, multi alterna', () => {
  eq(toggleAnswer(q({}), 'balanced', 'relaxed'), 'relaxed');
  eq(toggleAnswer(interests, ['food'], 'walk'), ['food', 'walk']);
  eq(toggleAnswer(interests, ['food', 'walk'], 'food'), ['walk']);
});

test('answerText usa labels; date con día legible', () => {
  eq(answerText(q({}), 'relaxed'), 'Tranqui');
  eq(answerText(interests, ['food', 'walk']), 'Comida, Caminar');
  eq(answerText(must, '  Mercado del Puerto '), 'Mercado del Puerto');
  eq(answerText(must, '   '), null);
  eq(answerText(interests, []), null);
  eq(answerText(dates, '2026-10-24'), 'sáb 24 oct (2026-10-24)');
});

test('conversationWithAnswers agrega pregunta (assistant) + respuesta (user), salta las vacías', () => {
  const base = baseConversation('Montevideo', null);
  const conv = conversationWithAnswers(base, [q({}), interests, must], { pace: 'relaxed', interests: ['walk'], must: '' });
  eq(conv.slice(2), [
    { role: 'assistant', text: '[q:pace/pace] ¿Qué ritmo?' },
    { role: 'user', text: 'Tranqui' },
    { role: 'assistant', text: '[q:interests/interests] ¿Qué les copa?' },
    { role: 'user', text: 'Caminar' },
  ]);
});

test('clampConversation: máx 40 mensajes y 2000 caracteres', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ role: 'user' as const, text: `${i}`.padEnd(2500, 'x') }));
  const out = clampConversation(many);
  eq(out.length, 40);
  eq(out[0]!.text.length, 2000);
  eq(out[0]!.text.startsWith('5'), true);
});

test('effectiveStartDate: la elegida gana; si no, la pregunta de fecha', () => {
  eq(effectiveStartDate('2026-10-20', [dates], { dates: '2026-10-24' }), '2026-10-20');
  eq(effectiveStartDate(null, [dates], { dates: '2026-10-24' }), '2026-10-24');
  eq(effectiveStartDate(null, [dates], { dates: 'algún día' }), null);
});

test('skeletonFromShape saca id/label/pitch/tradeoffs/recommended y valida con PlanTripInput', () => {
  const sk = skeletonFromShape(shape) as Record<string, unknown>;
  for (const k of ['id', 'label', 'pitch', 'tradeoffs', 'recommended']) eq(k in sk, false);
  eq(sk.title, 'Río de la Plata');
  const input = planTripInput({ conversation: baseConversation('Montevideo y Buenos Aires', null), startDate: null, shape, mode: 'menu' });
  const parsed = PlanTripInput.safeParse(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  eq(parsed.data.mode, 'menu');
  eq(parsed.data.skeleton?.legs.length, 2);
  eq('start_date' in input, false);
});

test('planTripInput sin forma: solo conversación + fecha + mode', () => {
  const input = planTripInput({ conversation: baseConversation('Lisboa', '2026-11-02'), startDate: '2026-11-02', shape: null, mode: 'auto' });
  eq(Object.keys(input).sort(), ['conversation', 'mode', 'start_date']);
  eq(PlanTripInput.safeParse(input).success, true);
});

test('recommendedShape: la recomendada o la primera', () => {
  eq(recommendedShape([{ ...shape, id: 'x', recommended: false }, shape])?.id, 'a');
  eq(recommendedShape([{ ...shape, id: 'x', recommended: false }])?.id, 'x');
  eq(recommendedShape([]), null);
});

test('timeline ordena por fecha y engancha el traslado', () => {
  const t = timeline(shape);
  eq(t.map((r) => r.leg.key), ['mvd', 'bue']);
  eq(t[0]!.nights, 4);
  eq(t[0]!.transfer?.mode, 'ferry');
  eq(t[1]!.transfer, null);
});

test('formato corto de fechas y noches', () => {
  eq(shortRange('2026-10-24', '2026-10-28'), '24–28 oct');
  eq(shortRange('2026-10-30', '2026-11-02'), '30 oct – 2 nov');
  eq(nights('2026-10-30', '2026-11-02'), 3);
});

test('parseTradeoff', () => {
  eq(parseTradeoff('+ 1 día en Colonia'), { sign: '+', text: '1 día en Colonia' });
  eq(parseTradeoff('− menos Palermo'), { sign: '−', text: 'menos Palermo' });
  eq(parseTradeoff('- menos Palermo'), { sign: '−', text: 'menos Palermo' });
  eq(parseTradeoff('Más caminata'), { sign: null, text: 'Más caminata' });
});

test('inputKey cambia con la conversación o la fecha', () => {
  const a = baseConversation('a', null);
  eq(inputKey(a, null) === inputKey(baseConversation('a', null), null), true);
  eq(inputKey(a, null) === inputKey(a, '2026-10-24'), false);
});

test('roundQuestions: rondas hasta upTo, en orden y sin repetir id', () => {
  const rounds = [{ questions: [team, phase] }, { questions: [budget, { ...team, text: '¿Seguro que a los Pumas?' }, origin] }];
  eq(roundQuestions(rounds).map((x) => x.id), ['team', 'phase', 'budget', 'origin']);
  eq(roundQuestions(rounds, 0).map((x) => x.id), ['team', 'phase']);
  eq(roundQuestions(rounds).find((x) => x.id === 'team')?.text, '¿A quién siguen?');
  eq(roundQuestions([]), []);
});

test('mergeRoundAnswers: no pisa lo de rondas anteriores; defaults solo para lo nuevo', () => {
  const r1 = [team, phase];
  const prev = { team: 'nz', phase: ['final'] };
  const merged = mergeRoundAnswers(prev, r1, [budget, origin, team]);
  eq(merged, { budget: 'mid', team: 'nz', phase: ['final'] });
  // Ronda 2 pedida de nuevo: lo que había contestado en la ronda 2 vieja se conserva si la pregunta vuelve.
  eq(mergeRoundAnswers({ ...merged, budget: 'high', origin: 'Córdoba' }, r1, [budget]), { budget: 'high', team: 'nz', phase: ['final'] });
  // Ronda 1 nueva (cambió lo contado): se descarta lo que ya no se pregunta.
  eq(mergeRoundAnswers({ team: 'nz', pace: 'relaxed' }, [], [team]), { team: 'nz' });
});

test('conversación acumulada entre rondas: formato pregunta/respuesta y sin duplicar', () => {
  const base = baseConversation('Me quiero ir a Australia con amigos a ver el mundial de rugby de 2027', null);
  const rounds = [{ questions: [team, phase] }, { questions: [budget, team, origin] }];
  const answers = { team: 'arg', phase: ['groups', 'final'], budget: 'high', origin: 'Buenos Aires' };
  const conv = conversationWithAnswers(base, roundQuestions(rounds), answers);
  eq(conv.slice(2), [
    { role: 'assistant', text: '[q:team/anchor] ¿A quién siguen?' },
    { role: 'user', text: 'Los Pumas' },
    { role: 'assistant', text: '[q:phase/anchor] ¿Qué fase quieren ver?' },
    { role: 'user', text: 'Fase de grupos, La final' },
    { role: 'assistant', text: '[q:budget/budget] ¿Qué presupuesto manejan?' },
    { role: 'user', text: 'Alto' },
    { role: 'assistant', text: '[q:origin/origin] ¿Desde dónde salen?' },
    { role: 'user', text: 'Buenos Aires' },
  ]);
  // Aunque se repita la pregunta en la lista, va una sola vez.
  eq(conversationWithAnswers(base, [team, team], answers).length, 4);
  // Lo que va a trip_brief en la ronda 2 valida con el contrato.
  const parsed = TripBriefInput.safeParse({ conversation: conversationWithAnswers(base, roundQuestions(rounds, 0), answers), round: 2 });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
});

test('wantsAnotherRound / skipRound: done, tope de rondas y ronda vacía', () => {
  eq(MAX_ROUNDS, 4);
  eq(wantsAnotherRound({ done: false, questions: [team] }, 1), true);
  eq(wantsAnotherRound({ questions: [team] }, 2), true);
  // done con preguntas antes de la ronda 3: igual se repregunta.
  eq(wantsAnotherRound({ done: true, questions: [team] }, 1), true);
  eq(wantsAnotherRound({ done: true, questions: [team] }, 2), true);
  eq(wantsAnotherRound({ done: true, questions: [team] }, 3), false);
  eq(wantsAnotherRound({ done: false, questions: [team] }, 3), true);
  eq(wantsAnotherRound({ done: false, questions: [team] }, MAX_ROUNDS), false);
  eq(wantsAnotherRound({ done: false, questions: [] }, 1), false);
  eq(skipRound({ done: true, questions: [] }), true);
  eq(skipRound({ done: true, questions: [budget] }), false);
});

test('coverageSummary: sé / supongo / me falta y score', () => {
  const c = coverageSummary({ dates: 'known', travelers: 'known', pace: 'assumed', budget: 'unknown' });
  eq(c?.known, ['fechas', 'el grupo']);
  eq(c?.assumed, ['ritmo']);
  eq(c?.missing, ['presupuesto']);
  eq(c?.score, 0.625);
  eq(coverageSummary(undefined), null);
  eq(coverageSummary({}), null);
});

test('anchorWhen: fecha corta + hora, o a confirmar', () => {
  eq(anchorWhen(anchor), 'sáb 9 oct · 18:00');
  eq(anchorWhen({ date: null, time: null }), 'Fecha a confirmar');
});

test('skeletonFromShape lleva las anclas de la forma y valida con PlanTripInput', () => {
  const withAnchors: TripShape = { ...shape, anchors: [anchor, { ...anchor, id: 'final', name: 'x'.repeat(300), researched: false, sources: [] }] };
  const sk = skeletonFromShape(withAnchors);
  eq(sk.anchors?.length, 2);
  eq(sk.anchors?.[0]?.venue, 'Perth Stadium');
  eq(sk.anchors?.[1]?.name.length, 200);
  eq('anchors' in skeletonFromShape(shape), false);
  const understanding = {
    destinations: [{ city: 'Perth', country: 'Australia' }],
    start_date: null,
    end_date: null,
    days: null,
    travelers: 4,
    party: 'friends' as const,
    names: [],
    interests: {},
    must: [],
    avoid: [],
    budget: 'high' as const,
    pace: null,
    first_time: true,
    kids_ages: [],
    arrival: null,
    departure: null,
    lodging_booked: null,
    notes: [],
    trip_kind: 'event' as const,
    anchors: [{ ...anchor, researched: false }],
    origin: 'Buenos Aires',
  };
  const input = planTripInput({ conversation: baseConversation('Mundial de rugby', null), startDate: null, shape: withAnchors, mode: 'menu', understanding });
  const parsed = PlanTripInput.safeParse(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  eq(parsed.data.skeleton?.anchors?.[0]?.date, '2027-10-09');
  eq(parsed.data.understanding?.trip_kind, 'event');
  eq(parsed.data.understanding?.anchors?.length, 1);
  eq(parsed.data.understanding?.origin, 'Buenos Aires');
});

// ───────────────────────── Texto libre, días a mano, calendario, rondas (feedback del celu)

const duration = q({
  id: 'days',
  dimension: 'duration',
  text: '¿Cuántos días se quedan?',
  options: [
    { value: 'week', label: 'Una semana' },
    { value: '10', label: '10 días' },
  ],
  default: 'week',
});
const when = q({
  id: 'when',
  dimension: 'dates',
  text: '¿Cuándo pensás ir?',
  kind: 'date',
  options: [{ value: 'flex', label: 'Soy flexible' }],
  default: null,
});

test('texto libre en single: reemplaza la opción; vacío la borra', () => {
  const v = setFreeText(q({}), 'balanced', 'Según el día');
  eq(v, FREE_PREFIX + 'Según el día');
  eq(isSelected(v, 'balanced'), false);
  eq(freeTextOf(v), 'Según el día');
  eq(answerText(q({}), v), 'Según el día');
  eq(setFreeText(q({}), v, '   '), '');
  eq(isAnswered(setFreeText(q({}), v, '')), false);
  // Elegir una opción después pisa el texto libre.
  eq(toggleAnswer(q({}), v, 'relaxed'), 'relaxed');
});

test('texto libre en multi: se suma a lo elegido y alternar opciones no lo toca', () => {
  let v = setFreeText(interests, ['food'], 'Vinos naturales');
  eq(v, ['food', FREE_PREFIX + 'Vinos naturales']);
  v = toggleAnswer(interests, v, 'walk');
  eq(answerText(interests, v), 'Comida, Vinos naturales, Caminar');
  v = setFreeText(interests, v, 'Vinos y quesos');
  eq(freeTextOf(v), 'Vinos y quesos');
  eq((v as string[]).filter((x) => x.startsWith(FREE_PREFIX)).length, 1);
  eq(isAnswered([FREE_PREFIX + '  ']), false);
});

test('días a mano en duración: "9 días", 1-60 y reemplaza la opción', () => {
  eq(isDurationQuestion(duration), true);
  eq(isDurationQuestion(q({})), false);
  const v = setDays(duration, 'week', 9);
  eq(v, DAYS_PREFIX + '9');
  eq(daysOf(v), 9);
  eq(answerText(duration, v), '9 días');
  eq(answerText(duration, setDays(duration, v, 1)), '1 día');
  eq(daysOf(setDays(duration, v, 200)), 60);
  eq(daysOf(setDays(duration, v, 0)), 1);
  eq(daysOf('week'), null);
});

test('pregunta de fecha: calendario (día o rango), opción o texto libre', () => {
  eq(answerText(when, '2027-10-24'), 'dom 24 oct (2027-10-24)');
  eq(answerText(when, '2027-10-24/2027-10-29'), 'dom 24 oct (2027-10-24) al vie 29 oct (2027-10-29), 6 días');
  eq(answerText(when, 'flex'), 'Soy flexible');
  eq(answerText(when, setFreeText(when, 'flex', 'Para las fiestas')), 'Para las fiestas');
});

test('withDateAnswer: un rango completa solo la duración', () => {
  const qs = [when, duration, q({})];
  const out = withDateAnswer(qs, { days: 'week', pace: 'relaxed' }, when, '2027-10-24/2027-10-29');
  eq(out, { days: DAYS_PREFIX + '6', pace: 'relaxed', when: '2027-10-24/2027-10-29' });
  // Un día solo (sin salida) no toca la duración.
  eq(withDateAnswer(qs, { days: 'week' }, when, '2027-10-24'), { days: 'week', when: '2027-10-24' });
});

test('effectiveStartDate / effectiveEndDate con rango de la pregunta y de Contame', () => {
  const a = { when: '2027-10-24/2027-10-29' };
  eq(effectiveStartDate(null, [when], a), '2027-10-24');
  eq(effectiveEndDate(null, null, [when], a), '2027-10-29');
  eq(effectiveEndDate('2027-11-01', '2027-11-05', [when], a), '2027-11-05');
  eq(effectiveEndDate('2027-11-01', '2027-10-05', [when], a), null);
  eq(effectiveEndDate(null, null, [when], { when: 'flex' }), null);
});

test('conversationWithAnswers: labels + texto libre separados por coma, con la marca [q:id/dimensión]', () => {
  const base = baseConversation('Lisboa', null);
  const answers = {
    interests: ['food', FREE_PREFIX + 'fado en vivo'],
    days: DAYS_PREFIX + '9',
    when: '2027-10-24/2027-10-29',
  };
  const conv = conversationWithAnswers(base, [interests, duration, when], answers);
  eq(conv.slice(2), [
    { role: 'assistant', text: '[q:interests/interests] ¿Qué les copa?' },
    { role: 'user', text: 'Comida, fado en vivo' },
    { role: 'assistant', text: '[q:days/duration] ¿Cuántos días se quedan?' },
    { role: 'user', text: '9 días' },
    { role: 'assistant', text: '[q:when/dates] ¿Cuándo pensás ir?' },
    { role: 'user', text: 'dom 24 oct (2027-10-24) al vie 29 oct (2027-10-29), 6 días' },
  ]);
  const parsed = TripBriefInput.safeParse({ conversation: conv, start_date: '2027-10-24', end_date: '2027-10-29', round: 4 });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
});

test('baseConversation con vuelta y días de Contame', () => {
  eq(baseConversation('Lisboa', '2027-10-24', { endDate: '2027-10-29', days: 6 }).slice(2), [
    { role: 'user', text: 'Fecha de inicio elegida: 2027-10-24' },
    { role: 'user', text: 'Fecha de vuelta elegida: 2027-10-29' },
    { role: 'user', text: 'Duración elegida: 6 días' },
  ]);
  // Sin fecha de inicio no va la vuelta; los días van igual.
  eq(baseConversation('Lisboa', null, { endDate: '2027-10-29', days: 9 }).slice(2), [{ role: 'user', text: 'Duración elegida: 9 días' }]);
});

test('planTripInput lleva end_date solo si es posterior al inicio', () => {
  const conv = baseConversation('Lisboa', '2027-10-24');
  const ok = planTripInput({ conversation: conv, startDate: '2027-10-24', endDate: '2027-10-29', shape: null, mode: 'auto' });
  eq(ok.end_date, '2027-10-29');
  eq(PlanTripInput.safeParse(ok).success, true);
  eq('end_date' in planTripInput({ conversation: conv, startDate: '2027-10-24', endDate: '2027-10-20', shape: null, mode: 'auto' }), false);
  eq('end_date' in planTripInput({ conversation: conv, startDate: null, endDate: '2027-10-29', shape: null, mode: 'auto' }), false);
});

test('roundLabel: "Ronda N · …" sin total fijo', () => {
  eq(roundLabel(1), 'Ronda 1 · lo básico');
  eq(roundLabel(2), 'Ronda 2 · repreguntas sobre lo que me contaste');
  eq(roundLabel(4), 'Ronda 4 · últimos detalles');
  eq(roundLabel(9).startsWith('Ronda 4'), true);
  eq(/ de \d/.test(roundLabel(2)), false);
});

test('respuestas viejas (persistidas antes del texto libre) siguen funcionando', () => {
  eq(answerText(q({}), 'relaxed'), 'Tranqui');
  eq(answerText(dates, '2026-10-24'), 'sáb 24 oct (2026-10-24)');
  eq(mergeRoundAnswers({ pace: FREE_PREFIX + 'x' }, [q({})], []), { pace: FREE_PREFIX + 'x' });
});

if (failures) {
  console.error(`\n${failures} test(s) fallaron`);
  process.exit(1);
}
console.log('\nTodo OK');
