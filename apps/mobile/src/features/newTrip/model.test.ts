// Tests del modelo de "Nuevo viaje" (PRD 31). `npx tsx src/features/newTrip/model.test.ts` desde apps/mobile.
import { PlanTripInput, type TripQuestion, type TripShape } from '@build101/shared';

import {
  answerText,
  baseConversation,
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
  text: '¿Qué les copa?',
  kind: 'multi',
  options: [
    { value: 'food', label: 'Comida' },
    { value: 'walk', label: 'Caminar' },
    { value: 'museums', label: 'Museos' },
  ],
  default: ['food'],
});
const must = q({ id: 'must', text: '¿Algo sí o sí?', kind: 'text', options: [], default: null, optional: true });
const dates = q({ id: 'dates', text: '¿Cuándo arrancan?', kind: 'date', options: [], default: null });

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
    { role: 'assistant', text: '¿Qué ritmo?' },
    { role: 'user', text: 'Tranqui' },
    { role: 'assistant', text: '¿Qué les copa?' },
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

if (failures) {
  console.error(`\n${failures} test(s) fallaron`);
  process.exit(1);
}
console.log('\nTodo OK');
