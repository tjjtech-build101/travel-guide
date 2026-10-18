// PRD 31 v2: que el armado respete las anclas del viaje y que el perfil del grupo pese según su confianza.
// Caso real: "Me quiero ir a Australia con amigos a ver el mundial de rugby de 2027" con el perfil demo {religion: 2}
// terminaba con 7 iglesias, 6 cenas de carne ("Asado criollo" en Melbourne), el primer día lleno después de 24 h
// de vuelo y el rugby casi ausente.
import { describe, expect, it } from 'vitest';
import { interestsForName, type CatalogItem, type TripAnchor } from '@build101/shared';
import { LEG_SYSTEM, legContext, SKELETON_SYSTEM } from '../prompts';
import { buildLegOptions, effectiveWeights, scoreItem } from './catalog';
import { diversityCaps, diversityKind, PACE_CAPACITY } from './check';
import { composeLeg, cuisineOf, planMealQueries, spreadKinds, ticketsNote } from './compose';
import { fakeSearch, group as baGroup, item, ITEMS, leg as baLeg, pick } from './composeTestKit';
import { buildPlannerGroup, profileConfidence, type GroupMemberInput } from './group';
import { anchorsForLeg, dayWindows, isLongHaulArrival, JETLAG_NOTE, mergeAnchors, originCountry } from './runtime';
import type { ComposedBlock, ComposeLeg, PlannerGroup } from './types';

// ───────────────────────── Melbourne de juguete (3 días, viernes 8 → domingo 10 de octubre de 2027)

const MEL = { lat: -37.8136, lng: 144.9631 };
const MDAYS = [
  { id: 'm1', date: '2027-10-08' },
  { id: 'm2', date: '2027-10-09' },
  { id: 'm3', date: '2027-10-10' },
];
const off = (dLat: number, dLng: number) => ({ lat: MEL.lat + dLat, lng: MEL.lng + dLng });

const melLeg = (over: Partial<ComposeLeg> = {}): ComposeLeg => ({
  id: 'leg-mel',
  trip_id: 'trip-1',
  city: 'Melbourne',
  country: 'Australia',
  center: MEL,
  days: MDAYS,
  dayWindows: {},
  weather: {},
  lodging: { lat: MEL.lat, lng: MEL.lng },
  lodgingZones: [],
  ...over,
});

const mel = (id: string, name: string, over: Partial<CatalogItem> = {}): CatalogItem =>
  item({ id, name, ...off(0, 0), interests: interestsForName(name), duration_min: 60, ...over });

const CHURCHES = [
  mel('st-pauls', "St Paul's Cathedral", { ...off(-0.001, 0.004), tier: 'must', zone: 'CBD' }),
  mel('st-patricks', "St Patrick's Cathedral", { ...off(0.0, 0.01), zone: 'East Melbourne' }),
  mel('scots', "Scots' Church", { ...off(-0.0005, 0.006), zone: 'CBD' }),
  mel('st-michaels', "St Michael's Uniting Church", { ...off(-0.0005, 0.0065), zone: 'CBD' }),
  mel('st-francis', "St Francis' Church", { ...off(0.002, 0.0), zone: 'CBD' }),
  mel('synagogue', 'Melbourne Hebrew Congregation Synagogue', { ...off(-0.03, 0.02), zone: 'South Yarra' }),
  mel('st-mary', 'St Mary Star of the Sea Church', { ...off(0.01, -0.01), zone: 'West Melbourne' }),
];
const OTHERS = [
  mel('fed-square', 'Federation Square', { ...off(-0.004, 0.006), tier: 'must', zone: 'CBD' }),
  mel('ngv', 'NGV International', { ...off(-0.009, 0.006), category: 'museum', indoor: true, duration_min: 120, tier: 'must', zone: 'Southbank' }),
  mel('acmi', 'ACMI', { ...off(-0.004, 0.007), category: 'museum', indoor: true, duration_min: 90, zone: 'CBD' }),
  mel('melb-museum', 'Melbourne Museum', { ...off(0.0, 0.002), category: 'museum', indoor: true, duration_min: 120, zone: 'Carlton' }),
  mel('immigration', 'Immigration Museum', { ...off(-0.005, -0.004), category: 'museum', indoor: true, duration_min: 75, zone: 'CBD' }),
  mel('botanic', 'Royal Botanic Gardens', { ...off(-0.016, 0.016), category: 'park', duration_min: 90, tier: 'must', zone: 'South Yarra' }),
  mel('qvm', 'Queen Victoria Market', { ...off(0.0055, -0.006), category: 'market', duration_min: 75, zone: 'CBD' }),
  mel('laneways', 'Hosier Lane y las laneways', { ...off(-0.003, 0.006), category: 'neighborhood', duration_min: 60, zone: 'CBD' }),
  mel('fitzroy', 'Fitzroy', { ...off(0.012, 0.015), category: 'neighborhood', duration_min: 120, zone: 'Fitzroy', best_time: 'afternoon' }),
  mel('st-kilda', 'St Kilda Beach', { ...off(-0.05, -0.01), category: 'beach', duration_min: 120, zone: 'St Kilda', best_time: 'sunset' }),
];
const MEL_ITEMS = [...CHURCHES, ...OTHERS];

