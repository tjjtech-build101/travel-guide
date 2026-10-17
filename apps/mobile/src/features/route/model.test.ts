// Tests del modelo de "Cómo llego". Sin red: `pnpm --filter mobile exec tsx src/features/route/model.test.ts`.
import type { RouteStepDetail } from '@build101/shared';

import {
  defaultMode,
  announceKey,
  externalApps,
  externalUrls,
  formatDistance,
  hasTransitTimes,
  headline,
  maneuverKind,
  nextInstruction,
  rideDetail,
  rideTitle,
  toRouteDetail,
  transitTimeline,
  voseo,
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
  if (a !== b) throw new Error(`${msg} esperaba ${b}, vino ${a}`);
}

const P = { lat: -34.9, lng: -56.2 };
const Q = { lat: -34.91, lng: -56.21 };
const step = (instruction: string, maneuver: string | null, extra: Partial<RouteStepDetail> = {}): RouteStepDetail => ({
  instruction,
  maneuver,
  distance_m: 100,
  duration_min: 1,
  start: P,
  end: Q,
  ...extra,
});

console.log('route/model');

test('defaultMode: a pie ≤ 25, si no transporte; sin dato → a pie', () => {
  eq(defaultMode(12), 'walk');
  eq(defaultMode(25), 'walk');
  eq(defaultMode(26), 'transit');
  eq(defaultMode(null), 'walk');
});

test('formatDistance', () => {
  eq(formatDistance(83), '80 m');
  eq(formatDistance(900), '900 m');
  eq(formatDistance(1234), '1,2 km');
  eq(formatDistance(15400), '15 km');
});

test('headline: Llegás + min · m; sin bloque no hay "Salí en"', () => {
  const h = headline({ nowMin: 15 * 60 + 40, etaMin: 12, distanceM: 900 });
  eq(h.title, 'Llegás 15:52');
  eq(h.sub, '12 min · 900 m');
  eq(h.leave, null);
});

test('headline: "Salí en" es el título y la llegada se cuenta desde esa salida (no desde ahora)', () => {
  // 15:30, 6 min a pie, empieza 16:00 → salí en 19 min (15:49) y llegás 15:55.
  const h = headline({ nowMin: 15 * 60 + 30, etaMin: 6, distanceM: 450, startMin: 16 * 60 });
  eq(h.title, 'Salí en 19 min');
  eq(h.sub, '6 min · 450 m · llegás 15:55');
  eq(h.leave, null);
});

test('headline: "Salí ya" y "Vas X tarde" junto a "Llegás" (misma cuenta que Ahora, −5 min)', () => {
  eq(headline({ nowMin: 600, etaMin: 10, distanceM: 0, startMin: 615 }), { title: 'Llegás 10:10', sub: '10 min', leave: { text: 'Salí ya', tone: 'soon' } });
  eq(headline({ nowMin: 600, etaMin: 10, distanceM: 0, startMin: 610 }).leave, { text: 'Vas 5 min tarde', tone: 'late' });
});

test('announceKey: no cambia con la distancia, sí al llegar a la maniobra y al cambiar de paso', () => {
  const a = announceKey({ text: 'En 230 m, doblá a la derecha', kind: 'right', distanceM: 230 });
  const b = announceKey({ text: 'En 180 m, doblá a la derecha', kind: 'right', distanceM: 180 });
  const c = announceKey({ text: 'Ahora, doblá a la derecha', kind: 'right', distanceM: 10 });
  const d = announceKey({ text: 'En 300 m, doblá a la izquierda', kind: 'left', distanceM: 300 });
  eq(a, b);
  eq(a === c, false);
  eq(a === d, false);
});

test('voseo: imperativos de Google → rioplatense, idempotente', () => {
  eq(voseo('Gira a la derecha en Sarandí'), 'Doblá a la derecha en Sarandí');
  eq(voseo('Dirígete al norte por Rincón'), 'Andá al norte por Rincón');
  eq(voseo('Continúa por 25 de Mayo'), 'Seguí por 25 de Mayo');
  eq(voseo('Doblá a la derecha'), 'Doblá a la derecha');
  eq(voseo('Tomá la escalera'), 'Tomá la escalera');
  eq(voseo('Sal de la rotonda'), 'Salí de la rotonda');
  eq(voseo('Salí de la rotonda'), 'Salí de la rotonda');
  eq(voseo('Gira levemente a la izquierda y sigue por Colón'), 'Doblá levemente a la izquierda y seguí por Colón');
});

test('maneuverKind', () => {
  eq(maneuverKind('TURN_RIGHT'), 'right');
  eq(maneuverKind('TURN_SLIGHT_LEFT'), 'slightLeft');
  eq(maneuverKind('UTURN_LEFT'), 'uturn');
  eq(maneuverKind('ROUNDABOUT_RIGHT'), 'roundabout');
  eq(maneuverKind('STRAIGHT'), 'straight');
  eq(maneuverKind(null, 'Gira a la izquierda'), 'left');
  eq(maneuverKind(null, 'Andá al norte'), 'straight');
});

