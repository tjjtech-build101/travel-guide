// Tests de la lógica pura de los hooks de datos de Ahora v2. Sin red: `pnpm --filter mobile test:nowdata` (tsx).
import type { WeatherDay } from '@build101/shared';

import { pointNear } from '../../../../location/demo';
import type { PlanBlock, PlanOverview } from '../../../plan/selectors';
import { distanceM, walkEstimateMin } from '../../selectors';
import {
  briefKey,
  buildGroupPositions,
  gapAction,
  gapStartTime,
  isNetworkError,
  nowCacheKey,
  parseNowCache,
  rainPlanB,
  serializeNowCache,
  sharingAllowed,
  shouldPublish,
  summarizeTour,
  summarizeWeather,
} from './pure';

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

const JUAN = 'u-juan';
const ANA = 'u-ana';
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

const hour = (h: number, pp: number, code = 3) => ({ h: `${String(h).padStart(2, '0')}:00`, t: 18 + h / 10, pp, mm: pp > 50 ? 2 : 0, code });
const wday = (hourly: WeatherDay['hourly']): WeatherDay => ({ date: '2026-10-18', fetched_at: '', tmax: 22, tmin: 12, precip_prob_max: 80, code: 61, hourly });

console.log('Clima');
test('resumen a la hora local, lluvia en las próximas 3 h', () => {
  const day = wday([hour(13, 10, 0), hour(14, 20, 2), hour(15, 70, 61), hour(16, 90, 63)]);
  const w = summarizeWeather(day, 13 * 60 + 20)!;
  eq(w.icon, 'sun');
  eq(w.temp_c, 19);
  ok(w.rainSoon, 'rainSoon');
  eq(w.rainFrom, '15:00');
  eq(w.summary, 'Despejado · lluvia a las 15:00');
});
test('lluvia a más de 3 h no cuenta; sin día → null', () => {
  const w = summarizeWeather(wday([hour(10, 0, 3), hour(17, 90, 61)]), 10 * 60)!;
  ok(!w.rainSoon, 'no rainSoon');
  eq(w.rainFrom, null);
  eq(w.summary, 'Nublado');
  eq(summarizeWeather(null, 600), null);
});

console.log('Plan B por lluvia');
const rain = { temp_c: 18, icon: 'rain' as const, summary: 'Lluvia', rainSoon: true, rainFrom: '15:00' };
test('bloque al aire libre en la franja + variante rain del día', () => {
  const museo = block({ type: 'meal', title: 'Almuerzo', place_name: 'Bar', start_time: '15:00:00' });
  const rambla = block({ title: 'Rambla en bici', place_name: 'Rambla', start_time: '15:30:00', end_time: '17:00:00' });
  const lejos = block({ title: 'Cena al aire libre', place_name: 'X', start_time: '19:00:00' });
  const planB = block({ title: 'Museo', plan_variant: 'rain', start_time: '15:30:00' });
  const r = rainPlanB({ weather: rain, dayBlocks: [museo, rambla, lejos], allBlocks: [museo, rambla, lejos, planB], dayId: 'd18' });
  eq(r, { blockId: rambla.id, blockTitle: 'Rambla en bici', at: '15:30', hasRainVariant: true });
});
test('bloque en curso cuando empieza a llover: at = hora de la lluvia; sin variante', () => {
  const tour = block({ type: 'tour', title: 'Tour', lat: -34.9, lng: -56.2, start_time: '14:00:00', end_time: '16:00:00' });
  const r = rainPlanB({ weather: rain, dayBlocks: [tour], allBlocks: [tour], dayId: 'd18' });
  eq(r?.at, '15:00');
  eq(r?.hasRainVariant, false);
});
test('sin lluvia, sin lugar o bloque bajo techo → null', () => {
  const sinLugar = block({ title: 'Libre', type: 'free', start_time: '15:00:00' });
  eq(rainPlanB({ weather: { ...rain, rainSoon: false }, dayBlocks: [sinLugar], allBlocks: [], dayId: 'd18' }), null);
  eq(rainPlanB({ weather: rain, dayBlocks: [sinLugar], allBlocks: [], dayId: 'd18' }), null);
  eq(rainPlanB({ weather: null, dayBlocks: [], allBlocks: [], dayId: 'd18' }), null);
});

