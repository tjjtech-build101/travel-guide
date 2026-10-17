import { describe, expect, it } from 'vitest';
import type { GroupProfile } from './tourContext';
import { cardinal, dwellFor, geofenceFor, normalizeNotability, openAtFn, placeKind, planRoute, scoreForGroup, targetStops, type RouteCandidate, type ScoreInput } from './tourRoute';

const group = (over: Partial<GroupProfile> = {}): GroupProfile => ({
  weights: { historia: 5 },
  avoid: [],
  stepFree: false,
  maxWalkKm: null,
  pace: 'balanced',
  dietary: [],
  budget: null,
  hasKids: false,
  guideStyle: null,
  firstTime: true,
  indoor: 'mixed',
  paidEntries: false,
  themes: [],
  ...over,
});

const score = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  interests: ['historia'],
  kind: 'building',
  notability: 0.6,
  curated: false,
  must: false,
  toldLayers: 0,
  inPreviousTour: false,
  inItinerary: null,
  exteriorOnly: false,
  saved: false,
  ...over,
});

describe('placeKind', () => {
  it('Google > OSM > nombre', () => {
    expect(placeKind({ name: 'Algo', google_types: ['church'] })).toBe('church');
    expect(placeKind({ name: 'Algo', category_hint: 'tourism=viewpoint' })).toBe('viewpoint');
    expect(placeKind({ name: 'Mercado del Puerto' })).toBe('market');
    expect(placeKind({ name: 'Plaza Zabala' })).toBe('plaza');
    expect(placeKind({ name: 'Lo de Pepe' })).toBe('other');
  });
});

describe('permanencia, geofence y cantidad de paradas', () => {
  it('entrar lleva más tiempo; ritmo tranqui estira', () => {
    expect(dwellFor('museum', { interior: true, pace: 'balanced' })).toBeGreaterThan(dwellFor('museum', { interior: false, pace: 'balanced' }));
    expect(dwellFor('plaza', { interior: false, pace: 'relaxed' })).toBeGreaterThan(dwellFor('plaza', { interior: false, pace: 'intense' }));
  });
  it('geofence: plaza 50, calle 25, default 35', () => {
    expect(geofenceFor('plaza')).toBe(50);
    expect(geofenceFor('street')).toBe(25);
    expect(geofenceFor('building')).toBe(35);
  });
  it('≈ duración/8 entre 3 y 12, menos paradas si van tranqui', () => {
    expect(targetStops(60, 'balanced')).toBe(8);
    expect(targetStops(60, 'relaxed')).toBe(6);
    expect(targetStops(15, 'balanced')).toBe(3);
    expect(targetStops(240, 'intense')).toBe(12);
  });
});

describe('normalizeNotability', () => {
  it('escala común 0-1 para reseñas, sitelinks y datos propios', () => {
    expect(normalizeNotability({ rating_count: 30_000 })).toBeCloseTo(1, 1);
    expect(normalizeNotability({ sitelinks: 160 })).toBeCloseTo(1, 1);
    expect(normalizeNotability({ rating_count: 50 })).toBeLessThan(normalizeNotability({ rating_count: 5000 }));
    expect(normalizeNotability({})).toBeGreaterThan(0);
  });
});

describe('scoreForGroup', () => {
  it('lo ya escuchado, lo de otros tours y lo que ya está en el plan baja', () => {
    const base = scoreForGroup(score(), group());
    expect(scoreForGroup(score({ toldLayers: 2 }), group())).toBeLessThan(base * 0.2);
    expect(scoreForGroup(score({ inPreviousTour: true }), group())).toBeLessThan(base * 0.2);
    expect(scoreForGroup(score({ inItinerary: 'future' }), group())).toBeLessThan(base);
    expect(scoreForGroup(score({ must: true }), group())).toBeGreaterThan(base * 3);
  });
  it('con lluvia, lo cubierto le gana a lo abierto', () => {
    const g = group({ indoor: 'indoor' });
    expect(scoreForGroup(score({ kind: 'church' }), g)).toBeGreaterThan(scoreForGroup(score({ kind: 'plaza' }), g));
  });
  it('conocedores: lo menos famoso sube respecto de primera vez', () => {
    const famous = score({ notability: 1 });
    const hidden = score({ notability: 0.35 });
    const first = group({ firstTime: true });
    const local = group({ firstTime: false });
    expect(scoreForGroup(famous, first) / scoreForGroup(hidden, first)).toBeGreaterThan(scoreForGroup(famous, local) / scoreForGroup(hidden, local));
  });
});

