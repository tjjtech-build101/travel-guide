// Tests del menú colaborativo (PRD 31). Sin dependencias: `pnpm --filter mobile test:menu` (tsx).
import type { CatalogItem, LegOptionReactionRow, LegOptionRow, OptionSection } from '@build101/shared';

import {
  applyReaction,
  buildMenuSections,
  coverageTotals,
  durationText,
  ideaFromItem,
  forWhomLabel,
  initialMenuLeg,
  menuCounts,
  menuLegStates,
  metaLine,
  myReaction,
  nextReaction,
  shortRange,
} from './model';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} esperado ${b}, vino ${a}`);
}

const item = (p: Partial<CatalogItem> = {}): CatalogItem => ({
  id: 'x',
  name: 'Lugar',
  category: 'landmark',
  tier: 'recommended',
  zone: 'Recoleta',
  google_place_id: null,
  lat: null,
  lng: null,
  duration_min: 90,
  best_time: 'sunset',
  indoor: false,
  booking: 'none',
  cost_hint: null,
  interests: [],
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
  ...p,
});

const opt = (id: string, section: OptionSection, sort: number, p: Partial<LegOptionRow> = {}): LegOptionRow => ({
  id,
  trip_id: 't',
  leg_id: 'ba',
  item: item({ id, tier: section === 'must' ? 'must' : 'recommended' }),
  section,
  score: 0.5,
  for_user_ids: [],
  reason: null,
  preselected: false,
  sort_order: sort,
  created_at: '',
  ...p,
});

const r = (option_id: string, user_id: string, reaction: LegOptionReactionRow['reaction']): LegOptionReactionRow => ({
  option_id,
  user_id,
  reaction,
  trip_id: 't',
  created_at: '',
});

console.log('menú · modelo');

const options = [
  opt('food1', 'food', 1),
  opt('must2', 'must', 2, { preselected: true }),
  opt('must1', 'must', 1, { preselected: true }),
  opt('ev', 'events', 1),
  opt('gem', 'gems', 1),
  opt('fy', 'for_you', 1),
  opt('otro', 'must', 1, { leg_id: 'col' }),
];

test('secciones en orden del producto, sin vacías y por sort_order', () => {
  const s = buildMenuSections(options, 'ba');
  eq(s.map((x) => x.section), ['must', 'for_you', 'gems', 'food', 'events']);
  eq(s[0].options.map((o) => o.id), ['must1', 'must2']);
  eq(s[0].title, 'Imperdibles');
  eq(s[0].subtitle, 'Lo que no te podés perder');
});

test('conteos: incluidos según optionIncluded e imperdibles', () => {
  const reactions = [r('must1', 'ana', 'no'), r('food1', 'leo', 'love'), r('gem', 'ana', 'no'), r('gem', 'leo', 'must')];
  eq(menuCounts(options, reactions, ['ba']), { total: 6, included: 3, mustTotal: 2, mustIncluded: 1 });
  eq(menuCounts(options, [], null).mustTotal, 3);
});

test('reacción: tocar de nuevo saca, otra reemplaza; optimista sobre la lista', () => {
  eq(nextReaction(null, 'love'), 'love');
  eq(nextReaction('love', 'love'), null);
  eq(nextReaction('love', 'must'), 'must');
  const base = [r('a', 'me', 'love'), r('a', 'ana', 'no'), r('b', 'me', 'no')];
  const next = applyReaction(base, 'a', 'me', 'must', { trip_id: 't', created_at: '' });
  eq(myReaction(next, 'a', 'me'), 'must');
  eq(next.length, 3);
  const removed = applyReaction(next, 'a', 'me', null, { trip_id: 't', created_at: '' });
  eq(myReaction(removed, 'a', 'me'), null);
  eq(myReaction(removed, 'b', 'me'), 'no');
  eq(removed.length, 2);
});

test('textos: duración, meta y "para quién"', () => {
  eq(durationText(90), '1 h 30');
  eq(durationText(45), '45 min');
  eq(durationText(480), 'Día entero');
  eq(metaLine({ zone: 'Recoleta', duration_min: 120, best_time: 'sunset' }), 'Recoleta · 2 h · Mejor al atardecer');
  eq(metaLine({ zone: null, duration_min: 0, best_time: 'any' }), '');
  const names: Record<string, string> = { ana: 'Ana Pérez', leo: 'Leo', sofi: 'Sofi' };
  eq(forWhomLabel(['ana'], 'me', (id) => names[id]), 'Para Ana');
  eq(forWhomLabel(['me', 'ana'], 'me', (id) => names[id]), 'Para vos y Ana');
  eq(forWhomLabel(['ana', 'leo', 'sofi'], 'me', (id) => names[id]), 'Para Ana, Leo y Sofi');
  eq(forWhomLabel([], 'me', (id) => names[id]), null);
});

test('tramos: con menú, armado si hay bloques agendados que no son traslados', () => {
  const legs = [
    { id: 'col', city: 'Colonia', start_date: '2026-10-20', end_date: '2026-10-21', sort_order: 2 },
    { id: 'ba', city: 'Buenos Aires', start_date: '2026-10-17', end_date: '2026-10-19', sort_order: 1 },
    { id: 'mvd', city: 'Montevideo', start_date: '2026-10-22', end_date: '2026-10-23', sort_order: 3 },
  ];
  const blocks = [
    { leg_id: 'ba', day_id: 'd1', type: 'activity' },
    { leg_id: 'col', day_id: 'd2', type: 'transfer' },
    { leg_id: 'col', day_id: null, type: 'activity' },
  ];
  const states = menuLegStates(legs, options, blocks);
  eq(states, [
    { legId: 'ba', city: 'Buenos Aires', options: 6, planned: true },
    { legId: 'col', city: 'Colonia', options: 1, planned: false },
  ]);
  eq(initialMenuLeg(states), 'col', 'el primero sin armar');
  eq(initialMenuLeg(states, 'ba'), 'ba', 'el pedido');
  eq(initialMenuLeg(states, 'mvd'), 'col', 'pedido sin menú');
  eq(initialMenuLeg([]), null);
});

test('cobertura: totales', () => {
  eq(
    coverageTotals([
      { leg_id: 'a', city: 'A', must_total: 8, must_covered: 7, missing: [{ option_id: null, item_id: 'x', name: 'X', reason: 'cierra' }], choices: 2 },
      { leg_id: 'b', city: 'B', must_total: 4, must_covered: 4, missing: [], choices: 1 },
    ]),
    { mustTotal: 12, mustCovered: 11, missing: 1, choices: 3 },
  );
  eq(coverageTotals(undefined), { mustTotal: 0, mustCovered: 0, missing: 0, choices: 0 });
});

test('ideas y fechas', () => {
  eq(shortRange('2026-10-17', '2026-10-19'), '17–19 oct');
  eq(shortRange('2026-10-30', '2026-11-02'), '30 oct – 2 nov');
  eq(ideaFromItem('t', 'ba', 'Recoleta', null), { trip_id: 't', leg_id: 'ba', type: 'activity', title: 'Recoleta', reason: 'Imperdible que no entró en los días' });
  const i = ideaFromItem('t', 'ba', 'X', item({ name: 'Cementerio', why: 'Arte', google_place_id: 'g', lat: 1, lng: 2, duration_min: 90, category: 'food' }));
  eq([i.type, i.title, i.place_name, i.google_place_id, i.lat, i.lng, i.duration_min, i.description], ['meal', 'Cementerio', 'Cementerio', 'g', 1, 2, 90, 'Arte']);
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('ok');
