import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolDefs, type TripAnchor } from '@build101/shared';
import { ToolFailure } from '../../errors';
import { emptyUsage } from '../schemas';
import { clearAnchorCache } from './anchors';
import {
  type BriefDeps,
  type BriefLLM,
  clearIssuedQuestions,
  clearUnderstandingCache,
  holidayLines,
  parseAskedQuestions,
  type ResearchFn,
  seasonLine,
  type ShapesDeps,
  tripBrief,
  tripShapes,
} from './briefLlm';
import { type BriefOutputT, questionMessage, type ShapeVariantT } from './briefPrompts';
import { ctxFor, FakeDb, seedTrip, U } from './orchestrationTestKit';

type Q = BriefOutputT['questions'][number];

const understood = (over: Partial<BriefOutputT['understood']> = {}): BriefOutputT['understood'] => ({
  destinations: [{ city: 'Montevideo', country: 'Uruguay' }, { city: 'Buenos Aires', country: 'Argentina' }],
  start_date: '2026-10-24',
  end_date: '',
  days: 5,
  travelers: 0,
  party: 'friends',
  names: ['Sofi'],
  interests: [{ tag: 'comida', weight: 7 }, { tag: 'arte', weight: 3 }],
  must: ['Mercado del Puerto'],
  avoid: ['boliches'],
  budget: '',
  pace: '',
  first_time: 'unknown',
  kids_ages: [],
  arrival: '',
  departure: '',
  lodging_booked: '',
  notes: [],
  trip_kind: '',
  anchors: [],
  origin: '',
  ...over,
});

const q = (id: string, over: Partial<Q> = {}): Q => ({
  id,
  dimension: id as Q['dimension'],
  text: `¿${id}?`,
  why: 'Porque cambia el plan',
  kind: 'single',
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
  default_values: ['a'],
  optional: false,
  ...over,
});

const out = (over: Partial<BriefOutputT> = {}): BriefOutputT => ({ summary: 'x', understood: understood(), coverage: '', questions: [], done: false, ...over });

function deps(llm: Partial<BriefLLM>, warm: BriefDeps['warm'] = null, research: ResearchFn | null = null): BriefDeps & ShapesDeps {
  return {
    llm: {
      brief: async () => ({ value: out(), usage: emptyUsage() }),
      shapes: async () => ({ value: { variants: [] }, usage: emptyUsage() }),
      ...llm,
    },
    today: () => '2026-10-17',
    warm,
    timeoutMs: 2000,
    research,
    warmAnchors: false,
  };
}

const conversation = [{ role: 'user' as const, text: 'Montevideo y Buenos Aires con Sofi, 5 días desde el 24, mucha comida' }];

beforeEach(() => {
  clearUnderstandingCache();
  clearIssuedQuestions();
  clearAnchorCache();
});