describe('openAtFn', () => {
  // Lunes a viernes 10-18.
  const periods = [1, 2, 3, 4, 5].map((day) => ({ open: { day, hour: 10, minute: 0 }, close: { day, hour: 18, minute: 0 } }));
  it('abierto / cerrado / sin datos', () => {
    const f = openAtFn(periods);
    expect(f(1 * 1440 + 11 * 60)).toBe(true); // lunes 11:00
    expect(f(1 * 1440 + 19 * 60)).toBe(false); // lunes 19:00
    expect(f(0 * 1440 + 12 * 60)).toBe(false); // domingo
    expect(openAtFn(null)(0)).toBeNull();
    expect(openAtFn([{ open: { day: 0, hour: 0, minute: 0 } }])(5000)).toBe(true); // 24/7
  });
  it('turno que cruza la medianoche', () => {
    const f = openAtFn([{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }]);
    expect(f(6 * 1440 + 23 * 60)).toBe(true);
    expect(f(0 * 1440 + 60)).toBe(true);
    expect(f(0 * 1440 + 3 * 60)).toBe(false);
  });
});

// Grilla de puntos alrededor de (0,0): ~111 m por 0.001°.
const pt = (dx: number, dy: number) => ({ lat: dy * 0.001, lng: dx * 0.001 });
const rc = (key: string, dx: number, dy: number, over: Partial<RouteCandidate> = {}): RouteCandidate => ({ key, ...pt(dx, dy), kind: 'building', score: 1, dwell: 4, ...over });

describe('planRoute', () => {
  const base = { start: pt(0, 0), end: null, budgetMin: 60, walkKmh: 4.5, maxWalkM: null, maxStops: 8, startMinuteOfWeek: 1 * 1440 + 12 * 60 };

  it('respeta el presupuesto de tiempo y no repite paradas', () => {
    const cands = Array.from({ length: 20 }, (_, i) => rc(`c${i}`, (i % 5) * 2, Math.floor(i / 5) * 2));
    const p = planRoute({ ...base, candidates: cands });
    expect(p.totalMin).toBeLessThanOrEqual(60);
    expect(new Set(p.keys).size).toBe(p.keys.length);
    expect(p.keys.length).toBeGreaterThanOrEqual(3);
  });

  it('prefiere variedad: con dos iglesias y un parque igual de buenos, mete el parque', () => {
    const cands = [rc('ig1', 1, 0, { kind: 'church' }), rc('ig2', 2, 0, { kind: 'church' }), rc('pq', 3, 0, { kind: 'park' })];
    const p = planRoute({ ...base, maxStops: 2, candidates: cands });
    expect(p.keys).toContain('pq');
  });

  it('las obligatorias entran aunque estén lejos', () => {
    const cands = [rc('cerca', 1, 0), rc('lejos', 12, 0, { must: true, score: 0.1 })];
    const p = planRoute({ ...base, candidates: cands });
    expect(p.keys).toContain('lejos');
  });

  it('un mercado cerrado a la hora de llegada no entra; un edificio cerrado queda como exterior', () => {
    const closed = () => false;
    const p = planRoute({ ...base, candidates: [rc('m', 1, 0, { kind: 'market', openAt: closed }), rc('e', 2, 0, { openAt: closed }), rc('x', 3, 0)] });
    expect(p.keys).not.toContain('m');
    expect(p.exteriorKeys).toContain('e');
  });

  it('no pone dos paradas a menos de minGapM (lo de al lado se cuenta desde la vecina)', () => {
    const cands = [rc('plaza', 1, 0, { kind: 'plaza', score: 2 }), rc('estatua', 1.3, 0, { kind: 'monument' }), rc('teatro', 4, 0, { kind: 'theater' })];
    const p = planRoute({ ...base, candidates: cands });
    expect(p.keys).toContain('plaza');
    expect(p.keys).toContain('teatro');
    expect(p.keys).not.toContain('estatua');
  });

  it('lastKey queda al final; end fijo cuenta la vuelta', () => {
    const cands = [rc('a', 1, 0), rc('b', 2, 1), rc('fin', 3, 0)];
    const p = planRoute({ ...base, lastKey: 'fin', candidates: cands });
    expect(p.keys[p.keys.length - 1]).toBe('fin');
    const loop = planRoute({ ...base, end: pt(0, 0), candidates: cands });
    const open = planRoute({ ...base, candidates: cands });
    expect(loop.walkM).toBeGreaterThan(open.walkM);
  });

  it('tope de caminata (movilidad): no se pasa de maxWalkM', () => {
    const cands = Array.from({ length: 10 }, (_, i) => rc(`c${i}`, i * 3, 0));
    const p = planRoute({ ...base, maxWalkM: 1000, candidates: cands });
    expect(p.walkM).toBeLessThanOrEqual(1000);
  });
});

describe('cardinal', () => {
  it('rumbos básicos', () => {
    expect(cardinal(pt(0, 0), pt(0, 1))).toBe('norte');
    expect(cardinal(pt(0, 0), pt(-1, 0))).toBe('oeste');
    expect(cardinal(pt(0, 0), pt(1, -1))).toBe('sureste');
  });
});
