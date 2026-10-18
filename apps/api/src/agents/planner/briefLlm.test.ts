import { describe, expect, it, vi } from 'vitest';
import { toolDefs } from '@build101/shared';
import { ToolFailure } from '../../errors';
import { emptyUsage } from '../schemas';
import { type BriefDeps, type BriefLLM, holidayLines, seasonLine, tripBrief, tripShapes } from './briefLlm';
import type { BriefOutputT, ShapeVariantT } from './briefPrompts';
import { ctxFor, FakeDb, seedTrip, U } from './orchestrationTestKit';

const understood = (over: Partial<BriefOutputT['understood']> = {}): BriefOutputT['understood'] => ({
  destinations: [{ city: 'Montevideo', country: 'Uruguay' }, { city: 'Buenos Aires', country: 'Argentina' }],
  start_date: '2026-10-24',
  end_date: null,
  days: 5,
  travelers: null,
  party: 'friends',
  names: ['Sofi'],
  interests: [{ tag: 'comida', weight: 7 }, { tag: 'arte', weight: 3 }],
  must: ['Mercado del Puerto'],
  avoid: ['boliches'],
  budget: null,
  pace: null,
  first_time: null,
  kids_ages: [],
  arrival: null,
  departure: null,
  lodging_booked: null,
  notes: [],
  ...over,
});

const q = (id: BriefOutputT['questions'][number]['id'], over: Partial<BriefOutputT['questions'][number]> = {}) => ({
  id,
  text: `¿${id}?`,
  why: 'Porque cambia el plan',
  kind: 'single' as const,
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  default_values: ['a'],
  optional: false,
  ...over,
});

function deps(llm: Partial<BriefLLM>, warm: BriefDeps['warm'] = null): BriefDeps {
  return {
    llm: {
      brief: async () => ({ value: { summary: 'x', understood: understood(), questions: [] }, usage: emptyUsage() }),
      shapes: async () => ({ value: { variants: [] }, usage: emptyUsage() }),
      ...llm,
    },
    today: () => '2026-10-17',
    warm,
    timeoutMs: 2000,
  };
}

const conversation = [{ role: 'user' as const, text: 'Montevideo y Buenos Aires con Sofi, 5 días desde el 24, mucha comida' }];

describe('trip_brief', () => {
  it('input: conversación obligatoria', () => {
    expect(toolDefs.trip_brief.input.safeParse({ conversation }).success).toBe(true);
    expect(toolDefs.trip_brief.input.safeParse({ conversation: [] }).success).toBe(false);
  });

  it('nunca pregunta lo que ya dijo, máx. 4, contexto determinístico y precalienta el catálogo', async () => {
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    const warm = vi.fn();
    let userMsg = '';
    const r = await tripBrief({ trip_id: tripId, conversation }, ctxFor(fake, U.juan), deps(
      {
        brief: async ({ user, config }) => {
          userMsg = user;
          expect(config.effort).toBe('low');
          return {
            value: {
              summary: ' Entendí: 5 días entre Montevideo y Buenos Aires. ',
              understood: understood(),
              questions: [
                q('dates'), // ya dijo la fecha → afuera
                q('duration'), // ya dijo 5 días → afuera
                q('arrival', { kind: 'single', options: [{ value: 'x', label: 'X' }] }), // 1 opción → text
                q('lodging', { default_values: ['zzz'] }), // default inválido → null
                q('budget'),
                q('pace', { kind: 'multi', default_values: ['a', 'b'] }),
                q('first_time'),
                q('kids'), // quinta válida → afuera por el tope
              ],
            },
            usage: emptyUsage(),
          };
        },
      },
      warm,
    ));
    expect(userMsg).toContain('Próximo sábado: 2026-10-24');
    expect(userMsg).toContain('Juan (organizador)');
    expect(r.summary).toBe('Entendí: 5 días entre Montevideo y Buenos Aires.');
    expect(r.questions.map((x) => x.id)).toEqual(['arrival', 'lodging', 'budget', 'pace']);
    expect(r.questions[0]).toMatchObject({ kind: 'text', default: null });
    expect(r.questions[1].default).toBeNull();
    expect(r.questions[2].default).toBe('a');
    expect(r.questions[3].default).toEqual(['a', 'b']);
    expect(r.understood.interests).toEqual({ comida: 5, arte: 3 });
    expect(r.understood.start_date).toBe('2026-10-24');
    expect(r.ready).toBe(true);
    expect(r.context).toContain('Viajan 3 en la app: Juan, Sofía, Leo.');
    expect(r.context).toContain('En octubre en Montevideo es primavera.');
    expect(r.context).toContain('Ya estoy investigando Buenos Aires.');
    expect(r.context.some((c) => c.includes('vegetariana'))).toBe(true);
    expect(warm).toHaveBeenCalledWith(fake.db, [
      { city: 'Montevideo', country: 'Uruguay' },
      { city: 'Buenos Aires', country: 'Argentina' },
    ]);
  });

  it('sin destino: no está listo y no precalienta', async () => {
    const warm = vi.fn();
    const r = await tripBrief({ conversation: [{ role: 'user', text: 'quiero viajar' }] }, ctxFor(new FakeDb(), U.juan), deps(
      {
        brief: async () => ({
          value: { summary: 'Contame a dónde.', understood: understood({ destinations: [], start_date: null, days: null }), questions: [q('other', { kind: 'text', options: [] })] },
          usage: emptyUsage(),
        }),
      },
      warm,
    ));
    expect(r.ready).toBe(false);
    expect(r.questions.map((x) => x.id)).toEqual(['other']);
    expect(warm).not.toHaveBeenCalled();
  });

  it('las fechas del selector pisan a las del modelo; fechas inválidas → null', async () => {
    const r = await tripBrief({ conversation, start_date: '2026-11-01' }, ctxFor(new FakeDb(), U.juan), deps({
      brief: async () => ({ value: { summary: 's', understood: understood({ start_date: '2026-10-24', end_date: '24/10' }), questions: [] }, usage: emptyUsage() }),
    }));
    expect(r.understood.start_date).toBe('2026-11-01');
    expect(r.understood.end_date).toBeNull();
  });

  it('timeout → 504 legible', async () => {
    const d = deps({ brief: (a) => new Promise((_, rej) => a.signal?.addEventListener('abort', () => rej(new Error('aborted')))) });
    d.timeoutMs = 20;
    await expect(tripBrief({ conversation }, ctxFor(new FakeDb(), U.juan), d)).rejects.toMatchObject({ status: 504, code: 'timeout' });
  });

  it('temporada y feriados solo si se saben', () => {
    expect(seasonLine({ city: 'Lisboa', country: 'Portugal' }, '2026-07-10')).toBe('En julio en Lisboa es verano.');
    expect(seasonLine({ city: 'Ciudad de México', country: 'México' }, '2026-07-10')).toBeNull();
    expect(seasonLine({ city: 'X', country: null }, '2026-07-10')).toBeNull();
    expect(holidayLines('2026-12-20', '2027-01-02')).toHaveLength(2);
    expect(holidayLines('2026-10-17', '2026-10-24')).toEqual([]);
  });
});

