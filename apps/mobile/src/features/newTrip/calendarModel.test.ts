// Tests del calendario de "Nuevo viaje". `npx tsx src/features/newTrip/calendarModel.test.ts` desde apps/mobile.
import {
  addDays,
  canShift,
  clampDays,
  daysInclusive,
  decodeRange,
  encodeRange,
  initialView,
  inRange,
  isMonthPast,
  isPast,
  monthGrid,
  monthTitle,
  pickYear,
  rangeSummary,
  shiftMonth,
  shortDay,
  spokenDay,
  tapDay,
  todayIso,
  weekdayMon,
  yearOptions,
} from './calendarModel';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(a: unknown, b: unknown) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`esperaba ${sb}\n    obtuve    ${sa}`);
}

const TODAY = '2026-10-18'; // domingo

console.log('newTrip/calendarModel');

test('todayIso en hora local', () => {
  eq(todayIso(new Date(2026, 9, 18, 23, 59)), '2026-10-18');
  eq(todayIso(new Date(2027, 0, 1, 0, 1)), '2027-01-01');
});

test('monthGrid: semana arranca el lunes, huecos con null', () => {
  // Octubre 2026: el 1 es jueves → 3 huecos (lu, ma, mi).
  const g = monthGrid(2026, 9);
  eq(g[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  eq(g.every((w) => w.length === 7), true);
  eq(g.flat().filter(Boolean).length, 31);
  eq(g[g.length - 1]!.includes('2026-10-31'), true);
  // Febrero 2027 (no bisiesto) arranca lunes: sin huecos adelante.
  const f = monthGrid(2027, 1);
  eq(f[0]![0], '2027-02-01');
  eq(f.flat().filter(Boolean).length, 28);
  eq(monthGrid(2028, 1).flat().filter(Boolean).length, 29);
  eq(weekdayMon('2026-10-18'), 6);
});

test('monthTitle / shiftMonth cruzan el año', () => {
  eq(monthTitle({ y: 2027, m: 9 }), 'octubre 2027');
  eq(shiftMonth({ y: 2026, m: 11 }, 1), { y: 2027, m: 0 });
  eq(shiftMonth({ y: 2027, m: 0 }, -1), { y: 2026, m: 11 });
  eq(shiftMonth({ y: 2026, m: 9 }, 15), { y: 2028, m: 0 });
});

test('años: actual hasta +3; navegación acotada', () => {
  eq(yearOptions(TODAY), [2026, 2027, 2028, 2029]);
  eq(canShift({ y: 2026, m: 9 }, -1, TODAY), false);
  eq(canShift({ y: 2026, m: 9 }, 1, TODAY), true);
  eq(canShift({ y: 2029, m: 11 }, 1, TODAY), false);
  eq(isMonthPast({ y: 2026, m: 8 }, TODAY), true);
  eq(isMonthPast({ y: 2026, m: 9 }, TODAY), false);
});

test('pickYear: mantiene el mes si no queda en el pasado', () => {
  eq(pickYear({ y: 2027, m: 2 }, 2028, TODAY), { y: 2028, m: 2 });
  eq(pickYear({ y: 2027, m: 2 }, 2026, TODAY), { y: 2026, m: 9 });
  eq(initialView({ start: '2027-10-24', end: null }, TODAY), { y: 2027, m: 9 });
  eq(initialView({ start: null, end: null }, TODAY), { y: 2026, m: 9 });
});

test('días pasados', () => {
  eq(isPast('2026-10-17', TODAY), true);
  eq(isPast(TODAY, TODAY), false);
});

test('tapDay: llegada → salida, reinicios', () => {
  let r = tapDay({ start: null, end: null }, '2027-10-24');
  eq(r, { start: '2027-10-24', end: null });
  r = tapDay(r, '2027-10-29');
  eq(r, { start: '2027-10-24', end: '2027-10-29' });
  eq(inRange('2027-10-26', r), true);
  eq(inRange('2027-10-24', r), false);
  // Con el rango completo, el próximo toque arranca de nuevo.
  eq(tapDay(r, '2027-11-02'), { start: '2027-11-02', end: null });
  // Antes de la llegada (o la misma): nueva llegada.
  eq(tapDay({ start: '2027-10-24', end: null }, '2027-10-20'), { start: '2027-10-20', end: null });
  eq(tapDay({ start: '2027-10-24', end: null }, '2027-10-24'), { start: '2027-10-24', end: null });
  // Más de 60 días: arranca de nuevo.
  eq(tapDay({ start: '2027-01-01', end: null }, '2027-03-15'), { start: '2027-03-15', end: null });
});

test('daysInclusive / addDays / clampDays', () => {
  eq(daysInclusive('2027-10-24', '2027-10-29'), 6);
  eq(daysInclusive('2027-10-24', '2027-10-24'), 1);
  eq(daysInclusive('2026-12-30', '2027-01-02'), 4);
  eq(addDays('2027-10-24', 5), '2027-10-29');
  eq(addDays('2026-12-31', 1), '2027-01-01');
  eq(clampDays(0), 1);
  eq(clampDays(75), 60);
  eq(clampDays(9.4), 9);
});

test('encode/decodeRange', () => {
  eq(encodeRange({ start: '2027-10-24', end: '2027-10-29' }), '2027-10-24/2027-10-29');
  eq(encodeRange({ start: '2027-10-24', end: null }), '2027-10-24');
  eq(encodeRange({ start: null, end: null }), '');
  eq(decodeRange('2027-10-24/2027-10-29'), { start: '2027-10-24', end: '2027-10-29' });
  eq(decodeRange('2027-10-24'), { start: '2027-10-24', end: null });
  eq(decodeRange('2027-10-24/2027-10-20'), { start: '2027-10-24', end: null });
  eq(decodeRange('flex'), null);
  eq(decodeRange(''), null);
});

test('textos: día corto, hablado y resumen', () => {
  eq(shortDay('2026-10-24', TODAY), 'sáb 24 oct');
  eq(shortDay('2027-10-24', TODAY), 'dom 24 oct 2027');
  eq(spokenDay('2027-10-24'), 'domingo 24 de octubre de 2027');
  eq(rangeSummary({ start: null, end: null }), 'Tocá el día de llegada');
  eq(rangeSummary({ start: '2026-10-24', end: null }, TODAY), 'Llegada: sáb 24 oct · tocá la salida (opcional)');
  eq(rangeSummary({ start: '2026-10-24', end: '2026-10-29' }, TODAY), 'sáb 24 oct → jue 29 oct · 6 días');
});

if (failures) {
  console.error(`\n${failures} test(s) fallaron`);
  process.exit(1);
}
console.log('\nTodo OK');
