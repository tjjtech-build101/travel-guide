import { describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@build101/shared';
import type { PlaceSummary } from '../../google/places';
import { emptyUsage } from '../schemas';
import {
  avoidHit,
  buildLegOptions,
  cityKey,
  closedDaysFromPeriods,
  getCatalog,
  legCapacityMin,
  legEvents,
  mergeRawItems,
  nameKey,
  scoreItem,
  scoreItemFor,
  validateTier,
} from './catalog';
import type { CatalogDeps, CityRef, PlannerGroup, PlannerMember, RawCatalogItem } from './types';

const BA: CityRef = { city: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lng: -58.3816 };
const NOW = new Date('2026-10-17T12:00:00Z');

const raw = (name: string, over: Partial<RawCatalogItem> = {}): RawCatalogItem => ({
  name,
  query: `${name}, Buenos Aires`,
  category: 'landmark',
  tier: 'recommended',
  zone: 'Centro',
  duration_min: 60,
  best_time: 'any',
  indoor: false,
  booking: 'none',
  cost_hint: 'free',
  interests: ['historia'],
  why: `${name} vale la pena.`,
  tip: null,
  closed_days: [],
  sources: [{ url: `https://guia-a.com/${encodeURIComponent(name)}` }],
  ...over,
});

const place = (id: string, name: string, lat = -34.6, lng = -58.38): PlaceSummary => ({
  google_place_id: id,
  name,
  address: null,
  lat,
  lng,
  rating: 4.6,
  price_level: null,
  open_now: null,
  types: [],
});

function fakeAdmin(row: Record<string, unknown> | null = null) {
  const upserts: Record<string, unknown>[] = [];
  const admin = {
    from: (_table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      upsert: async (r: Record<string, unknown>) => {
        upserts.push(r);
        return { error: null };
      },
    }),
  };
  return { admin: admin as never, upserts };
}

/** Deps falsas: research por modo, Places por consulta (sin entrada = no existe). */
function fakeDeps(opts: {
  generate: RawCatalogItem[];
  review?: RawCatalogItem[] | Error;
  places?: Record<string, PlaceSummary>;
  hours?: Record<string, { periods: CatalogItem['periods']; rating_count: number | null }>;
}) {
  const research = vi.fn<CatalogDeps['research']>(async ({ mode }) => {
    if (mode === 'review' && opts.review instanceof Error) throw opts.review;
    return {
      items: mode === 'generate' ? opts.generate : ((opts.review as RawCatalogItem[] | undefined) ?? []),
      lodging_zones: mode === 'generate' ? [{ zone: 'Palermo', why: 'Cerca de todo.' }] : [],
      usage: { ...emptyUsage(), output_tokens: 100 },
    };
  });
  const searchPlaces = vi.fn<CatalogDeps['searchPlaces']>(async ({ query }) => {
    const name = (query ?? '').replace(/, Buenos Aires$/, '');
    if (name === 'Palermo') return [place('p-palermo', 'Palermo', -34.58, -58.42)];
    const p = opts.places?.[name] ?? place(`p-${nameKey(name).replace(/ /g, '-')}`, name);
    return opts.places && name in opts.places && !opts.places[name] ? [] : [p];
  });
  const placeHours = vi.fn<CatalogDeps['placeHours']>(async (id) => opts.hours?.[id] ?? null);
  const deps: CatalogDeps = { research, searchPlaces, placeHours, now: () => NOW };
  return { deps, research, searchPlaces, placeHours };
}

const many = (n: number, prefix = 'Lugar') => Array.from({ length: n }, (_, i) => raw(`${prefix} ${i + 1}`));

// ───────────────────────── Puros