describe('trip_brief', () => {
  it('input: conversación obligatoria y round 1-3', () => {
    expect(toolDefs.trip_brief.input.safeParse({ conversation }).success).toBe(true);
    expect(toolDefs.trip_brief.input.safeParse({ conversation, round: 2 }).success).toBe(true);
    expect(toolDefs.trip_brief.input.safeParse({ conversation, round: 4 }).success).toBe(false);
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
            value: out({
              summary: ' Entendí: 5 días entre Montevideo y Buenos Aires. ',
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
            }),
            usage: emptyUsage(),
          };
        },
      },
      warm,
    ));
    expect(userMsg).toContain('Próximo sábado: 2026-10-24');
    expect(userMsg).toContain('Juan (organizador)');
    expect(userMsg).toContain('Ronda 1 de 3');
    expect(r.summary).toBe('Entendí: 5 días entre Montevideo y Buenos Aires.');
    expect(r.questions.map((x) => x.id)).toEqual(['arrival', 'lodging', 'budget', 'pace']);
    expect(r.questions[0]).toMatchObject({ kind: 'text', default: null, options: [], dimension: 'arrival' });
    expect(r.questions[1].default).toBeNull();
    expect(r.questions[2].default).toBe('a');
    expect(r.questions[3].default).toEqual(['a', 'b']);
    expect(r.understood.interests).toEqual({ comida: 5, arte: 3 });
    expect(r.understood.start_date).toBe('2026-10-24');
    expect(r).toMatchObject({ ready: true, round: 1, done: false });
    expect(r.coverage).toMatchObject({ dates: 'known', duration: 'known', must: 'known' });
    expect(r.context).toContain('Viajan 3 en la app: Juan, Sofía, Leo.');
    expect(r.context).toContain('En octubre en Montevideo es primavera.');
    expect(r.context).toContain('Ya estoy investigando Buenos Aires.');
    expect(r.context.some((c) => c.includes('vegetariana'))).toBe(true);
    expect(warm).toHaveBeenCalledWith(fake.db, [
      { city: 'Montevideo', country: 'Uruguay' },
      { city: 'Buenos Aires', country: 'Argentina' },
    ]);
  });

  it('opciones: dedupe por value y tope de 6; ids normalizados', async () => {
    const r = await tripBrief({ conversation }, ctxFor(new FakeDb(), U.juan), deps({
      brief: async () => ({
        value: out({
          questions: [
            q('Extras Australia!', {
              dimension: 'extras',
              kind: 'multi',
              options: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((v) => ({ value: v, label: v.toUpperCase() })),
              default_values: ['a', 'g'],
            }),
          ],
        }),
        usage: emptyUsage(),
      }),
    }));
    expect(r.questions[0].id).toBe('extras_australia');
    expect(r.questions[0].options.map((o) => o.value)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.questions[0].default).toEqual(['a']);
  });

  it('sin destino: no está listo, no termina y no precalienta', async () => {
    const warm = vi.fn();
    const r = await tripBrief({ conversation: [{ role: 'user', text: 'quiero viajar' }], round: 3 }, ctxFor(new FakeDb(), U.juan), deps(
      {
        brief: async () => ({
          value: out({ summary: 'Contame a dónde.', understood: understood({ destinations: [], start_date: '', days: 0 }), questions: [q('where', { dimension: 'other', kind: 'text', options: [] })] }),
          usage: emptyUsage(),
        }),
      },
      warm,
    ));
    expect(r.ready).toBe(false);
    expect(r.done).toBe(false);
    expect(r.questions.map((x) => x.id)).toEqual(['where']);
    expect(warm).not.toHaveBeenCalled();
  });

  it('las fechas del selector pisan a las del modelo; fechas inválidas → null', async () => {
    const r = await tripBrief({ conversation, start_date: '2026-11-01' }, ctxFor(new FakeDb(), U.juan), deps({
      brief: async () => ({ value: out({ summary: 's', understood: understood({ start_date: '2026-10-24', end_date: '24/10' }) }), usage: emptyUsage() }),
    }));
    expect(r.understood.start_date).toBe('2026-11-01');
    expect(r.understood.end_date).toBeNull();
  });

  it('sin preguntas que hacer → done', async () => {
    const r = await tripBrief({ conversation }, ctxFor(new FakeDb(), U.juan), deps({}));
    expect(r).toMatchObject({ done: true, questions: [] });
  });

  it('timeout → 504 legible', async () => {
    const d = deps({ brief: (a) => new Promise((_, rej) => a.signal?.addEventListener('abort', () => rej(new Error('aborted')))) });
    d.timeoutMs = 20;
    await expect(tripBrief({ conversation }, ctxFor(new FakeDb(), U.juan), d)).rejects.toMatchObject({ status: 504, code: 'timeout' });
  });

  it('temporada y feriados solo si se saben', () => {
    expect(seasonLine({ city: 'Lisboa', country: 'Portugal' }, '2026-07-10')).toBe('En julio en Lisboa es verano.');
    expect(seasonLine({ city: 'Ciudad de México', country: 'México' }, '2026-07-10')).toBeNull();
    expect(seasonLine({ city: 'X', country: '' }, '2026-07-10')).toBeNull();
    expect(holidayLines('2026-12-20', '2027-01-02')).toHaveLength(2);
    expect(holidayLines('2026-10-17', '2026-10-24')).toEqual([]);
  });
});

