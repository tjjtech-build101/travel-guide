// Tests del modelo de Ahora v2. Sin dependencias: `pnpm --filter mobile test:nowv2` (tsx).
import { NowBriefSnapshot, walkEstimateMin, type DayRow } from '@build101/shared';

import type { PlanBlock, PlanLeg } from '../../plan/selectors';
import { buildNowPlan, type TodayContext } from '../selectors';
import type { Eta } from '../useEta';
import { countdown, dayRail, nearPoint, nextRowLabel, pickHero, pickNotice, showNextRow, toBriefSnapshot } from './model';
import type { HeroMode } from './types';

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

// ───────── Fixture
const ME = 'u-juan';
const DAY: DayRow = { id: 'd18', leg_id: 'mvd', date: '2026-10-18', weather: null, briefing: null };
const LEG = { id: 'mvd', city: 'Montevideo', country: 'Uruguay', days: [DAY], member_ids: [ME] } as unknown as PlanLeg;
const today = (minutes: number): TodayContext => ({ kind: 'today', leg: LEG, day: DAY, date: DAY.date, minutes });

let n = 0;
function block(p: Partial<PlanBlock>): PlanBlock {
  n++;
  return {
    id: `b${n}`,
    trip_id: 't',
    leg_id: 'mvd',
    day_id: 'd18',
    type: 'activity',
    title: `Bloque ${n}`,
    description: null,
    google_place_id: null,
    place_name: null,
    lat: -34.906,
    lng: -56.2,
    start_time: null,
    end_time: null,
    time_flex: 'fixed',
    duration_min: null,
    is_private: false,
    status: 'confirmed',
    plan_variant: 'main',
    tour_id: null,
    sort_order: n,
    created_by: ME,
    created_by_agent: false,
    masked: false,
    participant_ids: [ME],
    ...p,
  } as PlanBlock;
}
const walk = (minutes: number): Eta => ({ minutes, mode: 'walk', estimated: false });
const at = (h: number, m = 0) => h * 60 + m;

function hero(blocks: PlanBlock[], nowMin: number, eta: Eta | null = walk(10), far = false): HeroMode {
  const plan = buildNowPlan(blocks, ME, nowMin);
  return pickHero({ today: today(nowMin), plan, eta, nowMin, far, tourBlocks: blocks });
}

const almuerzo = block({ title: 'Almuerzo Mercado', start_time: '13:00:00', end_time: '14:00:00', place_name: 'Mercado del Puerto' });
const museo = block({ title: 'Museo', start_time: '10:00:00', end_time: '12:00:00' });
const tour = block({ title: 'Ciudad Vieja', type: 'tour', tour_id: 'tour-1', start_time: '15:00:00', end_time: '17:00:00' });
const tourSinId = block({ title: 'Tour suelto', type: 'tour', start_time: '15:00:00', end_time: '17:00:00' });
const llamada = block({ title: 'Llamada de laburo', start_time: '18:00:00', end_time: '19:00:00', lat: null, lng: null });

console.log('pickHero: estados');
test('sin today / noLegs / before / after / noDay', () => {
  eq(pickHero({ today: null, plan: null, eta: null, nowMin: 0, far: false }), { kind: 'state', state: 'noLegs' });
  eq(pickHero({ today: { kind: 'noLegs' }, plan: null, eta: null, nowMin: 0, far: false }).kind, 'state');
  eq(pickHero({ today: { kind: 'before', daysUntil: 3, date: '2026-10-14' }, plan: null, eta: null, nowMin: 0, far: false }), {
    kind: 'state',
    state: 'before',
    daysUntil: 3,
  });
  eq(pickHero({ today: { kind: 'after', date: '2026-10-30' }, plan: null, eta: null, nowMin: 0, far: false }), { kind: 'state', state: 'after' });
  eq(pickHero({ today: { kind: 'noDay', date: '2026-10-22', minutes: 600 }, plan: null, eta: null, nowMin: 600, far: false }), {
    kind: 'state',
    state: 'noDay',
  });
});

