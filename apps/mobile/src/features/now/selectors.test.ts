// Tests de los selectores de Ahora (PRD 19). Sin dependencias: `pnpm --filter mobile test:now` (tsx).
import type { DayRow } from '@build101/shared';

import type { PlanBlock, PlanLeg } from '../plan/selectors';
import {
  blockWindow,
  buildNowPlan,
  formatMinutes,
  isFarAway,
  isTripInProgress,
  leaveInMin,
  leaveLabel,
  leaveUrgency,
  localParts,
  nearbyIdeas,
  needsSuggestions,
  resolveToday,
  tzOffsetMin,
  utcFromLocal,
  walkEstimateMin,
} from './selectors';

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
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// ───────── Fixture (forma del seed)
const JUAN = 'u-juan';
const SOFI = 'u-sofi';

const day = (id: string, leg_id: string, date: string): DayRow => ({ id, leg_id, date, weather: null, briefing: null });
const leg = (id: string, start: string, end: string, members: string[], days: DayRow[], country = 'Uruguay'): PlanLeg => ({
  id,
  trip_id: 't',
  city: id,
  country,
  google_place_id: null,
  lat: null,
  lng: null,
  start_date: start,
  end_date: end,
  sort_order: 1,
  days,
  member_ids: members,
});

let n = 0;
function block(p: Partial<PlanBlock> & { day_id: string | null }): PlanBlock {
  n++;
  return {
    id: `b${n}`,
    trip_id: 't',
    leg_id: 'mvd',
    type: 'activity',
    title: `Bloque ${n}`,
    description: null,
    google_place_id: null,
    place_name: null,
    lat: null,
    lng: null,
    start_time: null,
    end_time: null,
    time_flex: 'fixed',
    duration_min: null,
    is_private: false,
    status: 'confirmed',
    plan_variant: 'main',
    cost_estimate: null,
    cost_currency: null,
    booking_url: null,
    notes: null,
    transfer: null,
    alerts: null,
    sources: null,
    tour_id: null,
    sort_order: n,
    created_by: JUAN,
    created_by_agent: false,
    created_at: '',
    updated_at: '',
    masked: false,
    participant_ids: [JUAN],
    ...p,
  } as PlanBlock;
}

const mvd = leg('mvd', '2026-10-17', '2026-10-19', [JUAN, SOFI], [day('d17', 'mvd', '2026-10-17'), day('d18', 'mvd', '2026-10-18')]);
const col = leg('col', '2026-10-20', '2026-10-21', [JUAN], [day('c20', 'col', '2026-10-20')]);
const baSofi = leg('baS', '2026-10-20', '2026-10-21', [SOFI], [day('s20', 'baS', '2026-10-20')], 'Argentina');
const legs = [mvd, col, baSofi];
const trip = { start_date: '2026-10-17', end_date: '2026-10-24', status: 'planning' };

console.log('Zona horaria y fecha local');
test('Uruguay y Argentina = UTC−3, otro país = celu', () => {
  eq(tzOffsetMin('Uruguay'), -180);
  eq(tzOffsetMin('argentina'), -180);
  eq(tzOffsetMin('UY'), -180);
  eq(tzOffsetMin('Perú'), null);
  eq(tzOffsetMin(null), null);
});
test('utcFromLocal ↔ localParts (10:30 en Montevideo)', () => {
  const t = utcFromLocal('2026-10-18T10:30');
  ok(t !== null, 'parsea');
  eq(localParts(t!, -180), { date: '2026-10-18', minutes: 630 });
  eq(new Date(t!).toISOString(), '2026-10-18T13:30:00.000Z');
});
test('utcFromLocal rechaza basura', () => {
  eq(utcFromLocal('mañana'), null);
  eq(utcFromLocal('2026-13-01T10:00'), null);
  eq(utcFromLocal('2026-10-18T25:00'), null);
});
test('medianoche UTC cae el día anterior en Montevideo', () => {
  eq(localParts(Date.parse('2026-10-18T01:00:00Z'), -180).date, '2026-10-17');
});