describe('preguntas ya hechas en la conversación', () => {
  it('reconoce el formato [q:id/dimension] y el formato v1 (solo texto), ignora el saludo', () => {
    const asked = parseAskedQuestions([
      { role: 'assistant', text: '¡Buenas! Contame el viaje: a dónde, cuándo, con quién y qué les copa.' },
      { role: 'user', text: 'Australia, mundial de rugby' },
      { role: 'assistant', text: questionMessage({ id: 'team', dimension: 'anchor', text: '¿A quién siguen?' }) },
      { role: 'user', text: 'Los Pumas' },
      { role: 'assistant', text: '[q:phase] ¿Qué fase?' },
      { role: 'user', text: 'Desde grupos' },
      { role: 'assistant', text: '¿Cuántos son?' },
      { role: 'user', text: '4-6' },
    ]);
    expect(asked).toEqual([
      { id: 'team', dimension: 'anchor', text: '¿A quién siguen?', answer: 'Los Pumas' },
      { id: 'phase', dimension: null, text: '¿Qué fase?', answer: 'Desde grupos' },
      { id: null, dimension: null, text: '¿Cuántos son?', answer: '4-6' },
    ]);
  });
});

// ───────────────────────── Caso real: Mundial de Rugby 2027

const mundialStory = 'Me quiero ir a Australia con amigos a ver el mundial de rugby de 2027';
const mundialAnchor = { id: 'mundial-rugby-2027', name: 'Mundial de Rugby 2027', kind: 'sports' as const, city: '', country: 'Australia', date: '', tickets: 'unknown' as const, note: '' };
const mundialUnderstood = (over: Partial<BriefOutputT['understood']> = {}) =>
  understood({
    destinations: [{ city: 'Australia', country: 'Australia' }],
    start_date: '',
    days: 0,
    names: [],
    interests: [],
    must: [],
    avoid: [],
    trip_kind: 'event',
    anchors: [mundialAnchor],
    ...over,
  });

