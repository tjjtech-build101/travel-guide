import { describe, expect, it } from 'vitest';
import { briefQuestions, briefSummary, buildBriefResult } from './tourBrief';
import { groupProfile, localClock, renderBriefCard, type Member, type TourBrief } from './tourContext';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'u1',
  name: 'Ana',
  interests: { arquitectura: 5, historia: 4 },
  avoid: [],
  dietary: [],
  pace: 'balanced',
  budget_level: null,
  step_free: false,
  max_walk_km: null,
  mobility_notes: null,
  languages: [],
  guide_style: null,
  traits: [],
  trip_goal: null,
  trip_must: [],
  trip_avoid: [],
  companions: null,
  ...over,
});

const brief = (over: Partial<TourBrief> = {}): TourBrief => ({
  members: [member()],
  memories: [],
  told: new Map(),
  previousTourPlaceIds: new Set(),
  itinerary: [],
  saved: [],
  start: new Date('2026-10-17T18:30:00Z'),
  durationMin: 60,
  local: { day: 6, minutes: 15 * 60 + 30, text: 'sábado 15:30', date: '2026-10-17' },
  weather: null,
  place: { neighborhood: 'Ciudad Vieja', city: 'Montevideo', country: 'Uruguay', country_code: 'UY' },
  answers: {},
  ...over,
});

const ids = (b: TourBrief, duration = 60, mode: 'planned' | 'spontaneous' = 'spontaneous') =>
  briefQuestions(b, groupProfile(b), { mode, duration_min: duration }).map((q) => q.id);

describe('localClock', () => {
  it('pasa a hora local con el offset', () => {
    expect(localClock(new Date('2026-10-17T18:30:00Z'), -3 * 3600)).toMatchObject({ day: 6, minutes: 15 * 60 + 30, text: 'sábado 15:30' });
  });
});

describe('groupProfile', () => {
  it('combina el grupo: el más lento manda, avoid unido, step_free si alguien lo necesita; energy pisa', () => {
    const b = brief({ members: [member(), member({ id: 'u2', name: 'Juan', pace: 'relaxed', avoid: ['museos'], step_free: true })] });
    const g = groupProfile(b);
    expect(g.pace).toBe('relaxed');
    expect(g.avoid).toEqual(['museos']);
    expect(g.stepFree).toBe(true);
    expect(groupProfile({ ...b, answers: { energy: 'a_full' } }).pace).toBe('intense');
  });
  it('temas pedidos suben a 5; chicos por companions', () => {
    const b = brief({ members: [member({ companions: 'con mis dos hijos' })], answers: { themes: ['comida'] } });
    const g = groupProfile(b);
    expect(g.weights.comida).toBe(5);
    expect(g.hasKids).toBe(true);
    expect(groupProfile({ ...b, answers: { kids: [] } }).hasKids).toBe(false); // dijeron que no van chicos
  });
});

describe('briefQuestions', () => {
  it('abre con la pregunta abierta, hasta 4 de contexto y cierra con "algo que no te quieras perder"', () => {
    const b = brief({ weather: { utc_offset_s: -10800, tz: null, sunset: '19:20', hours: [], max_precip_prob: 70, temp_c: 14 }, members: [member({ companions: 'mi hija', pace: null })] });
    const qs = briefQuestions(b, groupProfile(b), { mode: 'spontaneous', duration_min: 120 });
    expect(qs[0].id).toBe('notes');
    expect(qs.filter((q) => !q.optional).length).toBeLessThanOrEqual(4);
    expect(qs[1].id).toBe('indoor'); // la lluvia va primero entre las de contexto
    expect(qs[1].default).toBe('indoor');
    expect(qs[2].id).toBe('kids');
    expect(qs[qs.length - 1].id).toBe('must_include');
  });
  it('perfil claro de una persona, sin lluvia, tour corto: no pregunta temas', () => {
    expect(ids(brief(), 30)).not.toContain('themes');
  });
  it('gustos que chocan → pregunta temas', () => {
    const b = brief({ members: [member(), member({ id: 'u2', name: 'Juan', interests: { comida: 5, mercados: 4 } })] });
    expect(ids(b)).toContain('themes');
  });
  it('cruza el almuerzo → ofrece parada para comer con default sí y menciona la dieta', () => {
    const b = brief({ local: { day: 6, minutes: 12 * 60, text: 'sábado 12:00', date: '2026-10-17' }, members: [member({ dietary: ['vegetariano'] })] });
    const q = briefQuestions(b, groupProfile(b), { mode: 'spontaneous', duration_min: 60 }).find((x) => x.id === 'food_stop');
    expect(q?.default).toBe('true');
    expect(q?.text).toContain('vegetariano');
  });
  it('no repite lo que ya contestaron', () => {
    const b = brief({ answers: { food_stop: true, finish: 'view', familiarity: 'local' }, local: { day: 6, minutes: 12 * 60, text: 'sábado 12:00', date: '2026-10-17' } });
    const got = ids(b, 90);
    expect(got).not.toContain('food_stop');
    expect(got).not.toContain('finish');
    expect(got).not.toContain('familiarity');
  });
});

describe('briefSummary / renderBriefCard', () => {
  it('resumen corto con quién, dónde y cuándo', () => {
    const b = brief({ members: [member(), member({ id: 'u2', name: 'Juan' })] });
    expect(briefSummary(b, 60)).toBe('Tour de 60 min en Ciudad Vieja para Ana y Juan, sábado 15:30.');
  });
  it('la ficha incluye intereses, avoid, plan futuro y memoria', () => {
    const b = brief({
      members: [member({ avoid: ['museos'] })],
      itinerary: [{ title: 'Teatro Solís', place_name: 'Teatro Solís', lat: null, lng: null, when: 'future', date: '2026-10-18' }],
      memories: ['A Ana le encantó el Palacio Salvo'],
    });
    const card = renderBriefCard(b, groupProfile(b));
    expect(card).toContain('arquitectura (5/5)');
    expect(card).toContain('evita museos');
    expect(card).toContain('Teatro Solís');
    expect(card).toContain('Palacio Salvo');
  });
});

describe('buildBriefResult · guía de entrevista', () => {
  it('trae temas a cubrir, usa lo que ya sabe y termina pidiendo confirmación', () => {
    const b = brief({ members: [member({ avoid: ['museos'] })] });
    const r = buildBriefResult(b, groupProfile(b), { mode: 'spontaneous', duration_min: 60 }, []);
    expect(r.interview.length).toBeGreaterThanOrEqual(5);
    expect(r.interview.join(' ')).toMatch(/no se quieran perder/);
    expect(r.interview.join(' ')).toMatch(/evitan museos/);
    expect(r.interview[r.interview.length - 1]).toMatch(/confirmación/);
  });
});