console.log('resolveToday');
test('día 2 → tramo Montevideo, día d18', () => {
  const r = resolveToday(legs, JUAN, utcFromLocal('2026-10-18T10:30')!, trip);
  ok(r.kind === 'today', r.kind);
  if (r.kind === 'today') {
    eq(r.leg.id, 'mvd');
    eq(r.day.id, 'd18');
    eq(r.minutes, 630);
  }
});
test('tramos paralelos: cada uno ve su rama', () => {
  const at = utcFromLocal('2026-10-20T12:00')!;
  const j = resolveToday(legs, JUAN, at, trip);
  const s = resolveToday(legs, SOFI, at, trip);
  eq(j.kind === 'today' && j.leg.id, 'col');
  eq(s.kind === 'today' && s.leg.id, 'baS');
});
test('antes del viaje → before con días que faltan', () => {
  const r = resolveToday(legs, JUAN, utcFromLocal('2026-10-14T09:00')!, trip);
  eq(r, { kind: 'before', daysUntil: 3, date: '2026-10-14' });
});
test('después del viaje → after', () => {
  eq(resolveToday(legs, JUAN, utcFromLocal('2026-10-30T09:00')!, trip).kind, 'after');
});
test('dentro del viaje sin día cargado para mí → noDay', () => {
  eq(resolveToday(legs, JUAN, utcFromLocal('2026-10-23T09:00')!, trip).kind, 'noDay');
});
test('sin tramos → noLegs', () => {
  eq(resolveToday([], JUAN, Date.now(), trip).kind, 'noLegs');
});
test('isTripInProgress: por fechas o status', () => {
  ok(isTripInProgress(trip, utcFromLocal('2026-10-18T10:00')!), 'dentro');
  ok(!isTripInProgress(trip, utcFromLocal('2026-10-25T10:00')!), 'después');
  ok(isTripInProgress({ ...trip, status: 'active' }, utcFromLocal('2026-11-25T10:00')!), 'active manda');
  ok(!isTripInProgress({ ...trip, status: 'finished' }, utcFromLocal('2026-10-18T10:00')!), 'finished');
  ok(!isTripInProgress({ start_date: null, end_date: null }, Date.now()), 'sin fechas');
});

console.log('buildNowPlan (día 2 del seed)');
const feria = block({ day_id: 'd18', title: 'Feria', start_time: '09:00:00', end_time: '10:30:00' });
const tour = block({ day_id: 'd18', title: 'Ciudad Vieja', type: 'tour', start_time: '11:00:00', end_time: '13:30:00' });
const solis = block({ day_id: 'd18', title: 'Teatro Solís', start_time: '16:00:00', end_time: '17:00:00' });
const llamada = block({ day_id: 'd18', title: 'Llamada', start_time: '18:00:00', end_time: '19:00:00' });
const cafe = block({ day_id: 'd18', title: 'Café cuando sea', time_flex: 'afternoon' });
const ajeno = block({ day_id: 'd18', title: 'Ocupado', start_time: '12:00:00', end_time: '13:00:00', masked: true, participant_ids: [] });
const deSofi = block({ day_id: 'd18', title: 'Sofi sola', start_time: '11:30:00', end_time: '12:00:00', participant_ids: [SOFI] });
const lluvia = block({ day_id: 'd18', title: 'Plan B', start_time: '11:00:00', end_time: '12:00:00', plan_variant: 'rain' });
const dia = [feria, tour, solis, llamada, cafe, ajeno, deSofi, lluvia];