describe('normalización', () => {
  it('cityKey sin acentos ni mayúsculas', () => {
    expect(cityKey('Buenos Aires', 'Argentina')).toBe('buenos aires|argentina');
    expect(cityKey('  São Paulo ', 'Brasil')).toBe('sao paulo|brasil');
    expect(cityKey('Montevideo', null)).toBe('montevideo|');
  });

  it('nameKey ignora artículos y orden', () => {
    expect(nameKey('Cementerio de la Recoleta')).toBe(nameKey('Cementerio Recoleta'));
    expect(nameKey('Café Tortoni')).toBe(nameKey('cafe tortoni'));
  });

  it('closed_days desde periods', () => {
    const p = (d: number) => ({ open: { day: d, hour: 10, minute: 0 }, close: { day: d, hour: 18, minute: 0 } });
    expect(closedDaysFromPeriods([p(2), p(3), p(4), p(5), p(6), p(0)])).toEqual([1]);
    expect(closedDaysFromPeriods([{ open: { day: 0, hour: 0, minute: 0 } }])).toEqual([]);
    expect(closedDaysFromPeriods(null)).toEqual([]);
  });

  it('tier: must exige 2 fuentes independientes o notoriedad', () => {
    const one = [{ url: 'https://a.com/x' }, { url: 'https://www.a.com/y' }];
    expect(validateTier('must', one, 0.3)).toBe('recommended');
    expect(validateTier('must', [...one, { url: 'https://b.org/z' }], 0.3)).toBe('must');
    expect(validateTier('must', one, 0.8)).toBe('must');
    expect(validateTier('gem', [], 0)).toBe('gem');
  });

  it('merge de pasadas: dedupe por nombre, une fuentes y se queda con el tier más alto; descarta basura', () => {
    const out = mergeRawItems(
      [
        [raw('Cementerio de la Recoleta', { tier: 'recommended' }), raw('', {}), raw('Algo', { category: 'event' })],
        [raw('Cementerio Recoleta', { tier: 'must', sources: [{ url: 'https://b.com/x' }] })],
      ],
      'Buenos Aires',
    );
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe('must');
    expect(out[0].sources).toHaveLength(2);
  });
});

// ───────────────────────── getCatalog