test('nextInstruction: la maniobra del paso siguiente, con distancia', () => {
  const steps = [step('Dirígete al oeste por Rincón', 'DEPART'), step('Gira a la derecha en Sarandí', 'TURN_RIGHT'), step('Gira a la izquierda', 'TURN_LEFT')];
  eq(nextInstruction({ steps, stepIndex: 0, distanceToStepEndM: 83, destName: 'el Cabildo' }), {
    text: 'En 80 m, doblá a la derecha en Sarandí',
    kind: 'right',
    distanceM: 83,
  });
  eq(nextInstruction({ steps, stepIndex: 1, distanceToStepEndM: 10, destName: 'el Cabildo' }).text, 'Ahora, doblá a la izquierda');
  const last = nextInstruction({ steps, stepIndex: 2, distanceToStepEndM: 140, destName: 'el Cabildo' });
  eq(last.text, 'En 140 m, llegás al Cabildo');
  eq(last.kind, 'arrive');
});

test('nextInstruction sin pasos (estimada)', () => {
  eq(nextInstruction({ steps: [], stepIndex: -1, distanceToStepEndM: 640, destName: 'Plaza' }).text, 'Seguí hacia Plaza: faltan 640 m');
});

test('toRouteDetail: usa `detail` si viene', () => {
  const detail = { mode: 'walk' as const, duration_min: 9, distance_m: 700, polyline: 'abc', steps: [], estimated: false };
  eq(toRouteDetail({ detail }, 'walk', P, Q), detail);
});

test('toRouteDetail: sin `detail` arma uno con el segmento (y estimado sin polilínea)', () => {
  const d = toRouteDetail({ segments: [{ duration_min: 7, distance_m: 550, polyline: 'xyz' }], total_min: 7 }, 'walk', P, Q);
  eq([d.duration_min, d.distance_m, d.polyline, d.estimated, d.steps.length], [7, 550, 'xyz', false, 0]);
  const e = toRouteDetail({ segments: [{ duration_min: 7, distance_m: 550, polyline: null }], total_min: 7, estimated: true }, 'car', P, Q);
  eq([e.estimated, e.mode], [true, 'car']);
});

test('toRouteDetail: transporte sin `detail` → pasos desde las líneas', () => {
  const d = toRouteDetail(
    {
      segments: [{ duration_min: 20, distance_m: 4000, polyline: 'p' }],
      transit: {
        duration_min: 24,
        walk_before_min: 4,
        walk_after_min: 3,
        lines: [{ name: '121', vehicle: 'bus', from_stop: 'Ciudadela', to_stop: 'Pocitos', departure: '18:05', stops: 6, headsign: 'Pocitos' }],
      },
    },
    'transit',
    P,
    Q,
  );
  eq(d.duration_min, 24);
  const tl = transitTimeline(d.steps);
  eq(tl.map((i) => i.kind), ['walk', 'ride', 'walk']);
  eq(tl[0].kind === 'walk' ? tl[0].to : null, 'Ciudadela');
  eq(hasTransitTimes(d.steps), true);
});

test('transitTimeline junta caminatas seguidas', () => {
  const steps = [
    step('Camina', null, { distance_m: 100, duration_min: 2 }),
    step('Gira', 'TURN_LEFT', { distance_m: 50, duration_min: 1 }),
    step('Bus', null, { transit: { line: '121', vehicle: 'bus', from_stop: 'A', departure: '18:05', stops: 6, headsign: 'Pocitos' }, duration_min: 12 }),
    step('Camina', null, { distance_m: 200, duration_min: 3 }),
  ];
  const tl = transitTimeline(steps);
  eq(tl.length, 3);
  eq(tl[0], { kind: 'walk', min: 3, m: 150, to: 'A' });
  const ride = tl[1];
  if (ride.kind !== 'ride') throw new Error('esperaba ride');
  eq(rideTitle(ride), 'Bus 121');
  eq(rideDetail(ride), 'Sale 18:05 desde A · 6 paradas · dirección Pocitos');
  eq(hasTransitTimes([steps[0]]), false);
});

test('externalUrls: esquema + fallback web por modo; Waze siempre maneja', () => {
  eq(externalUrls('apple', 'walk', P).scheme, 'maps://?daddr=-34.9,-56.2&dirflg=w');
  eq(externalUrls('apple', 'transit', P).scheme, 'maps://?daddr=-34.9,-56.2&dirflg=r');
  eq(externalUrls('apple', 'car', P).scheme, 'maps://?daddr=-34.9,-56.2&dirflg=d');
  eq(externalUrls('google', 'transit', P), {
    scheme: 'comgooglemaps://?daddr=-34.9,-56.2&directionsmode=transit',
    web: 'https://www.google.com/maps/dir/?api=1&destination=-34.9,-56.2&travelmode=transit',
  });
  eq(externalUrls('waze', 'walk', P), { scheme: 'waze://?ll=-34.9,-56.2&navigate=yes', web: 'https://waze.com/ul?ll=-34.9,-56.2&navigate=yes' });
  eq(externalApps('ios', 'car'), ['apple', 'google', 'waze']);
  eq(externalApps('android', 'car'), ['google', 'waze']);
  // Waze siempre arma ruta en auto: a pie o en transporte no aparece.
  eq(externalApps('ios', 'walk'), ['apple', 'google']);
  eq(externalApps('android', 'transit'), ['google']);
});

if (failures) {
  console.log(`\n${failures} test(s) fallaron`);
  process.exit(1);
}
console.log('\nOK');