test('10:30 → nada en curso (feria terminó), después el tour en 30 min', () => {
  const p = buildNowPlan(dia, JUAN, 630);
  eq(p.current, null);
  eq(p.next?.block.title, 'Ciudad Vieja');
  eq(p.next?.inMin, 30);
});
test('12:45 → en curso el tour, quedan 45 min; después Solís', () => {
  const p = buildNowPlan(dia, JUAN, 12 * 60 + 45);
  eq(p.current?.block.title, 'Ciudad Vieja');
  eq(p.current?.remainingMin, 45);
  ok(Math.abs((p.current?.progress ?? 0) - 0.7) < 0.001, `progreso ${p.current?.progress}`);
  eq(p.next?.block.title, 'Teatro Solís');
  eq(
    p.later.map((b) => b.title),
    ['Llamada', 'Café cuando sea'],
  );
});
test('no muestra privados ajenos, bloques de otros ni plan B', () => {
  const p = buildNowPlan(dia, JUAN, 11 * 60 + 40);
  eq(p.current?.block.title, 'Ciudad Vieja');
  eq(p.total, 5);
});
test('a las 20:00 el café de la tarde ya no aparece', () => {
  const p = buildNowPlan(dia, JUAN, 20 * 60);
  eq(p.current, null);
  eq(p.next, null);
  eq(p.later, []);
});
test('bloque sin end_time usa la duración', () => {
  eq(blockWindow({ start_time: '10:00', end_time: null, duration_min: 45 }), { start: 600, end: 645 });
  eq(blockWindow({ start_time: '10:00', end_time: null, duration_min: null }), { start: 600, end: 660 });
  eq(blockWindow({ start_time: null, end_time: null, duration_min: 30 }), null);
});

console.log('Sugerencias');
test('sin nada en 2 h → sugerencias; con algo en curso no', () => {
  ok(needsSuggestions(buildNowPlan(dia, JUAN, 13 * 60 + 40)), '13:40: Solís recién a las 16');
  ok(!needsSuggestions(buildNowPlan(dia, JUAN, 630)), '10:30: tour en 30 min');
  ok(!needsSuggestions(buildNowPlan(dia, JUAN, 11 * 60 + 5)), 'en curso');
  ok(needsSuggestions(buildNowPlan([], JUAN, 600)), 'día vacío');
});
test('ideas cerca (≤ 1 km), las más cercanas primero', () => {
  const here = { lat: -34.9067, lng: -56.2012 };
  const cerca = block({ day_id: null, title: 'Chivito', lat: -34.9070, lng: -56.2045 });
  const lejos = block({ day_id: null, title: 'Cerro', lat: -34.889, lng: -56.26 });
  const sinCoords = block({ day_id: null, title: 'Sin lugar' });
  const otroTramo = block({ day_id: null, title: 'BA', leg_id: 'col', lat: -34.9068, lng: -56.2013 });
  eq(nearbyIdeas([cerca, lejos, sinCoords, otroTramo, tour], 'mvd', here).map((b) => b.title), ['Chivito']);
  eq(nearbyIdeas([cerca, lejos, sinCoords], 'mvd', null).map((b) => b.title).length, 3);
});

console.log('Cuándo salir');
test('Salí en X = inicio − ETA − 5 − ahora', () => {
  eq(leaveInMin(11 * 60, 630, 13), 12);
  eq(leaveUrgency(12), 'ok');
  eq(leaveUrgency(5), 'soon');
  eq(leaveUrgency(0), 'soon');
  eq(leaveUrgency(-1), 'late');
  eq(leaveLabel(12), 'Salí en 12 min');
  eq(leaveLabel(0), 'Salí ahora');
  eq(leaveLabel(-3), 'Ya deberías haber salido (hace 3 min)');
  eq(leaveLabel(132, 13 * 60 + 40), 'Salí a las 15:52');
  eq(leaveLabel(45, 600), 'Salí en 45 min');
});
test('formatMinutes', () => {
  eq(formatMinutes(45), '45 min');
  eq(formatMinutes(60), '1 h');
  eq(formatMinutes(70), '1 h 10');
});
test('estimación a pie: Ciudadela → Mercado del Puerto ~ 15 min', () => {
  const m = walkEstimateMin({ lat: -34.90674, lng: -56.20125 }, { lat: -34.9067, lng: -56.2128 });
  ok(m >= 12 && m <= 18, `vino ${m}`);
});

test('lejos: GPS del simulador (Cupertino) vs Montevideo', () => {
  ok(isFarAway({ lat: 37.33, lng: -122.03 }, { lat: -34.9, lng: -56.2 }), 'Cupertino');
  ok(!isFarAway({ lat: -34.9067, lng: -56.2012 }, { lat: -34.915, lng: -56.15 }), 'Pocitos');
});

if (failures) {
  throw new Error(`${failures} test(s) fallaron`);
}
console.log('\nTodo OK');