const RWC: TripAnchor = {
  id: 'arg-nzl',
  name: 'Argentina vs Nueva Zelanda (Mundial de Rugby 2027)',
  kind: 'sports',
  city: 'Melbourne',
  country: 'Australia',
  date: '2027-10-09',
  time: '20:00',
  venue: 'Marvel Stadium',
  tickets: 'have',
  researched: true,
  sources: [{ url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' }],
  note: null,
};
const FINAL: TripAnchor = { ...RWC, id: 'final', name: 'Final del Mundial de Rugby', date: null, time: null, venue: null, tickets: 'want', researched: false, sources: [], note: 'La venta oficial abre en 2026.' };

const religiousIn = (blocks: ComposedBlock[]) => blocks.filter((b) => b.day_id && b.item_id && CHURCHES.some((c) => c.id === b.item_id));
const dayOf = (blocks: ComposedBlock[], id: string) => blocks.filter((b) => b.day_id === id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
const counted = (blocks: ComposedBlock[]) => {
  const seen = new Set<string>();
  return blocks.filter((b) => (b.choice_key ? (seen.has(b.choice_key) ? false : (seen.add(b.choice_key), true)) : true));
};

const mem = (over: Partial<GroupMemberInput> = {}): GroupMemberInput => ({
  user_id: 'u1',
  display_name: 'Juan',
  interests: null,
  avoid: [],
  dietary: [],
  pace: 'balanced',
  chronotype: 'normal',
  budget_level: 'mid',
  mobility: null,
  trip_prefs: null,
  ...over,
});

/** El grupo del caso real: perfil demo flojo {religion: 2}. */
const demoGroup = (): PlannerGroup => buildPlannerGroup({ members: [mem({ interests: { religion: 2 } }), mem({ user_id: 'u2', display_name: 'Sofi' })] });

// ───────────────────────── Perfil con confianza

describe('perfil del grupo según su confianza', () => {
  it('perfil flojo (todo ≤ 2, o pocos sin ninguno fuerte) pesa ×0,35; lo dicho en el viaje no', () => {
    expect(profileConfidence({ religion: 2 })).toBe('weak');
    expect(profileConfidence({ arte: 2, historia: 1, comida: 2 })).toBe('weak');
    expect(profileConfidence({ deporte: 3 })).toBe('weak');
    expect(profileConfidence({ arte: 5, comida: 3 })).toBe('ok');
    const g = demoGroup();
    expect(g.weights.religion).toBeLessThan(1);
    expect(g.spoken).toEqual([]);
    const said = buildPlannerGroup({ members: [mem({ interests: { religion: 2 }, trip_prefs: { interests: { religion: 4 } } })] });
    expect(said.weights.religion).toBe(4);
    expect(said.spoken).toContain('religion');
  });

  it('la conversación y los "sí o sí" pesan más que el perfil (rugby → deporte fuerte)', () => {
    const g = buildPlannerGroup({
      members: [mem({ interests: { religion: 2 } })],
      understanding: {
        destinations: [{ city: 'Melbourne', country: 'Australia' }],
        start_date: null,
        end_date: null,
        days: null,
        travelers: 4,
        party: 'friends',
        names: [],
        interests: { comida: 2 },
        must: ['ver el mundial de rugby'],
        avoid: [],
        budget: null,
        pace: null,
        first_time: true,
        kids_ages: [],
        arrival: null,
        departure: null,
        lodging_booked: null,
        notes: [],
      },
    });
    expect(g.weights.deporte).toBe(5);
    expect(g.spoken).toEqual(expect.arrayContaining(['deporte', 'comida']));
    // Un interés flojo dicho en la conversación cuenta; uno flojo del perfil, no.
    expect(effectiveWeights(g)).toHaveProperty('comida');
    expect(effectiveWeights(g)).not.toHaveProperty('religion');
  });

  it('scoreItem: un interés flojo que no salió de la conversación no suma', () => {
    const church = CHURCHES[1];
    const plain = mel('plain', 'Un lugar cualquiera', { interests: [], notability: church.notability });
    const weak = demoGroup();
    expect(scoreItem(church, weak)).toBe(scoreItem(plain, weak));
    const asked = { ...weak, weights: { religion: 2 }, spoken: ['religion'] };
    expect(scoreItem(church, asked)).toBeGreaterThan(scoreItem(plain, asked));
  });
});

// ───────────────────────── Topes de diversidad

describe('topes de diversidad', () => {
  it('tipos y topes: interés fuerte relaja', () => {
    expect(diversityKind(CHURCHES[0])).toBe('religious');
    expect(diversityKind(CHURCHES[5])).toBe('religious');
    expect(diversityKind(OTHERS[1])).toBe('museum');
    expect(diversityKind(OTHERS[0])).toBeNull();
    expect(diversityCaps({ weights: {}, spoken: [] }).religious).toEqual({ perDay: 1, perLeg: 2 });
    expect(diversityCaps({ weights: { religion: 4 }, spoken: [] }).religious).toEqual({ perDay: 2, perLeg: null });
    expect(diversityCaps({ weights: { museos: 5 } }).museum.perDay).toBe(3);
  });

  it('caso {religion: 2}: el menú preselecciona ≤ 2 lugares religiosos', () => {
    const opts = buildLegOptions({ trip_id: 't', leg_id: 'l', dates: MDAYS.map((d) => d.date), items: MEL_ITEMS, events: [], group: demoGroup(), saved: [] });
    const pre = opts.filter((o) => o.preselected && diversityKind(o.item) === 'religious');
    expect(pre.length).toBeLessThanOrEqual(2);
    // Siguen en el menú (el grupo puede elegirlos), solo no van preseleccionados.
    expect(opts.filter((o) => diversityKind(o.item) === 'religious').length).toBeGreaterThan(2);
  });

  it('caso {religion: 2}: aunque elijan las 7 iglesias, el armado deja ≤ 2 en el tramo y ≤ 1 por día', async () => {
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks: MEL_ITEMS.map((it) => pick(it)) }, { searchPlaces: fakeSearch() });
    const rel = religiousIn(out.blocks);
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.length).toBeLessThanOrEqual(2);
    for (const d of MDAYS) expect(rel.filter((b) => b.day_id === d.id).length).toBeLessThanOrEqual(1);
    expect(out.unplaced.some((u) => /lugares religiosos/.test(u.reason))).toBe(true);
  });

  it('pedido explícito: lo que marcaron sí o sí no cuenta para el tope', async () => {
    const picks = MEL_ITEMS.map((it) => pick(it, { must: CHURCHES.slice(0, 3).some((c) => c.id === it.id) }));
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks }, { searchPlaces: fakeSearch() });
    for (const c of CHURCHES.slice(0, 3)) expect(out.blocks.some((b) => b.item_id === c.id), c.name).toBe(true);
  });

  it('museos: como mucho 2 por día (Buenos Aires de juguete con todo elegido)', async () => {
    const out = await composeLeg({ leg: baLeg(), group: baGroup({ weights: { historia: 4, comida: 4 } }), picks: ITEMS.map((it) => pick(it)) }, { searchPlaces: fakeSearch() });
    for (const d of baLeg().days) {
      const museums = counted(dayOf(out.blocks, d.id)).filter((b) => b.item_id && ITEMS.find((i) => i.id === b.item_id)?.category === 'museum');
      expect(museums.length, d.date).toBeLessThanOrEqual(2);
    }
  });

  it('nunca dos del mismo tipo seguidos si hay con qué separarlos', () => {
    const line = ['iglesia-a', 'iglesia-b', 'parque', 'museo'];
    const kind = (x: string) => x.split('-')[0];
    expect(spreadKinds(line, kind, () => true)).toEqual(['iglesia-a', 'parque', 'iglesia-b', 'museo']);
    expect(spreadKinds(['m-1', 'm-2'], kind, () => true)).toEqual(['m-1', 'm-2']); // sin con qué separar
  });
});