describe('getCatalog', () => {
  it('cache hit: fila fresca con ≥15 ítems no investiga', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `X${i}` })) as unknown as CatalogItem[];
    const { admin, upserts } = fakeAdmin({ items, lodging_zones: [], updated_at: '2026-10-10T00:00:00Z' });
    const { deps, research } = fakeDeps({ generate: [] });
    const r = await getCatalog(admin, BA, deps);
    expect(r.cached).toBe(true);
    expect(r.items).toHaveLength(20);
    expect(research).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it('cache miss: vieja (>30 días) o con pocos ítems → investiga y guarda', async () => {
    for (const row of [
      { items: many(20) as unknown as CatalogItem[], lodging_zones: [], updated_at: '2026-08-01T00:00:00Z' },
      { items: many(5) as unknown as CatalogItem[], lodging_zones: [], updated_at: '2026-10-16T00:00:00Z' },
      null,
    ]) {
      const { admin, upserts } = fakeAdmin(row);
      const { deps, research } = fakeDeps({ generate: many(18) });
      const progress: string[] = [];
      const r = await getCatalog(admin, BA, deps, { onProgress: (t) => progress.push(t) });
      expect(r.cached).toBe(false);
      expect(research).toHaveBeenCalledTimes(2);
      expect(upserts).toHaveLength(1);
      expect(upserts[0]).toMatchObject({ city_key: 'buenos aires|argentina', city: 'Buenos Aires' });
      expect(r.lodging_zones).toEqual([{ zone: 'Palermo', why: 'Cerca de todo.', lat: -34.58, lng: -58.42 }]);
      expect(progress[0]).toBe('Investigando qué no te podés perder en Buenos Aires…');
      expect(progress.at(-1)).toBe('Encontré 18 lugares, 0 imperdibles');
      expect(r.usage.output_tokens).toBe(200);
    }
  });

  it('review agrega lo que faltaba y recibe los nombres de la primera pasada', async () => {
    const { admin } = fakeAdmin();
    const { deps, research } = fakeDeps({
      generate: [raw('Teatro Colón'), raw('Caminito')],
      review: [raw('Café Tortoni', { category: 'food' }), raw('Teatro Colon')],
    });
    const r = await getCatalog(admin, BA, deps);
    expect(research.mock.calls[1][0]).toMatchObject({ mode: 'review', known: ['Teatro Colón', 'Caminito'] });
    expect(r.items.map((i) => i.name).sort()).toEqual(['Café Tortoni', 'Caminito', 'Teatro Colón']);
  });

  it('si la revisión falla sigue con la primera pasada', async () => {
    const { admin } = fakeAdmin();
    const { deps } = fakeDeps({ generate: [raw('Caminito')], review: new Error('529') });
    const r = await getCatalog(admin, BA, deps);
    expect(r.items.map((i) => i.name)).toEqual(['Caminito']);
  });

  it('descarta lo que no existe en Places o cae lejos (salvo escapadas) y deduplica por place id', async () => {
    const { admin } = fakeAdmin();
    const { deps } = fakeDeps({
      generate: [
        raw('Cementerio de la Recoleta', { tier: 'must' }),
        raw('Recoleta Cemetery', { tier: 'must', sources: [{ url: 'https://otra-guia.com/r' }] }),
        raw('Lugar inventado'),
        raw('Monumento en Rosario'),
        raw('Tigre', { category: 'day_trip', duration_min: 480 }),
        raw('Pueblo sin mapa', { category: 'day_trip' }),
      ],
      places: {
        'Cementerio de la Recoleta': place('p-rec', 'Cementerio de la Recoleta'),
        'Recoleta Cemetery': place('p-rec', 'Cementerio de la Recoleta'),
        'Lugar inventado': null as never,
        'Monumento en Rosario': place('p-ros', 'Monumento a la Bandera', -32.95, -60.64),
        Tigre: place('p-tigre', 'Tigre', -34.42, -58.58),
        'Pueblo sin mapa': null as never,
      },
    });
    const r = await getCatalog(admin, BA, deps);
    const names = r.items.map((i) => i.name);
    expect(names).toContain('Cementerio de la Recoleta');
    expect(names).not.toContain('Recoleta Cemetery');
    expect(names).not.toContain('Lugar inventado');
    expect(names).not.toContain('Monumento en Rosario');
    const rec = r.items.find((i) => i.google_place_id === 'p-rec')!;
    expect(rec.tier).toBe('must'); // las dos menciones suman 2 fuentes independientes
    expect(rec.sources).toHaveLength(2);
    expect(r.items.find((i) => i.name === 'Tigre')).toMatchObject({ google_place_id: 'p-tigre', duration_min: 480 });
    expect(r.items.find((i) => i.name === 'Pueblo sin mapa')).toMatchObject({ google_place_id: null, lat: null });
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length);
  });

  it('baja de tier un must con una sola fuente; horarios y notoriedad de Places', async () => {
    const { admin } = fakeAdmin();
    const d = (day: number) => ({ open: { day, hour: 10, minute: 0 }, close: { day, hour: 17, minute: 0 } });
    const { deps, placeHours } = fakeDeps({
      generate: [
        raw('Museo Chico', { tier: 'must', category: 'museum' }),
        raw('Obelisco', { tier: 'must' }),
        raw('Parque Lindo', { category: 'park' }),
      ],
      hours: {
        'p-chico-museo': { periods: [d(2), d(3), d(4), d(5), d(6), d(0)], rating_count: 120 },
        'p-obelisco': { periods: null, rating_count: 90_000 },
      },
    });
    const r = await getCatalog(admin, BA, deps);
    const museo = r.items.find((i) => i.name === 'Museo Chico')!;
    expect(museo.tier).toBe('recommended');
    expect(museo.closed_days).toEqual([1]);
    expect(museo.periods).toHaveLength(6);
    const obe = r.items.find((i) => i.name === 'Obelisco')!;
    expect(obe.tier).toBe('must'); // 1 fuente pero muy notorio
    expect(obe.notability).toBeGreaterThanOrEqual(0.6);
    expect(placeHours).not.toHaveBeenCalledWith('p-lindo-parque'); // parques no piden horarios
    expect(r.items[0].name).toBe('Obelisco'); // imperdibles primero
  });

  it('una sola corrida por ciudad a la vez', async () => {
    const { admin } = fakeAdmin();
    const { deps, research } = fakeDeps({ generate: many(16) });
    const [a, b] = await Promise.all([getCatalog(admin, BA, deps), getCatalog(admin, { ...BA, city: 'buenos aires' }, deps)]);
    expect(a).toBe(b);
    expect(research.mock.calls.filter((c) => c[0].mode === 'generate')).toHaveLength(1);
  });

  it('si la investigación falla y hay un catálogo viejo, usa ese', async () => {
    const items = many(3) as unknown as CatalogItem[];
    const { admin } = fakeAdmin({ items, lodging_zones: [], updated_at: '2026-01-01T00:00:00Z' });
    const { deps, research } = fakeDeps({ generate: [] });
    research.mockRejectedValueOnce(new Error('boom'));
    const r = await getCatalog(admin, BA, deps);
    expect(r).toMatchObject({ cached: true, items });
    const { admin: empty } = fakeAdmin();
    research.mockRejectedValueOnce(new Error('boom'));
    await expect(getCatalog(empty, BA, deps)).rejects.toThrow('boom');
  });
});

