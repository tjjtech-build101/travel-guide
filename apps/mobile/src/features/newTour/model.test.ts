// Tests del modelo de "Nuevo tour". `npx tsx src/features/newTour/model.test.ts` desde apps/mobile.
import type { TourInterviewQuestion } from '@build101/shared';
import { answerText, baseConversation, conversationWithAnswers, defaultAnswers, parseTradeoff, roundQuestions, toggleAnswer, understoodChips, wantsAnotherRound } from './model';


let failures = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function expect(a: unknown) {
  const eq = (b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperaba ${JSON.stringify(b)}\n    obtuve    ${JSON.stringify(a)}`);
  };
  return { toBe: eq, toEqual: eq, toHaveLength: (n: number) => { if ((a as unknown[]).length !== n) throw new Error(`esperaba largo ${n}, obtuve ${(a as unknown[]).length}`); } };
}

const q = (over: Partial<TourInterviewQuestion> = {}): TourInterviewQuestion => ({
  id: 'temas',
  dimension: 'themes',
  text: '¿Qué te copa?',
  why: '',
  kind: 'multi',
  options: [
    { value: 'historia', label: 'Historia' },
    { value: 'arq', label: 'Arquitectura' },
  ],
  default: ['historia'],
  optional: false,
  ...over,
});

console.log('newTour/model');
{
  it('conversación base con la duración', () => {
    expect(baseConversation('Algo de historia', 60)[0].text).toBe('Algo de historia\n(Tengo 1 hora.)');
  });
  it('defaults, toggle y texto de la respuesta con "otra cosa"', () => {
    const qq = q();
    const a = defaultAnswers([qq]);
    expect(a.temas).toEqual(['historia']);
    const v = toggleAnswer(qq, a.temas, 'arq');
    expect(answerText(qq, v, 'casas raras')).toBe('Historia, Arquitectura, casas raras');
    expect(toggleAnswer(q({ kind: 'single' }), 'historia', 'arq')).toBe('arq');
  });
  it('conversación con respuestas: pregunta del Scout + respuesta; sin responder no va', () => {
    const qs = [q(), q({ id: 'final', text: '¿Cómo terminamos?', kind: 'single', options: [{ value: 'view', label: 'Con vista' }], default: null })];
    const conv = conversationWithAnswers(baseConversation('hola', null), qs, { temas: ['arq'] }, {});
    expect(conv.map((t) => t.text)).toEqual(['hola', '¿Qué te copa?', 'Arquitectura']);
  });
  it('rondas: la última versión de una pregunta gana; otra ronda solo si no terminó', () => {
    const r = roundQuestions([{ questions: [q()] }, { questions: [q({ text: 'Nueva' })] }]);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('Nueva');
    expect(wantsAnotherRound({ done: false, questions: [q()] }, 1)).toBe(true);
    expect(wantsAnotherRound({ done: true, questions: [] }, 1)).toBe(false);
    expect(wantsAnotherRound({ done: false, questions: [q()] }, 4)).toBe(false);
  });
  it('chips de lo entendido y pros/contras', () => {
    const chips = understoodChips({ duration_min: 60, must_include: ['Portones Shopping'], avoid: [], themes: ['historia'], energy: 'tranqui', finish: 'view', food_stop: null, kids: [], indoor: null, familiarity: null, include_paid_entries: null, storyline: null, wishes: [] });
    expect(chips).toEqual(['1 hora', 'Sí o sí: Portones Shopping', 'historia', 'Tranqui', 'Termina con vista']);
    expect(parseTradeoff('− más caminata')).toEqual({ sign: '−', text: 'más caminata' });
  });
}

if (failures) {
  console.error(`\n${failures} fallaron`);
  process.exit(1);
}
console.log('\nTodo OK');