// ───────────────────────── Comida local primero

describe('comida local primero', () => {
  const slots = (n: number) => Array.from({ length: n }, (_, i) => [{ kind: 'lunch' as const, dayIdx: i }, { kind: 'dinner' as const, dayIdx: i }]).flat();

  it('fuera del Río de la Plata nunca parrilla/asado; cocina del lugar y la misma como mucho 1 vez cada 3 días', () => {
    const plan = planMealQueries(slots(6), { country: 'Australia', city: 'Melbourne', group: baGroup(), nDays: 6 });
    const qs = plan.flat().map((q) => q.q);
    expect(qs.join(' ')).not.toMatch(/parrilla|asado|bodeg|steak/);
    expect(qs).toEqual(expect.arrayContaining(['brunch', 'seafood restaurant']));
    const mains = plan.map((p) => p[0].cuisine).filter(Boolean) as string[];
    for (const c of new Set(mains)) expect(mains.filter((x) => x === c).length, c).toBeLessThanOrEqual(2);
  });

  it('en Argentina hay parrilla pero no todas las noches; si lo piden afuera, una steakhouse', () => {
    const ba = planMealQueries(slots(4), { country: 'Argentina', city: 'Buenos Aires', group: baGroup(), nDays: 4 });
    const carne = ba.filter((p) => p[0].cuisine === 'carne').length;
    expect(carne).toBeGreaterThan(0);
    expect(carne).toBeLessThanOrEqual(2);
    const asked = planMealQueries(slots(3), { country: 'Australia', city: 'Melbourne', group: baGroup({ must: ['comer un buen asado'] }), nDays: 3 });
    expect(asked.flat().filter((q) => q.q === 'steakhouse')).toHaveLength(1);
    const unknown = planMealQueries(slots(2), { country: 'Kazajistán', city: 'Almaty', group: baGroup(), nDays: 2 });
    expect(unknown.flat().every((q) => q.q === 'restaurant')).toBe(true);
    expect(cuisineOf('Asado criollo en San Telmo')).toBe('carne');
  });

  it('el armado en Melbourne no busca parrilla ni bodegón', async () => {
    const search = fakeSearch();
    await composeLeg({ leg: melLeg(), group: demoGroup(), picks: OTHERS.map((it) => pick(it)) }, { searchPlaces: search });
    const queries = search.calls.map((c) => c.query);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join(' | ')).not.toMatch(/parrilla|asado|bodeg/);
  });
});