// ───────────────────────── Eventos

describe('legEvents', () => {
  it('eventos del tramo como ítems, varias fechas juntas; si falla, []', async () => {
    const ev = (title: string, date: string) => ({
      title,
      date,
      start_time: '21:00',
      venue: 'Luna Park',
      address: null,
      price_text: 'desde $20.000',
      url: 'https://lunapark.com.ar/e',
      source_url: 'https://lunapark.com.ar/agenda',
    });
    const searchPlaces = async () => [place('p-luna', 'Luna Park')];
    const out = await legEvents(BA, ['2026-10-20', '2026-10-21', '2026-10-22'], {
      searchPlaces,
      searchEvents: async () => [ev('Recital X', '2026-10-20'), ev('Recital X', '2026-10-21'), ev('Fuera', '2026-10-25')],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: 'event', event_dates: ['2026-10-20', '2026-10-21'], event_time: '21:00', google_place_id: 'p-luna', best_time: 'night' });
    expect(await legEvents(BA, ['2026-10-20'], { searchPlaces, searchEvents: async () => Promise.reject(new Error('x')) })).toEqual([]);
  });
});

// ───────────────────────── Puntaje y menú

const item = (id: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name: id,
  category: 'landmark',
  tier: 'recommended',
  zone: null,
  google_place_id: `g-${id}`,
  lat: -34.6,
  lng: -58.38,
  duration_min: 90,
  best_time: 'any',
  indoor: false,
  booking: 'none',
  cost_hint: null,
  interests: ['historia'],
  why: '',
  tip: null,
  closed_days: [],
  periods: null,
  event_dates: null,
  event_time: null,
  sources: [],
  notability: 0.5,
  rating: null,
  rating_count: null,
  ...over,
});

const member = (over: Partial<PlannerMember> = {}): PlannerMember => ({
  user_id: 'u1',
  name: 'Sofi',
  interests: {},
  avoid: [],
  must: [],
  dietary: [],
  pace: null,
  chronotype: null,
  budget: null,
  step_free: false,
  max_walk_km: null,
  ...over,
});

const group = (over: Partial<PlannerGroup> = {}): PlannerGroup => ({
  members: [member({ interests: { arte: 5, arquitectura: 4 } }), member({ user_id: 'u2', name: 'Juan', interests: { deporte: 5 } })],
  weights: { arte: 2.5, arquitectura: 2, deporte: 2.5, historia: 3 },
  avoid: [],
  must: [],
  dietary: [],
  pace: 'balanced',
  chronotype: 'normal',
  budget: null,
  hasKids: false,
  firstTime: true,
  stepFree: false,
  ...over,
});