console.log('pickHero: leave');
test('salir en ≤ 30 → leave (ok)', () => {
  // 13:00 − 10 ETA − 5 buffer = 12:45; a las 12:20 faltan 25.
  const h = hero([almuerzo], at(12, 20));
  ok(h.kind === 'leave', h.kind);
  if (h.kind === 'leave') {
    eq(h.leaveIn, 25);
    eq(h.urgency, 'ok');
    eq(h.next.block.id, almuerzo.id);
  }
});
test('salir en 31 → no es leave (free con hueco)', () => {
  const h = hero([almuerzo], at(12, 14));
  eq(h.kind, 'free');
});
test('urgencia soon (≤ 5) y late (< 0)', () => {
  const s = hero([almuerzo], at(12, 41));
  eq(s.kind === 'leave' && s.urgency, 'soon');
  const l = hero([almuerzo], at(12, 50));
  eq(l.kind === 'leave' && [l.urgency, l.leaveIn], ['late', -5]);
});
test('leave le gana a current si hay que salir en ≤ 30', () => {
  const cafe = block({ title: 'Café', start_time: '12:00:00', end_time: '12:50:00' });
  eq(hero([cafe, almuerzo], at(12, 30)).kind, 'leave');
});
test('sin ETA, lejos o sin coordenadas → no hay leave', () => {
  eq(hero([almuerzo], at(12, 40), null).kind, 'free');
  eq(hero([almuerzo], at(12, 40), walk(10), true).kind, 'free');
  const sinLugar = block({ title: 'Sin lugar', start_time: '13:00:00', lat: null, lng: null });
  const h = hero([sinLugar], at(12, 40));
  eq(h.kind === 'free' && h.gapMin, 20);
});

console.log('pickHero: tour');
test('tour en curso → tour current', () => {
  const h = hero([tour], at(15, 30));
  eq(h.kind === 'tour' && [h.when, h.inMin, h.block.id], ['current', 0, tour.id]);
});
test('tour próximo en ≤ 60 y salir en > 10 → tour next', () => {
  // ETA 10: salir a las 14:45; a las 14:20 faltan 25 (> 10) → tour gana sobre leave.
  const h = hero([tour], at(14, 20));
  eq(h.kind === 'tour' && [h.when, h.inMin], ['next', 40]);
});
test('tour próximo pero hay que salir en ≤ 10 → leave', () => {
  const h = hero([tour], at(14, 38));
  eq(h.kind === 'leave' && h.leaveIn, 7);
});
test('tour a más de 60 min → no es tour', () => {
  const h = hero([tour], at(13, 30), walk(5));
  eq(h.kind, 'free');
});
test('tour sin tour_id → current común', () => {
  eq(hero([tourSinId], at(15, 30)).kind, 'current');
});
test('tour en curso le gana a salir en 11–30 hacia otro', () => {
  const corto = block({ title: 'Tour corto', type: 'tour', tour_id: 't2', start_time: '12:00:00', end_time: '12:40:00' });
  // Almuerzo 13:00, ETA 10 → salir 12:45; a las 12:25 faltan 20.
  eq(hero([corto, almuerzo], at(12, 25)).kind, 'tour');
  // Con ≤ 10 gana leave.
  eq(hero([corto, almuerzo], at(12, 36)).kind, 'leave');
});
test('tour superpuesto con otro bloque más nuevo: sigue siendo tour (tourBlocks)', () => {
  const t = block({ title: 'Tour largo', type: 'tour', tour_id: 't3', start_time: '10:00:00', end_time: '13:00:00' });
  const foto = block({ title: 'Foto', start_time: '11:00:00', end_time: '11:30:00' });
  const h = hero([t, foto], at(11, 10));
  eq(h.kind === 'tour' && h.block.id, t.id);
  // Sin tourBlocks, el actual (foto) manda.
  const plan = buildNowPlan([t, foto], ME, at(11, 10));
  eq(pickHero({ today: today(at(11, 10)), plan, eta: null, nowMin: at(11, 10), far: false }).kind, 'current');
});

console.log('pickHero: current / free');
test('algo en curso → current', () => {
  const h = hero([museo, almuerzo], at(11, 0));
  eq(h.kind === 'current' && [h.current.block.id, h.current.remainingMin], [museo.id, 60]);
});
test('nada en curso, próximo a 45 → free 45', () => {
  const h = hero([almuerzo], at(12, 15), null);
  eq(h.kind === 'free' && [h.gapMin, h.until?.block.id], [45, almuerzo.id]);
});
test('no queda nada → free null', () => {
  eq(hero([museo], at(20, 0)), { kind: 'free', gapMin: null, until: null });
  eq(hero([], at(9, 0)), { kind: 'free', gapMin: null, until: null });
});