// ───────────────────────── Anclas

describe('anclas → bloques fijos', () => {
  it('mergeAnchors: la investigada gana; anchorsForLeg reparte por fecha/ciudad y las sin fecha al tramo de su ciudad', () => {
    const said = { ...RWC, researched: false, sources: [], time: null };
    const merged = mergeAnchors([RWC], [said, FINAL]);
    expect(merged).toHaveLength(2);
    expect(merged.find((a) => a.id === 'arg-nzl')!.researched).toBe(true);
    const legs = [
      { id: 'syd', city: 'Sydney', start_date: '2027-10-04', end_date: '2027-10-07' },
      { id: 'mel', city: 'Melbourne', start_date: '2027-10-08', end_date: '2027-10-10' },
    ];
    expect(anchorsForLeg(merged, legs[1], legs).map((a) => a.id)).toEqual(['arg-nzl', 'final']);
    expect(anchorsForLeg(merged, legs[0], legs)).toEqual([]);
    // Partido en otra ciudad y ningún tramo ahí ese día: lo ven desde donde están, con nota.
    const away = anchorsForLeg([{ ...RWC, city: 'Perth' }], legs[1], legs);
    expect(away[0].note).toMatch(/fan zone/);
  });

  it('el partido va fijo en su día con hora, sede, fuentes y la nota de entradas; la final sin fecha queda de idea', async () => {
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks: OTHERS.map((it) => pick(it)), anchors: [RWC, FINAL] }, { searchPlaces: fakeSearch() });
    const match = out.blocks.find((b) => b.title === RWC.name)!;
    expect(match).toMatchObject({ day_id: 'm2', time_flex: 'fixed', start_time: '20:00', place_name: 'Marvel Stadium', status: 'confirmed' });
    expect(match.notes).toMatch(/Ya tienen entradas/);
    expect(match.sources?.[0].url).toBe('https://www.rugbyworldcup.com/2027/fixtures');
    expect(typeof match.lat).toBe('number');
    const final = out.blocks.find((b) => b.title === FINAL.name)!;
    expect(final).toMatchObject({ day_id: null, status: 'idea' });
    expect(final.notes).toMatch(/Conseguir entradas: La venta oficial abre en 2026/);
    expect(ticketsNote({ tickets: 'watch_out', note: null, researched: true })).toMatch(/fan zone o bar/);
  });

  it('día del partido de noche: mañana liviana, previa cerca de la sede, el partido y tercer tiempo; nada se cruza', async () => {
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks: OTHERS.map((it) => pick(it)), anchors: [RWC] }, { searchPlaces: fakeSearch() });
    const day = dayOf(out.blocks, 'm2');
    const titles = counted(day).map((b) => b.title);
    const iMatch = titles.indexOf(RWC.name);
    const iPrevia = titles.findIndex((t) => /^Previa en /.test(t));
    const iPost = titles.findIndex((t) => /^Tercer tiempo/.test(t));
    expect(iPrevia).toBeGreaterThanOrEqual(0);
    expect(iPrevia).toBe(iMatch - 1);
    expect(iPost).toBe(iMatch + 1);
    const previa = day.filter((b) => /^Previa en /.test(b.title));
    expect(previa).toHaveLength(3); // elegí 1 de 3 bares reales
    expect(previa.every((b) => b.start_time === '18:10' && b.choice_key === 'previa:m2')).toBe(true);
    // Lo demás del día: de día y liviano (≤ 150 min), antes de la previa.
    const before = counted(day).slice(0, iPrevia).filter((b) => b.type === 'activity');
    expect(before.reduce((s, b) => s + (b.duration_min ?? 0), 0)).toBeLessThanOrEqual(150);
    expect(before.every((b) => b.time_flex !== 'evening')).toBe(true);
    // Termina 22:30: no hay cena tardía aparte (la previa y el tercer tiempo comen).
    expect(day.filter((b) => b.type === 'meal' && b.time_flex === 'evening')).toHaveLength(0);
  });

  it('partido a las 17: la cena es el tercer tiempo cerca de la sede; la mañana siguiente arranca más tarde y rinde menos', async () => {
    const early = { ...RWC, time: '17:00' };
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks: MEL_ITEMS.map((it) => pick(it)), anchors: [early] }, { searchPlaces: fakeSearch() });
    const day = dayOf(out.blocks, 'm2');
    const cena = day.filter((b) => b.type === 'meal' && b.time_flex === 'evening');
    expect(cena.length).toBeGreaterThan(0);
    expect(cena[0].title).toMatch(/^Tercer tiempo: cena en /);
    expect(cena[0].start_time).toBe('20:30');
    // Domingo: menos actividades que un día normal (≤ 75 % de la capacidad).
    const sunday = counted(dayOf(out.blocks, 'm3')).filter((b) => b.type === 'activity');
    expect(sunday.reduce((s, b) => s + (b.duration_min ?? 0), 0)).toBeLessThanOrEqual(PACE_CAPACITY.balanced * 0.75);
  });

  it('el evento del catálogo que es el mismo partido no entra dos veces', async () => {
    const dup = mel('evento-rwc', 'Rugby World Cup: Argentina v New Zealand', { category: 'event', event_dates: ['2027-10-09'], event_time: '20:00' });
    const out = await composeLeg({ leg: melLeg(), group: demoGroup(), picks: [...OTHERS, dup].map((it) => pick(it)), anchors: [RWC] }, { searchPlaces: fakeSearch() });
    expect(out.blocks.some((b) => b.item_id === 'evento-rwc')).toBe(false);
    expect(out.blocks.filter((b) => b.title === RWC.name)).toHaveLength(1);
  });
});