describe('scoreItem', () => {
  it('avoid saca lo evitado; parcial lo baja', () => {
    const g = group({ avoid: ['museos'] });
    expect(avoidHit(item('m', { category: 'museum' }), ['museos'])).toBe('block');
    expect(scoreItem(item('m', { category: 'museum', interests: ['museos', 'arte'] }), g)).toBe(0);
    const mixed = item('x', { interests: ['museos', 'historia'] });
    expect(scoreItem(mixed, g)).toBeCloseTo(scoreItem(mixed, group()) * 0.5, 2);
    expect(scoreItem(item('La Bombonera'), group({ avoid: ['la bombonera'] }))).toBe(0);
  });

  it('primera vez pesa lo canónico; conocedores, las joyas', () => {
    const must = item('a', { tier: 'must', notability: 0.95 });
    const gem = item('b', { tier: 'gem', notability: 0.3 });
    expect(scoreItem(must, group())).toBeGreaterThan(scoreItem(gem, group()));
    expect(scoreItem(gem, group({ firstTime: false }))).toBeGreaterThan(scoreItem(gem, group()));
  });

  it('ajustes: chicos, dieta, presupuesto, movilidad y "sí o sí"', () => {
    expect(scoreItem(item('n', { category: 'nightlife' }), group({ hasKids: true }))).toBeLessThan(scoreItem(item('n', { category: 'nightlife' }), group()) * 0.2);
    const parrilla = item('Parrilla Don Julio', { category: 'food', interests: ['comida'] });
    expect(scoreItem(parrilla, group({ dietary: ['vegano'] }))).toBeLessThan(scoreItem(parrilla, group()));
    const caro = item('c', { cost_hint: 'high' });
    expect(scoreItem(caro, group({ budget: 'low' }))).toBeCloseTo(scoreItem(caro, group()) * 0.5, 2);
    const cerro = item('Cerro', { tip: 'Hay 300 escalones' });
    expect(scoreItem(cerro, group({ stepFree: true }))).toBeLessThan(scoreItem(cerro, group()));
    expect(scoreItem(item('Teatro Colón', { notability: 0.1 }), group({ must: ['el Teatro Colon'] }))).toBeGreaterThanOrEqual(0.95);
  });

  it('scoreItemFor: por persona', () => {
    const arte = item('MALBA', { interests: ['arte', 'museos'], category: 'museum', notability: 0.7 });
    expect(scoreItemFor(arte, member({ interests: { arte: 5 } }))).toBeGreaterThan(0.6);
    expect(scoreItemFor(arte, member({ interests: { deporte: 5 } }))).toBeLessThan(0.4);
    expect(scoreItemFor(arte, member({ avoid: ['museos'] }))).toBe(0);
  });
});