console.log('showNextRow / nextRowLabel');
test('fila solo bajo current o tour, y nunca repite el tour', () => {
  const p1 = buildNowPlan([museo, almuerzo], ME, at(11, 0));
  ok(showNextRow(hero([museo, almuerzo], at(11, 0)), p1), 'current + next');
  const p2 = buildNowPlan([tour], ME, at(14, 20));
  ok(!showNextRow(hero([tour], at(14, 20)), p2), 'el tour próximo no se repite');
  const p3 = buildNowPlan([tour, llamada], ME, at(15, 30));
  ok(showNextRow(hero([tour, llamada], at(15, 30)), p3), 'tour en curso + llamada');
  const p4 = buildNowPlan([almuerzo], ME, at(12, 20));
  ok(!showNextRow(hero([almuerzo], at(12, 20)), p4), 'leave: no');
  ok(!showNextRow({ kind: 'free', gapMin: null, until: null }, { next: null }), 'free: no');
  ok(!showNextRow({ kind: 'current', current: p1.current! }, { next: null }), 'sin next');
  ok(!showNextRow({ kind: 'current', current: p1.current! }, null), 'sin plan');
});
test('nextRowLabel con y sin ETA', () => {
  const next = { block: llamada, start: at(18), inMin: 70 };
  eq(nextRowLabel(next, 0), '18:00 · Llamada de laburo · Salí en 1 h 05');
  eq(nextRowLabel(next), '18:00 · Llamada de laburo · En 1 h 10');
  eq(nextRowLabel({ ...next, inMin: 15 }, 10), '18:00 · Llamada de laburo · Salí ya');
  eq(nextRowLabel({ ...next, inMin: 10 }, 10), '18:00 · Llamada de laburo · Vas tarde');
});

console.log('dayRail');
test('orden, estados y franja al final', () => {
  const cafe = block({ title: 'Café', time_flex: 'afternoon' });
  const desayuno = block({ title: 'Desayuno', time_flex: 'morning' });
  const items = dayRail([cafe, almuerzo, museo, desayuno, llamada], at(11, 0));
  eq(
    items.map((i) => [i.title, i.status]),
    [
      ['Museo', 'now'],
      ['Almuerzo Mercado', 'next'],
      ['Llamada de laburo', 'later'],
      ['Desayuno', 'later'],
      ['Café', 'later'],
    ],
  );
  eq([items[0].start, items[0].end], [600, 720]);
  eq([items[3].start, items[3].end], [null, null]);
});
test('a la tarde: hechos y franja vencida en done', () => {
  const desayuno = block({ title: 'Desayuno', time_flex: 'morning' });
  const items = dayRail([museo, almuerzo, desayuno], at(13, 30));
  eq(items.map((i) => i.status), ['done', 'now', 'done']);
});
test('sin bloques → []', () => {
  eq(dayRail([], 600), []);
});

console.log('countdown');
test('> 10 min: minutos, cada 30 s', () => {
  eq(countdown(25), { text: 'Salí en 25 min', tickMs: 30000 });
  eq(countdown(75, 30), { text: 'Salí en 1 h 15', tickMs: 30000 });
});
test('≤ 10 min: con segundos, cada 1 s', () => {
  eq(countdown(10, 0), { text: '10:00', tickMs: 1000 });
  eq(countdown(7, 30), { text: '6:30', tickMs: 1000 });
  eq(countdown(1, 55), { text: '0:05', tickMs: 1000 });
});
test('salí ya y vas tarde', () => {
  eq(countdown(0, 0), { text: 'Salí ya', tickMs: 1000 });
  eq(countdown(0, 40), { text: 'Salí ya', tickMs: 1000 });
  eq(countdown(-4), { text: 'Vas 4 min tarde', tickMs: 30000 });
  eq(countdown(-70).text, 'Vas 1 h 10 tarde');
});

console.log('pickNotice');
const rain = { blockId: 'b', blockTitle: 'Rambla', at: '15:00', hasRainVariant: true };
test('prioridad offline > rain > proposals', () => {
  eq(pickNotice({ offlineMinutesAgo: 4, rain, proposalsCount: 3 }), { kind: 'offline', minutesAgo: 4 });
  eq(pickNotice({ offlineMinutesAgo: null, rain, proposalsCount: 3 })?.kind, 'rain');
  eq(pickNotice({ offlineMinutesAgo: null, rain: null, proposalsCount: 3 }), { kind: 'proposals', count: 3 });
  eq(pickNotice({ offlineMinutesAgo: null, rain: null, proposalsCount: 0 }), null);
});
test('lluvia sin variante rain no avisa', () => {
  eq(pickNotice({ offlineMinutesAgo: null, rain: { ...rain, hasRainVariant: false }, proposalsCount: 0 }), null);
});
test('offline con 0 min igual avisa', () => {
  eq(pickNotice({ offlineMinutesAgo: 0, rain: null, proposalsCount: 0 }), { kind: 'offline', minutesAgo: 0 });
});