// ───────────────────────── Llegada internacional

describe('llegada internacional', () => {
  it('heurística: otro continente o el esqueleto lo dice; Buenos Aires → Montevideo no', () => {
    expect(originCountry('Buenos Aires')).toBe('argentina');
    expect(originCountry('Rosario, Argentina')).toBe('argentina');
    expect(isLongHaulArrival('Buenos Aires', 'Australia')).toBe(true);
    expect(isLongHaulArrival('Buenos Aires', 'Uruguay')).toBe(false);
    expect(isLongHaulArrival(null, 'Australia')).toBe(false);
    expect(isLongHaulArrival(null, 'Australia', ['El primer día es liviano por el vuelo largo.'])).toBe(true);
  });

  it('dayWindows por fecha: el primer día rinde ~35 %, cena temprano y lleva la nota', () => {
    const w = dayWindows(MDAYS, [], 'normal', { longHaulArrival: true });
    expect(w['2027-10-08']).toMatchObject({ cap_factor: 0.35, dinner_min: 19 * 60 + 30, note: JETLAG_NOTE });
    expect(w['2027-10-09'].cap_factor).toBeUndefined();
    const plain = dayWindows(MDAYS, [{ day_id: 'm1', start_time: '10:00', duration_min: 60 }], 'normal');
    expect(plain['2027-10-08'].start_min).toBe(11 * 60 + 30);
  });

  it('el primer día: una cosa cerca del alojamiento + cena, con la nota del jet lag', async () => {
    const leg = melLeg({ dayWindows: dayWindows(MDAYS, [], 'normal', { longHaulArrival: true }) });
    const out = await composeLeg({ leg, group: demoGroup(), picks: MEL_ITEMS.map((it) => pick(it)) }, { searchPlaces: fakeSearch() });
    const day = counted(dayOf(out.blocks, 'm1')).filter((b) => b.type !== 'lodging');
    const acts = day.filter((b) => b.type === 'activity');
    expect(acts.length).toBeLessThanOrEqual(1);
    const cena = day.find((b) => b.type === 'meal' && b.time_flex === 'evening');
    expect(cena?.start_time).toBe('19:30'); // cena temprano
    expect(day[0].notes).toMatch(/vuelo largo/);
    const normal = counted(dayOf(out.blocks, 'm2')).filter((b) => b.type === 'activity');
    expect(normal.length).toBeGreaterThan(acts.length);
  });
});