console.log('Publicar mi ubicación');
const here = { lat: -34.9065, lng: -56.199 };
test('throttle: primera vez, 30 s o 50 m', () => {
  ok(shouldPublish(null, here, 0), 'primera');
  const last = { at: 1_000, ...here };
  ok(!shouldPublish(last, here, 20_000), 'a los 19 s quieto no');
  ok(shouldPublish(last, here, 31_000), 'a los 30 s sí');
  ok(!shouldPublish(last, { lat: here.lat + 0.0003, lng: here.lng }, 5_000), '33 m no');
  ok(shouldPublish(last, { lat: here.lat + 0.0005, lng: here.lng }, 5_000), '55 m sí');
});
test('privacidad: never / fantasma / terminado / shared_only', () => {
  const base = { nowMs: Date.parse('2026-10-18T15:00:00Z'), sharedNow: false, ghostUntil: null };
  ok(!sharingAllowed({ ...base, sharing: 'never', sharedNow: true }), 'never');
  ok(sharingAllowed({ ...base, sharing: 'always' }), 'always');
  ok(!sharingAllowed({ ...base, sharing: 'always', ghostUntil: '2026-10-18T16:00:00Z' }), 'fantasma activo');
  ok(sharingAllowed({ ...base, sharing: 'always', ghostUntil: '2026-10-18T14:00:00Z' }), 'fantasma vencido');
  ok(!sharingAllowed({ ...base, sharing: 'shared_only' }), 'shared_only fuera de bloque compartido');
  ok(sharingAllowed({ ...base, sharing: 'shared_only', sharedNow: true }), 'shared_only en bloque compartido');
  ok(!sharingAllowed({ ...base, sharing: 'always', tripStatus: 'finished' }), 'viaje terminado');
});

console.log('Posiciones del grupo');
test('sin mí, sin viejas (> 15 min), con distancia y nombre', () => {
  const now = Date.parse('2026-10-18T15:00:00Z');
  const members = [
    { id: ANA, display_name: 'Ana', avatar_url: null, role: 'traveler' },
    { id: 'u-leo', display_name: 'Leo', avatar_url: null, role: 'traveler' },
  ] as PlanOverview['members'];
  const rows = [
    { user_id: JUAN, lat: here.lat, lng: here.lng, updated_at: '2026-10-18T14:59:00Z' },
    { user_id: ANA, lat: here.lat + 0.0027, lng: here.lng, updated_at: '2026-10-18T14:58:00Z' },
    { user_id: 'u-leo', lat: here.lat, lng: here.lng, updated_at: '2026-10-18T14:40:00Z' },
  ];
  const g = buildGroupPositions(rows, members, JUAN, here, now);
  eq(g.map((x) => x.display_name), ['Ana']);
  ok(Math.abs(g[0].distance_m! - 300) < 5, `~300 m, vino ${g[0].distance_m}`);
  eq(buildGroupPositions(rows, members, JUAN, null, now)[0].distance_m, null);
});

console.log('Caché offline');
test('serialize → parse ida y vuelta; otro viaje o roto → null', () => {
  const b = block({ title: 'Rambla' });
  const raw = serializeNowCache('t1', { blocks: [b], proposals: [] }, Date.parse('2026-10-18T15:00:00Z'))!;
  const c = parseNowCache(raw, 't1')!;
  eq(c.fetched_at, '2026-10-18T15:00:00.000Z');
  eq(c.blocks?.[0].title, 'Rambla');
  eq(parseNowCache(raw, 't2'), null);
  eq(parseNowCache('{roto', 't1'), null);
  eq(parseNowCache(null, 't1'), null);
  eq(serializeNowCache('t1', {}, 0), null);
  eq(nowCacheKey('t1'), 'now_screen:t1');
});
test('errores de red vs. otros', () => {
  ok(isNetworkError({ message: 'TypeError: Network request failed' }), 'supabase-js');
  ok(isNetworkError({ code: 'network_error', message: 'x' }), 'callTool');
  ok(!isNetworkError({ code: '42501', message: 'permission denied' }), 'RLS');
  ok(!isNetworkError(null), 'null');
});

