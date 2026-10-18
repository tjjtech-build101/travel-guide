// Tests del modelo del Mapa (PRD 03). Sin dependencias: `pnpm --filter mobile test:map` (tsx).
import type { DayRow } from '@build101/shared';

import type { PlanBlock, PlanLeg } from '../plan/selectors';
import { boundsOf, buildMapModel, dayOptions, defaultDayId, focusForCoordinate, focusForPoint, timelineStatus, type MapPoint, type MapTour } from './model';

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
function eq(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`);
}

const day = (id: string, date: string) => ({ id, leg_id: 'x', date, weather: null, briefing: null }) as unknown as DayRow;
const leg = (id: string, city: string, start: string, end: string, lat: number | null, lng: number | null, members: string[], days: DayRow[], sort = 0) =>
  ({ id, trip_id: 't', city, country: 'UY', google_place_id: null, lat, lng, start_date: start, end_date: end, sort_order: sort, days, member_ids: members }) as unknown as PlanLeg;
const block = (p: Partial<PlanBlock> & { id: string }) =>
  ({
    day_id: 'd2',
    leg_id: 'mvd',
    title: p.id,
    type: 'activity',
    start_time: null,
    end_time: null,
    time_flex: 'any',
    sort_order: 0,
    lat: null,
    lng: null,
    masked: false,
    plan_variant: 'main',
    place_name: null,
    google_place_id: null,
    tour_id: null,
    participant_ids: [],
    ...p,
  }) as unknown as PlanBlock;

const legs = [
  leg('mvd', 'Montevideo', '2026-10-17', '2026-10-19', -34.9, -56.19, ['j', 'a', 'l', 's'], [day('d1', '2026-10-17'), day('d2', '2026-10-18')], 1),
  leg('col', 'Colonia', '2026-10-20', '2026-10-21', -34.47, -57.84, ['j', 'a', 'l'], [day('d3', '2026-10-20')], 2),
  leg('bas', 'Buenos Aires', '2026-10-20', '2026-10-21', -34.6, -58.38, ['s'], [day('d4', '2026-10-20')], 2),
  leg('ba', 'Buenos Aires', '2026-10-22', '2026-10-24', -34.6, -58.38, ['j', 'a', 'l', 's'], [day('d5', '2026-10-22')], 3),
];

const tours: MapTour[] = [
  {
    id: 'tour1',
    title: 'Ciudad Vieja',
    stops: [
      { id: 's1', name: 'Ciudadela', lat: -34.9067, lng: -56.2012, google_place_id: null },
      { id: 's2', name: 'Plaza Matriz', lat: -34.9069, lng: -56.2052, google_place_id: 'g2' },
    ],
  },
  { id: 'otro', title: 'Otro', stops: [{ id: 'x', name: 'X', lat: 1, lng: 1, google_place_id: null }] },
];

console.log('mapa · modelo');

test('días en orden con ciudad, paralelos incluidos', () => {
  const opts = dayOptions(legs);
  eq(opts.map((o) => o.dayId), ['d1', 'd2', 'd4', 'd3', 'd5']); // paralelos: desempate estable por id
  if (!opts[0].label.includes('Montevideo')) throw new Error(opts[0].label);
});

test('día por defecto: hoy, el próximo o el primero', () => {
  const opts = dayOptions(legs);
  eq(defaultDayId(opts, '2026-10-18', 'd2'), 'd2');
  eq(defaultDayId(opts, '2026-10-19', null), 'd4');
  eq(defaultDayId(opts, '2026-09-01', null), 'd1');
  eq(defaultDayId(opts, '2027-01-01', null), 'd1');
  eq(defaultDayId([], '2026-10-18', null), null);
});

test('nivel viaje: un punto por tramo y ramas paralelas', () => {
  const m = buildMapModel({ legs, blocks: [], tours: [], scope: { kind: 'trip' } });
  eq(m.points.map((p) => p.id), ['leg:mvd', 'leg:bas', 'leg:col', 'leg:ba']);
  eq(m.lines.map((l) => l.id).sort(), ['leg:bas->ba', 'leg:col->ba', 'leg:mvd->bas', 'leg:mvd->col'].sort());
  if (!m.bounds) throw new Error('sin bounds');
});

test('nivel día: bloques ordenados y numerados, sin ubicación aparte, privados ajenos fuera', () => {
  const blocks = [
    block({ id: 'b-tarde', start_time: '15:00', lat: -34.907, lng: -56.2 }),
    block({ id: 'b-mañana', start_time: '09:00', lat: -34.906, lng: -56.199 }),
    block({ id: 'b-sin', start_time: '12:00' }),
    block({ id: 'b-privado', start_time: '13:00', lat: -34.9, lng: -56.1, masked: true }),
    block({ id: 'b-otro-dia', day_id: 'd1', lat: -34.9, lng: -56.1 }),
    block({ id: 'b-lluvia', plan_variant: 'rain', lat: -34.9, lng: -56.1 }),
  ];
  const m = buildMapModel({ legs, blocks, tours, scope: { kind: 'day', dayId: 'd2' } });
  eq(m.points.map((p) => [p.id, p.order]), [
    ['block:b-mañana', 1],
    ['block:b-tarde', 2],
  ]);
  eq(m.unlocated.map((b) => b.id), ['b-sin']);
  eq(m.lines.length, 1);
  eq(m.lines[0].dashed, true);
});

test('nivel día: paradas del tour del día (solo ese tour)', () => {
  const blocks = [block({ id: 'b-tour', type: 'tour', tour_id: 'tour1', start_time: '10:00', lat: -34.9067, lng: -56.2012 })];
  const m = buildMapModel({ legs, blocks, tours, scope: { kind: 'day', dayId: 'd2' } });
  eq(m.points.filter((p) => p.kind === 'stop').map((p) => [p.label, p.order]), [
    ['Ciudadela', 1],
    ['Plaza Matriz', 2],
  ]);
  if (!m.lines.some((l) => l.id === 'tour:tour1')) throw new Error('falta la línea del tour');
});

test('focus para el Scout (Contratos v1.1)', () => {
  const blocks = [block({ id: 'b1', title: 'Almuerzo', lat: -34.9, lng: -56.2, google_place_id: 'gp1' })];
  const m = buildMapModel({ legs, blocks, tours, scope: { kind: 'day', dayId: 'd2' } });
  eq(focusForPoint(m.points[0]), { lat: -34.9, lng: -56.2, label: 'Almuerzo', block_id: 'b1', google_place_id: 'gp1' });
  const t = buildMapModel({ legs, blocks: [block({ id: 'bt', tour_id: 'tour1' })], tours, scope: { kind: 'day', dayId: 'd2' } });
  const stop = t.points.find((p) => p.kind === 'stop' && p.label === 'Plaza Matriz')!;
  eq(focusForPoint(stop), { lat: -34.9069, lng: -56.2052, label: 'Plaza Matriz (Parada 2 del tour "Ciudad Vieja")', google_place_id: 'g2' });
  const legFocus = focusForPoint(buildMapModel({ legs, blocks: [], tours: [], scope: { kind: 'trip' } }).points[0]);
  eq(legFocus, { lat: -34.9, lng: -56.19, label: 'Montevideo' });
  eq(focusForCoordinate(1, 2), { lat: 1, lng: 2, label: 'Este punto del mapa' });
});

test('bounds', () => {
  eq(boundsOf([]), null);
  eq(boundsOf([{ lat: 1, lng: 2 }, { lat: -1, lng: 5 }]), { ne: [5, 1], sw: [2, -1] });
});

test('estado del sendero: terminado, ahora y próximo', () => {
  const pt = (id: string, start: string | null, end: string | null = null) => ({ id, kind: 'block', start, end }) as MapPoint;
  const pts = [pt('a', '09:00', '10:00'), pt('b', '10:30'), pt('c', '12:30', '14:00'), pt('d', '15:00'), pt('e', null)];
  eq([...timelineStatus(pts, 11 * 60)], [['a', 'done'], ['b', 'now'], ['c', 'next']]);
  eq([...timelineStatus(pts, 8 * 60)], [['a', 'next']]);
  eq([...timelineStatus(pts, 13 * 60)], [['a', 'done'], ['b', 'done'], ['c', 'now'], ['d', 'next']]);
});

test('nivel día: un lugar "elegí 1 de N" es un solo pin (la recomendada)', () => {
  const blocks = [
    block({ id: 'op-2', start_time: '15:00', sort_order: 2, lat: -34.907, lng: -56.2, choice_group: 'g' }),
    block({ id: 'op-1', start_time: '15:00', sort_order: 1, lat: -34.906, lng: -56.199, choice_group: 'g' }),
    block({ id: 'cena', start_time: '21:00', sort_order: 3, lat: -34.905, lng: -56.198 }),
  ];
  const m = buildMapModel({ legs, blocks, tours, scope: { kind: 'day', dayId: 'd2' } });
  eq(m.points.map((p) => p.id), ['block:op-1', 'block:cena']);
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('ok');