const legs = (mvdEnd = '2026-10-26'): ShapeVariantT['legs'] => [
  { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-24', end_date: mvdEnd, includes_organizer: true, participant_names: [], parallel_with: [], why: 'Arranque' },
  { key: 'bsas', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-27', end_date: '2026-10-28', includes_organizer: true, participant_names: [], parallel_with: [], why: '' },
];
const variant = (label: string, over: Partial<ShapeVariantT> = {}): ShapeVariantT => ({
  label,
  pitch: `${label} en una frase`,
  tradeoffs: ['+ algo', '− otra'],
  recommended: false,
  title: 'Montevideo + Buenos Aires',
  start_date: '2026-10-24',
  end_date: '2026-10-28',
  legs: legs(),
  transfers: [{ from_key: 'mvd', to_key: 'bsas', date: '2026-10-27', mode: 'ferry', duration_min: 180, participant_names: [] }],
  assumptions: [],
  ...over,
});

describe('trip_shapes', () => {
  it('valida con normalizeSkeleton, descarta inválidas y duplicadas, deja una recomendada', async () => {
    const r = await tripShapes({ conversation }, ctxFor(new FakeDb(), U.juan), deps({
      shapes: async ({ config }) => {
        expect(config.effort).toBe('medium');
        return {
          value: {
            variants: [
              variant('Equilibrado'),
              variant('Roto', { legs: [{ ...legs()[0], start_date: '24/10' }] }),
              variant('Copia', { recommended: true }), // mismos tramos y fechas que Equilibrado
              variant('Más Montevideo', { legs: legs('2026-10-27').map((l) => (l.key === 'bsas' ? { ...l, start_date: '2026-10-28' } : l)), recommended: true }),
              variant('Lento', { legs: [legs()[0]], transfers: [] }),
              variant('Cuarta', { legs: [{ ...legs()[1], start_date: '2026-10-24' }], transfers: [] }),
            ],
          },
          usage: emptyUsage(),
        };
      },
    }));
    expect(r.variants.map((v) => v.label)).toEqual(['Equilibrado', 'Más Montevideo', 'Lento']);
    expect(r.variants.filter((v) => v.recommended).map((v) => v.label)).toEqual(['Más Montevideo']);
    expect(r.variants[0]).toMatchObject({ id: 's1', start_date: '2026-10-24', end_date: '2026-10-28' });
    expect(r.variants[0].legs[0]).toMatchObject({ key: 'mvd', why: 'Arranque' });
    expect(r.variants[0].transfers[0]).toMatchObject({ from_key: 'mvd', to_key: 'bsas', mode: 'ferry', participant_names: [] });
    // La forma elegida entra tal cual a plan_trip
    const parsed = toolDefs.plan_trip.input.safeParse({ conversation, skeleton: r.variants[1], mode: 'menu' });
    expect(parsed.success).toBe(true);
  });

  it('sin variantes válidas → error legible', async () => {
    const p = tripShapes({ conversation }, ctxFor(new FakeDb(), U.juan), deps({
      shapes: async () => ({ value: { variants: [variant('Roto', { legs: [] })] }, usage: emptyUsage() }),
    }));
    await expect(p).rejects.toBeInstanceOf(ToolFailure);
    await expect(p).rejects.toMatchObject({ code: 'shapes_failed' });
  });
});