// ───────────────────────── Prompts del relleno viejo

describe('prompts del relleno por LLM', () => {
  it('las reglas nuevas están en los system prompts', () => {
    expect(LEG_SYSTEM).toMatch(/Anclas del tramo/);
    expect(LEG_SYSTEM).toMatch(/1 lugar religioso/);
    expect(LEG_SYSTEM).toMatch(/Nunca busques "parrilla"/);
    expect(LEG_SYSTEM).toMatch(/jet lag/);
    expect(SKELETON_SYSTEM).toMatch(/Anclas/);
    expect(SKELETON_SYSTEM).toMatch(/Llegada internacional/);
  });

  it('legContext lleva las anclas del tramo con su day_id y el aviso de vuelo largo', () => {
    const text = legContext({
      trip_id: 't',
      leg: { id: 'leg-mel', city: 'Melbourne', country: 'Australia', start_date: '2027-10-08', end_date: '2027-10-10', lat: null, lng: null },
      days: MDAYS,
      conversation: [{ role: 'user', text: 'Mundial de rugby' }],
      organizerId: 'u1',
      profiles: [],
      participantNames: [],
      arrivals: [],
      savedPlaces: [],
      webSearch: false,
      anchors: [RWC, FINAL],
      longHaulArrival: true,
      origin: 'Buenos Aires',
    });
    expect(text).toMatch(/agendalas tal cual, no inventes otras fechas/);
    expect(text).toMatch(/Argentina vs Nueva Zelanda .* 2027-10-09 20:00 → day_id m2 .* Marvel Stadium/);
    expect(text).toMatch(/Final del Mundial de Rugby .* sin fecha confirmada/);
    expect(text).toMatch(/vuelo largo desde Buenos Aires/);
  });
});
