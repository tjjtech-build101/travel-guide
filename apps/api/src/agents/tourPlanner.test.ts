import { describe, expect, it } from 'vitest';
import { emptyUsage } from './schemas';
import { composeTour, prepareTour } from './tourGenerator';
import { formatNearby, MAX_INTERVIEW_ROUNDS, runTourInterview, sanitizeQuestions, sanitizeUnderstanding, type InterviewOutputT } from './tourInterview';
import { brief, fakeDeps, fakeLlm, input, PLACES } from './tourTestKit';
import { buildVariants, planVariants, samePlan } from './tourVariants';

const u = emptyUsage();

const interviewOut = (over: Partial<InterviewOutputT> = {}): InterviewOutputT => ({
  summary: 'Querés una hora de historia y no perderte los Portones.',
  understood: { duration_min: 60, must_include: ['Portones Shopping'], avoid: [], themes: ['historia', 'inventado'], energy: null, finish: null, food_stop: null, kids: [], indoor: null, familiarity: null, include_paid_entries: null, storyline: null, wishes: ['historias de las quintas'] },
  context: ['Hoy no llueve'],
  questions: [
    { id: 'epoca', dimension: 'themes', text: '¿De qué época?', why: 'Para elegir historias', kind: 'single', options: [{ value: 'colonia', label: 'Colonia' }], default: null, optional: false },
    { id: 'epoca', dimension: 'themes', text: 'repetida', why: '', kind: 'single', options: [], default: null, optional: false },
    { id: 'abierta', dimension: 'expectations', text: '¿Qué esperás?', why: '', kind: 'multi', options: [], default: null, optional: true },
  ],
  done: false,
  coverage: Object.fromEntries(['expectations', 'must', 'avoid', 'themes', 'duration', 'group', 'energy', 'finish', 'food', 'kids', 'familiarity', 'indoor', 'storyline', 'other'].map((d) => [d, 'unknown'])) as InterviewOutputT['coverage'],
  ...over,
});

describe('tour_interview', () => {
  it('sanea lo entendido (temas válidos, duración) y las preguntas (sin repetidas; sin opciones → texto)', () => {
    const s = sanitizeUnderstanding(interviewOut().understood);
    expect(s.themes).toEqual(['historia']);
    expect(s.must_include).toEqual(['Portones Shopping']);
    const qs = sanitizeQuestions(interviewOut().questions, 1);
    expect(qs.map((q) => q.id)).toEqual(['epoca', 'abierta']);
    expect(qs[1].kind).toBe('text');
    expect(sanitizeQuestions(interviewOut().questions, MAX_INTERVIEW_ROUNDS)).toEqual([]);
  });

  it('ronda 1 con effort low, lugares cercanos en el prompt y contexto del grupo + extra', async () => {
    let seen = { user: '', effort: '' };
    const r = await runTourInterview(
      { start_lat: -34.9066, start_lng: -56.199, conversation: [{ role: 'user', text: 'Algo de historia' }], round: 1 },
      brief(),
      {
        llm: async ({ user, effort }) => {
          seen = { user, effort };
          return { value: interviewOut(), usage: u };
        },
        nearby: async () => ['Teatro Solís (a 150 m)'],
      },
    );
    expect(seen.effort).toBe('low');
    expect(seen.user).toMatch(/Teatro Solís \(a 150 m\)/);
    expect(seen.user).toMatch(/PERSONA: Algo de historia/);
    expect(r.nearby).toEqual(['Teatro Solís']);
    expect(r.context).toContain('Hoy no llueve');
    expect(r.done).toBe(false);
  });

  it('ronda 4: siempre termina', async () => {
    const r = await runTourInterview({ start_lat: 0, start_lng: 0, conversation: [{ role: 'user', text: 'x' }], round: 4 }, brief(), { llm: async () => ({ value: interviewOut(), usage: u }), nearby: async () => [] });
    expect(r.done).toBe(true);
    expect(r.questions).toEqual([]);
  });

  it('formatNearby: por distancia, sin repetir', () => {
    const out = formatNearby({ lat: -34.9066, lng: -56.199 }, [...PLACES, PLACES[0]].map((p) => ({ name: p.name, lat: p.lat, lng: p.lng })), 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^Plaza Independencia \(a 0 m\)$/);
  });
});

describe('tour_variants', () => {
  it('arma 2-3 recorridos distintos sobre los mismos candidatos, con nombres de Claude y una sola recomendada', async () => {
    const deps = fakeDeps(fakeLlm());
    const prep = await prepareTour({ input: input({ duration_min: 30 }), brief: brief(), progress: () => {}, startedAt: Date.now() }, deps);
    const plans = planVariants(prep, sanitizeUnderstanding({}));
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) expect(samePlan(plans[i].plan.keys, plans[j].plan.keys)).toBe(false);
    const r = await buildVariants(prep, sanitizeUnderstanding({}), 'Persona: historia', {
      llm: async ({ user }) => ({
        usage: u,
        value: { variants: [...user.matchAll(/### Variante (\w)/g)].map((m, i) => ({ id: m[1], label: `Opción ${m[1]}`, title: 'Título', pitch: 'Pitch', tradeoffs: ['+ algo', '− otra'], recommended: i === 1, stop_why: [] })) },
      }),
      summaries: async () => new Map(),
    });
    expect(r.variants.length).toBe(plans.length);
    expect(r.variants.filter((v) => v.recommended)).toHaveLength(1);
    expect(r.variants[0].label).toBe('Opción A');
    expect(r.variants[0].stops.length).toBeGreaterThanOrEqual(3);
  });

  it('si Claude falla, quedan nombres por defecto', async () => {
    const prep = await prepareTour({ input: input({ duration_min: 30 }), brief: brief(), progress: () => {}, startedAt: Date.now() }, fakeDeps(fakeLlm()));
    const r = await buildVariants(prep, sanitizeUnderstanding({}), '', { llm: async () => Promise.reject(new Error('sin crédito')), summaries: async () => new Map() });
    expect(r.variants[0].label).toBe('Lo esencial');
    expect(r.variants.filter((v) => v.recommended)).toHaveLength(1);
  });

  it('generate_tour con variant_stops: el tour tiene exactamente esas paradas', async () => {
    const chosen = [PLACES[5], PLACES[3], PLACES[1]].map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
    const t = await composeTour({ input: input({ duration_min: 60, variant_stops: chosen }), brief: brief(), progress: () => {}, startedAt: Date.now() }, fakeDeps(fakeLlm()));
    expect(t.stops.map((s) => s.candidate.name).sort()).toEqual(chosen.map((c) => c.name).sort());
  });
});