console.log('Frase de Scout');
test('key estable dentro de 5 min, cambia con el hero', () => {
  const s = { local_time: '15:01', hero: 'leave' as const, next: { title: 'Cena' }, leave_in_min: 12 };
  eq(briefKey({ ...s, local_time: '15:02', leave_in_min: 11 }), briefKey(s));
  ok(briefKey({ ...s, local_time: '15:08', leave_in_min: 5 }) !== briefKey(s), 'cambia a los 5 min');
  ok(briefKey({ ...s, hero: 'current' }) !== briefKey(s), 'cambia con el hero');
  eq(briefKey(null), null);
});

console.log('Sugerencias del hueco');
test('hora del hueco redondeada a 5', () => {
  eq(gapStartTime('15:07'), '15:10');
  eq(gapStartTime('15:10'), '15:10');
});
test('idea → move_block; lugar → add_block personal', () => {
  const ctx = { tripId: 't', legId: 'mvd', dayId: 'd18', me: JUAN, localTime: '15:07', minutes: 45 };
  const base = { place_name: null, lat: null, lng: null, walk_min: 4, why: '' };
  eq(gapAction({ ...base, id: 'i1', source: 'idea', title: 'Mercado', block_id: 'b9' }, ctx), {
    kind: 'move',
    blockId: 'b9',
    dayId: 'd18',
    startTime: '15:10',
    title: 'Mercado',
  });
  const a = gapAction({ ...base, id: 'p1', source: 'place', title: 'Café Brasilero', lat: -34.9, lng: -56.2, google_place_id: 'g1' }, ctx);
  ok(a.kind === 'add', 'add');
  if (a.kind === 'add') {
    eq(a.input.participant_ids, [JUAN]);
    eq(a.input.start_time, '15:10');
    eq(a.input.day_id, 'd18');
    eq(a.input.duration_min, 45);
    eq(a.input.google_place_id, 'g1');
  }
  const e = gapAction({ ...base, id: 'e1', source: 'event', title: 'Candombe', start_time: '16:30' }, ctx);
  ok(e.kind === 'add' && e.input.start_time === '16:30', 'evento con su hora');
});

console.log('Tour y modo demo');
test('resumen del tour ordenado; km por ruta o por línea recta', () => {
  const stop = (sort_order: number, name: string, lat: number) => ({ sort_order, place_library: { name, lat, lng: -56.2 } });
  const t = summarizeTour({ duration_min: 60, route: null, tour_stops: [stop(2, 'B', -34.91), stop(1, 'A', -34.9)] });
  eq(t.stopNames, ['A', 'B']);
  eq(t.stopsCount, 2);
  eq(t.durationMin, 60);
  eq(t.distanceKm, 1.4);
  eq(summarizeTour({ duration_min: null, route: { total_walk_m: 2350, est_duration_min: 75 }, tour_stops: [] }).distanceKm, 2.4);
});
test('pointNear: ~8 min a pie del destino', () => {
  const target = { lat: -34.9067, lng: -56.2012 };
  eq(walkEstimateMin(pointNear(target), target), 8);
  const from = { lat: -34.88, lng: -56.16 };
  const p = pointNear(target, 8, from);
  eq(walkEstimateMin(p, target), 8);
  ok(distanceM(p, from) < distanceM(target, from), 'queda entre from y el destino');
});

if (failures) {
  throw new Error(`${failures} test(s) fallaron`);
}
console.log('\nTodo OK');