console.log('nearPoint');
test('queda a walkMin a pie del destino', () => {
  const mercado = { lat: -34.9066, lng: -56.2129 };
  eq(walkEstimateMin(nearPoint(mercado), mercado), 8);
  eq(walkEstimateMin(nearPoint(mercado, 3), mercado), 3);
  eq(walkEstimateMin(nearPoint({ lat: 48.8566, lng: 2.3522 }, 12), { lat: 48.8566, lng: 2.3522 }), 12);
  eq(walkEstimateMin(nearPoint(mercado, 1), mercado), 1);
});

console.log('toBriefSnapshot');
test('leave: next, leave_in, walk', () => {
  const plan = buildNowPlan([almuerzo], ME, at(12, 20));
  const h = hero([almuerzo], at(12, 20));
  const s = toBriefSnapshot({ hero: h, nowMin: at(12, 20), city: 'Montevideo', plan, eta: walk(10) });
  eq(s.hero, 'leave');
  eq(s.local_time, '12:20');
  eq(s.next, { title: 'Almuerzo Mercado', type: 'activity', place_name: 'Mercado del Puerto', start_time: '13:00', end_time: '14:00' });
  eq([s.leave_in_min, s.walk_min, s.gap_min, s.current], [25, 10, null, null]);
  ok(NowBriefSnapshot.safeParse(s).success, 'cumple el contrato');
});
test('free: gap, sugerencias (≤ 2), clima y grupo', () => {
  const plan = buildNowPlan([almuerzo], ME, at(12, 0));
  const h = hero([almuerzo], at(12, 0), null);
  const sug = (t: string) => ({ id: t, source: 'idea' as const, title: t, place_name: null, lat: null, lng: null, walk_min: 4.4, why: '' });
  const s = toBriefSnapshot({
    hero: h,
    nowMin: at(12, 0),
    plan,
    eta: { minutes: 30, mode: 'transit', estimated: false },
    weather: { temp_c: 19, icon: 'sun', summary: 'Soleado', rainSoon: false, rainFrom: null },
    suggestions: [sug('A'), sug('B'), sug('C')],
    group: [{ user_id: 'x', display_name: null, avatar_url: null, lat: 0, lng: 0, updated_at: '', distance_m: 299.6 }],
  });
  eq([s.hero, s.gap_min, s.walk_min], ['free', 60, null]);
  eq(s.suggestions, [
    { title: 'A', walk_min: 4 },
    { title: 'B', walk_min: 4 },
  ]);
  eq(s.weather, { temp_c: 19, summary: 'Soleado', rain_soon: false });
  eq(s.group, [{ name: 'Alguien', distance_m: 300 }]);
  ok(NowBriefSnapshot.safeParse(s).success, 'cumple el contrato');
});
test('tour next: el tour va como next; current: el bloque', () => {
  const plan = buildNowPlan([tour], ME, at(14, 20));
  const s = toBriefSnapshot({ hero: hero([tour], at(14, 20)), nowMin: at(14, 20), plan });
  eq([s.hero, s.next?.title, s.current], ['tour', 'Ciudad Vieja', null]);
  const plan2 = buildNowPlan([museo, almuerzo], ME, at(11, 0));
  const s2 = toBriefSnapshot({ hero: hero([museo, almuerzo], at(11, 0)), nowMin: at(11, 0), plan: plan2 });
  eq([s2.hero, s2.current?.title, s2.next?.title], ['current', 'Museo', 'Almuerzo Mercado']);
  ok(NowBriefSnapshot.safeParse(s2).success, 'cumple el contrato');
});
test('state: sin bloques', () => {
  const s = toBriefSnapshot({ hero: { kind: 'state', state: 'before', daysUntil: 2 }, nowMin: at(10) });
  eq([s.hero, s.current, s.next, s.local_time], ['state', null, null, '10:00']);
  ok(NowBriefSnapshot.safeParse(s).success, 'cumple el contrato');
});

if (failures) {
  throw new Error(`${failures} test(s) fallaron`);
}
console.log('\nTodo OK');