describe('buildLegOptions', () => {
  const base = { trip_id: 't1', leg_id: 'l1', saved: [] as { name: string; google_place_id: string | null }[], events: [] as CatalogItem[] };
  const dates = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(20 + i).padStart(2, '0')}`);

  it('capacidad: primer y último día valen la mitad', () => {
    expect(legCapacityMin(1, 'balanced')).toBe(225);
    expect(legCapacityMin(2, 'balanced')).toBe(450);
    expect(legCapacityMin(4, 'relaxed')).toBe(990);
  });

  it('secciones sin duplicados; escapadas solo con ≥3 días; eventos dentro del tramo', () => {
    const items = [
      item('Recoleta', { tier: 'must', notability: 0.9 }),
      item('Recoleta copia', { tier: 'must', google_place_id: 'g-Recoleta' }),
      item('MALBA', { interests: ['arte'], category: 'museum' }),
      item('Bar Joya', { tier: 'gem', category: 'nightlife', interests: ['vida_nocturna'] }),
      item('Tortoni', { category: 'food', interests: ['comida'] }),
      item('Tigre', { category: 'day_trip', duration_min: 480, interests: ['naturaleza'] }),
      item('Museo evitado', { category: 'museum', interests: ['museos'] }),
    ];
    const events = [
      item('Recital', { category: 'event', event_dates: ['2026-10-21', '2026-11-30'], google_place_id: 'g-MALBA' }),
      item('Otro mes', { category: 'event', event_dates: ['2026-12-01'] }),
    ];
    const g = group({ avoid: ['Museo Evitado'] });
    const two = buildLegOptions({ ...base, dates: dates(2), items, events, group: g });
    const ids = two.map((o) => o.item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('Recoleta copia');
    expect(ids).not.toContain('Museo evitado');
    expect(ids).not.toContain('Tigre');
    expect(ids).not.toContain('Otro mes');
    const sec = Object.fromEntries(two.map((o) => [o.item.id, o.section]));
    expect(sec).toMatchObject({ Recoleta: 'must', MALBA: 'for_you', 'Bar Joya': 'gems', Tortoni: 'food', Recital: 'events' });
    expect(two.find((o) => o.item.id === 'Recital')!.item.event_dates).toEqual(['2026-10-21']);
    expect(two.map((o) => o.sort_order)).toEqual(two.map((_, i) => i));
    const three = buildLegOptions({ ...base, dates: dates(3), items, events, group: g });
    expect(three.find((o) => o.item.id === 'Tigre')?.section).toBe('day_trips');
  });

  it('for_you con para quién y por qué', () => {
    const out = buildLegOptions({ ...base, dates: dates(3), items: [item('MALBA', { interests: ['arte', 'arquitectura'], notability: 0.8 })], group: group() });
    expect(out[0]).toMatchObject({ section: 'for_you', for_user_ids: ['u1'], reason: 'A Sofi le va a encantar: arte y arquitectura' });
  });

  it('preselección: imperdibles siempre + gustos hasta ~85% de la capacidad', () => {
    const musts = [item('m1', { tier: 'must', duration_min: 120 }), item('m2', { tier: 'must', duration_min: 120 })];
    const others = Array.from({ length: 10 }, (_, i) => item(`o${i}`, { duration_min: 60, interests: ['historia'], notability: 0.9 - i * 0.05 }));
    const out = buildLegOptions({ ...base, dates: dates(2), items: [...musts, ...others], group: group() });
    const pre = out.filter((o) => o.preselected);
    expect(pre.filter((o) => o.section === 'must')).toHaveLength(2);
    const minutes = pre.reduce((a, o) => a + o.item.duration_min, 0);
    expect(minutes).toBeLessThanOrEqual(450 * 0.85);
    expect(minutes).toBeGreaterThan(450 * 0.85 - 60);
    // Los preseleccionados por gusto son los de mejor puntaje.
    const preOthers = pre.filter((o) => o.section !== 'must').map((o) => o.item.id);
    expect(preOthers).toEqual(['o0', 'o1']);
    // Más días, más preselección.
    const more = buildLegOptions({ ...base, dates: dates(5), items: [...musts, ...others], group: group() }).filter((o) => o.preselected);
    expect(more.length).toBeGreaterThan(pre.length);
  });

  it('guardados suben y van preseleccionados; "sí o sí" también', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => item(`top${i}`, { tier: 'must', duration_min: 120, notability: 0.9 })),
      item('Rincón guardado', { notability: 0.05, interests: ['compras'] }),
      item('La Bombonera', { notability: 0.05, interests: [] }),
    ];
    const out = buildLegOptions({
      ...base,
      dates: dates(2),
      items,
      group: group({ must: ['Bombonera'] }),
      saved: [{ name: 'otro nombre', google_place_id: 'g-Rincón guardado' }],
    });
    const saved = out.find((o) => o.item.id === 'Rincón guardado')!;
    expect(saved).toMatchObject({ preselected: true, reason: 'Está en tus guardados' });
    expect(out.find((o) => o.item.id === 'La Bombonera')).toMatchObject({ preselected: true, reason: 'Lo pidieron sí o sí' });
  });

  it('tope total de opciones', () => {
    const items = Array.from({ length: 80 }, (_, i) => item(`x${i}`, { tier: i % 3 === 0 ? 'gem' : 'recommended', category: i % 4 === 0 ? 'food' : 'landmark' }));
    const out = buildLegOptions({ ...base, dates: dates(4), items, group: group() });
    expect(out.length).toBeLessThanOrEqual(45);
    expect(out.filter((o) => o.section === 'for_you').length).toBeLessThanOrEqual(14);
  });
});