const researchedAnchors: TripAnchor[] = [
  { id: 'arg-g1', name: 'Argentina vs Australia (grupos)', kind: 'sports', city: 'Perth', country: 'Australia', date: '2027-10-02', time: '19:00', venue: 'Perth Stadium', tickets: 'want', researched: true, sources: [{ url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' }], note: '' },
  { id: 'arg-g2', name: 'Argentina vs Samoa (grupos)', kind: 'sports', city: 'Sydney', country: 'Australia', date: '2027-10-09', time: '17:00', venue: 'Accor Stadium', tickets: 'want', researched: true, sources: [{ url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' }], note: '' },
  { id: 'cuartos', name: 'Cuartos de final', kind: 'sports', city: 'Sydney', country: 'Australia', date: '2027-10-23', time: null, venue: null, tickets: 'want', researched: true, sources: [{ url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' }], note: 'El cruce de cuartos depende de cómo termine el grupo.' },
];

const auLeg = (key: string, city: string, start: string, end: string) => ({ key, city, country: 'Australia', start_date: start, end_date: end, includes_organizer: true, participant_names: [], parallel_with: [], why: '' });
const auVariant = (label: string, over: Partial<ShapeVariantT> = {}): ShapeVariantT => ({
  label,
  pitch: `${label} en una frase`,
  tradeoffs: ['+ ves los partidos de los Pumas', '− te perdés la final'],
  recommended: false,
  title: 'Mundial con los Pumas',
  start_date: '2027-10-01',
  end_date: '2027-10-24',
  legs: [auLeg('per', 'Perth', '2027-10-01', '2027-10-04'), auLeg('gc', 'Gold Coast', '2027-10-05', '2027-10-07'), auLeg('syd', 'Sydney', '2027-10-08', '2027-10-24')],
  transfers: [
    { from_key: 'per', to_key: 'gc', date: '2027-10-05', mode: 'flight', duration_min: 330, participant_names: [] },
    { from_key: 'gc', to_key: 'syd', date: '2027-10-08', mode: 'flight', duration_min: 90, participant_names: [] },
  ],
  assumptions: ['Llegan desde Buenos Aires: el primer día va liviano.'],
  anchor_ids: ['arg-g1', 'arg-g2', 'cuartos'],
  ...over,
});

describe('entrevista en rondas: Mundial de Rugby 2027', () => {
  it('ronda 1 → 2 → 3: no repite lo ya preguntado, máx. 4, effort según ronda, done en la 3; después formas con anclas', async () => {
    const calls: { round: string; effort: string; user: string }[] = [];
    const research = vi.fn<ResearchFn>(async () => ({ anchors: researchedAnchors, researched: true, notes: ['El cruce de cuartos depende del grupo.'], event: 'Rugby World Cup 2027' }));
    let shapesUser = '';
    const llm: BriefLLM = {
      brief: async ({ user, config }) => {
        const round = /Ronda (\d) de 3/.exec(user)?.[1] ?? 'understand';
        calls.push({ round, effort: config.effort, user });
        if (round === '1') {
          return {
            value: out({
              summary: 'Entendí: Mundial de Rugby 2027 en Australia con amigos.',
              understood: mundialUnderstood(),
              coverage: 'anchor=unknown, travelers=unknown',
              questions: [
                q('team', { dimension: 'anchor', text: '¿A quién siguen en el Mundial?', options: [{ value: 'pumas', label: 'Los Pumas' }, { value: 'teros', label: 'Los Teros' }, { value: 'neutral', label: 'Neutrales' }], default_values: ['pumas'] }),
                q('phase', { dimension: 'anchor', text: '¿Qué parte del Mundial quieren ver?', options: [{ value: 'groups', label: 'Grupos siguiendo al equipo' }, { value: 'qf_final', label: 'De cuartos a la final' }, { value: 'final', label: 'Solo la final' }] }),
                q('tickets', { dimension: 'anchor', text: '¿Ya tienen entradas?', options: [{ value: 'have', label: 'Sí' }, { value: 'want', label: 'Todavía no' }] }),
                q('group_size', { dimension: 'travelers', text: '¿Cuántos son?', options: [{ value: '2-3', label: '2-3' }, { value: '4-6', label: '4-6' }] }),
                q('origin', { text: '¿Desde dónde salen?' }), // quinta → afuera
              ],
              done: false,
            }),
            usage: emptyUsage(),
          };
        }
        if (round === '2') {
          return {
            value: out({
              summary: 'Siguen a los Pumas desde grupos, son 5.',
              understood: mundialUnderstood({ travelers: 5, anchors: [{ ...mundialAnchor, name: 'Partidos de los Pumas en el Mundial de Rugby 2027', tickets: 'want', note: 'desde grupos' }] }),
              questions: [
                q('team', { dimension: 'anchor', text: '¿A quién siguen?' }), // mismo id → afuera
                q('fase', { dimension: 'anchor', text: '¿Qué parte del Mundial quieren ver?' }), // mismo texto → afuera
                q('cuantos', { dimension: 'travelers', text: '¿Cuántos viajan?' }), // travelers ya preguntado → afuera
                q('origin', { text: '¿Desde dónde salen?', options: [{ value: 'bue', label: 'Buenos Aires' }, { value: 'mvd', label: 'Montevideo' }] }),
                q('budget_pp', { dimension: 'budget', text: 'Presupuesto por persona, sin vuelos' }),
                q('transport', { text: '¿Cómo se mueven entre sedes?', options: [{ value: 'flights', label: 'Vuelos internos' }, { value: 'campervan', label: 'Campervan' }] }),
                q('extras', { kind: 'multi', text: 'Además del rugby, ¿qué les copa?', options: [{ value: 'reef', label: 'Gran Barrera de Coral' }, { value: 'gor', label: 'Great Ocean Road' }, { value: 'surf', label: 'Gold Coast y surf' }] }),
              ],
              done: false,
            }),
            usage: emptyUsage(),
          };
        }
        if (round === '3') {
          return {
            value: out({
              summary: 'Listo: Pumas desde grupos, 5 amigos desde Buenos Aires, vuelos internos.',
              understood: mundialUnderstood({ travelers: 5, origin: 'Buenos Aires', budget: 'mid', anchors: [{ ...mundialAnchor, name: 'Partidos de los Pumas en el Mundial de Rugby 2027', tickets: 'want', note: 'desde grupos' }] }),
              questions: [q('pace', { optional: true })],
              done: false,
            }),
            usage: emptyUsage(),
          };
        }
        throw new Error('no debería re-extraer: lo entendido está cacheado');
      },
      shapes: async ({ user }) => {
        shapesUser = user;
        return {
          value: {
            variants: [
              auVariant('Siguiendo a los Pumas', { recommended: true }),
              auVariant('Grupos + costa', {
                end_date: '2027-10-15',
                legs: [auLeg('per', 'Perth', '2027-10-01', '2027-10-04'), auLeg('syd', 'Sydney', '2027-10-05', '2027-10-15')],
                transfers: [{ from_key: 'per', to_key: 'syd', date: '2027-10-05', mode: 'flight', duration_min: 300, participant_names: [] }],
                anchor_ids: ['arg-g1', 'arg-g2', 'cuartos'], // cuartos (23/10) queda fuera de las fechas → no se asigna
                tradeoffs: ['+ dos partidos y playa', '− te perdés los cuartos'],
              }),
            ],
          },
          usage: emptyUsage(),
        };
      },
    };
    const d = deps(llm, null, research);
    const ctx = ctxFor(new FakeDb(), U.juan);

    // Ronda 1
    const conv1 = [{ role: 'user' as const, text: mundialStory }];
    const r1 = await tripBrief({ conversation: conv1 }, ctx, d);
    expect(r1.round).toBe(1);
    expect(r1.done).toBe(false);
    expect(r1.questions.map((x) => x.id)).toEqual(['team', 'phase', 'tickets', 'group_size']);
    expect(r1.questions[0]).toMatchObject({ dimension: 'anchor', default: 'pumas' });
    expect(r1.understood.trip_kind).toBe('event');
    expect(r1.understood.anchors).toEqual([expect.objectContaining({ id: 'mundial-rugby-2027', researched: false, sources: [], date: null })]);
    expect(r1.context.some((c) => c.includes('Mundial de Rugby 2027'))).toBe(true);
    expect(research).not.toHaveBeenCalled();

    // Ronda 2: mobile manda team con marca y el resto en formato v1 (solo el texto).
    const conv2 = [
      ...conv1,
      { role: 'assistant' as const, text: questionMessage(r1.questions[0]) },
      { role: 'user' as const, text: 'Los Pumas' },
      { role: 'assistant' as const, text: r1.questions[1].text },
      { role: 'user' as const, text: 'Grupos siguiendo al equipo' },
      { role: 'assistant' as const, text: r1.questions[3].text },
      { role: 'user' as const, text: '4-6' },
    ];
    const r2 = await tripBrief({ conversation: conv2, round: 2 }, ctx, d);
    expect(calls[1]).toMatchObject({ round: '2', effort: 'medium' });
    expect(calls[1].user).toContain('Ya preguntado');
    expect(calls[1].user).toContain('[team · anchor] ¿A quién siguen en el Mundial? → Los Pumas');
    expect(calls[1].user).toContain('[group_size · travelers]');
    expect(r2.questions.map((x) => x.id)).toEqual(['origin', 'budget_pp', 'transport', 'extras']);
    expect(r2.done).toBe(false);
    expect(r2.coverage?.travelers).toBe('known');

    // Ronda 3: done siempre.
    const conv3 = [
      ...conv2,
      ...r2.questions.flatMap((x) => [
        { role: 'assistant' as const, text: questionMessage(x) },
        { role: 'user' as const, text: x.options[0]?.label ?? 'no sé' },
      ]),
    ];
    const r3 = await tripBrief({ conversation: conv3, round: 3 }, ctx, d);
    expect(calls[2]).toMatchObject({ round: '3', effort: 'medium' });
    expect(r3).toMatchObject({ round: 3, done: true });
    expect(r3.understood.origin).toBe('Buenos Aires');

    // Formas: lo entendido viene de la cache (no re-extrae) y se arman alrededor de las anclas investigadas.
    const shapes = await tripShapes({ conversation: conv3 }, ctx, d);
    expect(calls.map((c) => c.round)).toEqual(['1', '2', '3']);
    expect(research).toHaveBeenCalledTimes(1);
    expect(research.mock.calls[0][0].anchors?.[0].name).toBe('Partidos de los Pumas en el Mundial de Rugby 2027');
    expect(shapesUser).toContain('ANCLAS del viaje');
    expect(shapesUser).toContain('[arg-g1] Argentina vs Australia (grupos) · 2027-10-02 19:00 · Perth Stadium, Perth, Australia');
    expect(shapesUser).toContain('https://www.rugbyworldcup.com/2027/fixtures');
    expect(shapesUser).toContain('salen desde: Buenos Aires');
    expect(shapes.variants.map((v) => v.label)).toEqual(['Siguiendo a los Pumas', 'Grupos + costa']);
    expect(shapes.variants[0].anchors?.map((a) => a.id)).toEqual(['arg-g1', 'arg-g2', 'cuartos']);
    expect(shapes.variants[1].anchors?.map((a) => a.id)).toEqual(['arg-g1', 'arg-g2']);
    expect(shapes.variants[0].tradeoffs).toContain('+ ves los partidos de los Pumas');
    expect(shapes.variants[0].assumptions.some((a) => a.includes('No pude verificar'))).toBe(false);
    // La forma elegida (con anclas) entra tal cual a plan_trip.
    expect(toolDefs.plan_trip.input.safeParse({ conversation: conv3, skeleton: shapes.variants[0], mode: 'menu' }).success).toBe(true);
  });

  it('investigación que falla → formas igual, sin anclas verificadas y lo dice en assumptions', async () => {
    let briefCalls = 0;
    const research = vi.fn<ResearchFn>(async () => {
      throw new Error('web caída');
    });
    const d = deps(
      {
        brief: async ({ user }) => {
          briefCalls++;
          expect(user).toContain('Devolvé solo lo que entendiste');
          return { value: out({ understood: mundialUnderstood() }), usage: emptyUsage() };
        },
        shapes: async () => ({ value: { variants: [auVariant('Siguiendo a los Pumas', { anchor_ids: ['mundial-rugby-2027'] })] }, usage: emptyUsage() }),
      },
      null,
      research,
    );
    const r = await tripShapes({ conversation: [{ role: 'user', text: mundialStory }] }, ctxFor(new FakeDb(), U.juan), d);
    expect(briefCalls).toBe(1); // sin cache: re-extrae lo entendido
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0].assumptions[0]).toContain('No pude verificar el calendario oficial');
    // El ancla del usuario sigue, sin fecha inventada y sin marcar como investigada.
    expect(r.variants[0].anchors).toEqual([expect.objectContaining({ id: 'mundial-rugby-2027', researched: false, date: null, sources: [] })]);
  });

  it('re-extracción que falla → formas igual (sin anclas)', async () => {
    const research = vi.fn<ResearchFn>();
    const d = deps(
      {
        brief: async () => {
          throw new Error('boom');
        },
        shapes: async () => ({ value: { variants: [auVariant('Lo que se pueda', { anchor_ids: [] })] }, usage: emptyUsage() }),
      },
      null,
      research,
    );
    const r = await tripShapes({ conversation: [{ role: 'user', text: mundialStory }] }, ctxFor(new FakeDb(), U.juan), d);
    expect(research).not.toHaveBeenCalled();
    expect(r.variants[0].anchors).toBeUndefined();
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
  anchor_ids: [],
  ...over,
});

describe('trip_shapes', () => {
  it('valida con normalizeSkeleton, descarta inválidas y duplicadas, deja una recomendada', async () => {
    const research = vi.fn<ResearchFn>();
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
    }, null, research));
    expect(research).not.toHaveBeenCalled(); // sin anclas no se investiga
    expect(r.variants.map((v) => v.label)).toEqual(['Equilibrado', 'Más Montevideo', 'Lento']);
    expect(r.variants.filter((v) => v.recommended).map((v) => v.label)).toEqual(['Más Montevideo']);
    expect(r.variants[0]).toMatchObject({ id: 's1', start_date: '2026-10-24', end_date: '2026-10-28' });
    expect(r.variants[0].anchors).toBeUndefined();
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

describe('trip_shapes con understanding de mobile (regresión prod: "object is not iterable")', () => {
  it('interests como {tag: peso} y anclas de la entrevista: se normaliza sin romper', async () => {
    const { understandingFromInput } = await import('./briefLlm');
    const u = understandingFromInput(
      {
        destinations: [{ city: 'Sydney', country: 'Australia' }],
        interests: { deporte: 5, vida_nocturna: 4, inventado: 3 },
        first_time: true,
        travelers: 5,
        trip_kind: 'event',
        anchors: [{ id: 'mundial', name: 'Mundial de Rugby 2027', kind: 'sports', tickets: 'want', researched: false, sources: [], date: null }],
      } as never,
      {},
    );
    expect(u.interests).toEqual({ deporte: 5, vida_nocturna: 4 });
    expect(u.first_time).toBe(true);
    expect(u.travelers).toBe(5);
    expect(u.trip_kind).toBe('event');
    expect(u.anchors).toEqual([expect.objectContaining({ id: 'mundial', researched: false, date: null, tickets: 'want' })]);
  });
});
