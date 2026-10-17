// Tests de los selectores del Plan. Sin dependencias: `pnpm --filter mobile test:plan` (tsx).
// Cada caso tira si falla; al final se tira un error si hubo fallas (exit code ≠ 0).
import type { DayRow } from '@build101/shared';

import { buildIcs } from './ics';
import {
  branchFor,
  buildDayShareText,
  buildPlanSections,
  compareBlocks,
  durationLabel,
  groupLegs,
  parallelDates,
  selectBranch,
  timeLabel,
  type PlanBlock,
  type PlanLeg,
  type PlanRow,
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
const ANA = 'u-ana';
const LEO = 'u-leo';
const SOFI = 'u-sofi';

const day = (id: string, leg_id: string, date: string): DayRow => ({ id, leg_id, date, weather: null, briefing: null });
const leg = (id: string, start: string, end: string, sort: number, members: string[], days: DayRow[], city = id): PlanLeg => ({
  id,
  trip_id: 't',
  city,
  country: 'UY',
  google_place_id: null,
  lat: null,
  lng: null,
  start_date: start,
  end_date: end,
  sort_order: sort,
  member_ids: members,
  days,
});

const legs: PlanLeg[] = [
  leg('mvd', '2026-10-17', '2026-10-19', 1, [JUAN, ANA, LEO, SOFI], [day('d17', 'mvd', '2026-10-17'), day('d18', 'mvd', '2026-10-18'), day('d19', 'mvd', '2026-10-19')], 'Montevideo'),
  leg('col', '2026-10-20', '2026-10-21', 2, [JUAN, ANA, LEO], [day('c20', 'col', '2026-10-20'), day('c21', 'col', '2026-10-21')], 'Colonia'),
  leg('bas', '2026-10-20', '2026-10-21', 2, [SOFI], [day('b20', 'bas', '2026-10-20'), day('b21', 'bas', '2026-10-21')], 'Buenos Aires'),
  leg('ba', '2026-10-22', '2026-10-24', 3, [JUAN, ANA, LEO, SOFI], [day('a22', 'ba', '2026-10-22')], 'Buenos Aires'),
];

let n = 0;
function block(p: Partial<PlanBlock> & { leg_id: string; day_id: string | null }): PlanBlock {
  n++;
  return {
    id: p.id ?? `b${n}`,
    trip_id: 't',
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
    participant_ids: [JUAN, ANA, LEO, SOFI],
    ...p,
  };
}

const ALL4 = [JUAN, ANA, LEO, SOFI];
const blocks: PlanBlock[] = [
  block({ id: 'feria', leg_id: 'mvd', day_id: 'd18', title: 'Feria', start_time: '09:00:00', end_time: '10:30:00', participant_ids: ALL4 }),
  block({ id: 'teatro', leg_id: 'mvd', day_id: 'd18', title: 'Teatro Solís', start_time: '16:00:00', end_time: '17:00:00', participant_ids: ALL4 }),
  block({ id: 'tour', leg_id: 'mvd', day_id: 'd18', type: 'tour', title: 'Ciudad Vieja', start_time: '11:00:00', end_time: '13:30:00', participant_ids: ALL4 }),
  block({ id: 'noche', leg_id: 'mvd', day_id: 'd18', title: 'Algo de noche', time_flex: 'evening', sort_order: 1, participant_ids: [JUAN, ANA] }),
  block({ id: 'cuando', leg_id: 'mvd', day_id: 'd18', title: 'Cuando sea', time_flex: 'any', sort_order: 0, participant_ids: [JUAN] }),
  block({ id: 'manana', leg_id: 'mvd', day_id: 'd18', title: 'Mañana', time_flex: 'morning', sort_order: 9, participant_ids: [ANA] }),
  block({ id: 'llamada', leg_id: 'mvd', day_id: 'd18', title: 'Llamada de laburo', start_time: '18:00:00', end_time: '19:00:00', is_private: true, participant_ids: [JUAN] }),
  block({ id: 'chivito', leg_id: 'mvd', day_id: null, title: 'Chivito', status: 'idea', participant_ids: ALL4 }),
  block({ id: 'bus', leg_id: 'col', day_id: 'c20', title: 'Bus', start_time: '08:30:00', participant_ids: [JUAN, ANA, LEO] }),
  block({ id: 'ferry', leg_id: 'bas', day_id: 'b20', title: 'Ferry', start_time: '08:00:00', participant_ids: [SOFI] }),
  block({ id: 'rain', leg_id: 'mvd', day_id: 'd19', title: 'Plan B', plan_variant: 'rain', participant_ids: ALL4 }),
];

// Vista de Sofi: el privado de Juan llega enmascarado y sin participantes (RLS).
const sofiBlocks = blocks.map((b) => (b.id === 'llamada' ? { ...b, title: 'Ocupado', masked: true, participant_ids: [] } : b));

const titlesOfDay = (rows: PlanRow[], dayId: string) => {
  const out: string[] = [];
  let inDay = false;
  for (const r of rows) {
    if (r.kind === 'day') inDay = r.day.id === dayId;
    else if (r.kind === 'group' || r.kind === 'ideas' || r.kind === 'parallelDay') inDay = false;
    else if (inDay && r.kind === 'block') out.push(r.block.title);
  }
  return out;
};

console.log('selectors');

test('orden: con hora primero, después mañana/tarde/noche, any al final', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: JUAN });
  eq(titlesOfDay(s.rows, 'd18'), ['Feria', 'Ciudad Vieja', 'Teatro Solís', 'Llamada de laburo', 'Mañana', 'Algo de noche', 'Cuando sea']);
});

test('compareBlocks desempata por sort_order', () => {
  const a = { start_time: '10:00', time_flex: 'fixed' as const, sort_order: 2 };
  const b = { start_time: '10:00:00', time_flex: 'fixed' as const, sort_order: 1 };
  ok(compareBlocks(a, b) > 0, 'a debería ir después');
});

test('filtro Del grupo = ≥ 2 participantes', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'group', branchByDate: {}, me: JUAN });
  eq(titlesOfDay(s.rows, 'd18'), ['Feria', 'Ciudad Vieja', 'Teatro Solís', 'Algo de noche']);
});

test('filtro Lo mío = soy participante', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'mine', branchByDate: {}, me: ANA });
  eq(titlesOfDay(s.rows, 'd18'), ['Feria', 'Ciudad Vieja', 'Teatro Solís', 'Mañana', 'Algo de noche']);
});

test('Ocupado: Sofi ve el privado de Juan enmascarado en Todo y no en Lo mío / Del grupo', () => {
  const all = buildPlanSections({ legs, blocks: sofiBlocks, filter: 'all', branchByDate: {}, me: SOFI });
  const row = all.rows.find((r) => r.kind === 'block' && r.block.id === 'llamada');
  ok(row && row.kind === 'block' && row.block.masked && row.block.title === 'Ocupado', 'debería verse Ocupado');
  const mine = buildPlanSections({ legs, blocks: sofiBlocks, filter: 'mine', branchByDate: {}, me: SOFI });
  ok(!titlesOfDay(mine.rows, 'd18').includes('Ocupado'), 'no debería estar en Lo mío');
  const group = buildPlanSections({ legs, blocks: sofiBlocks, filter: 'group', branchByDate: {}, me: SOFI });
  ok(!titlesOfDay(group.rows, 'd18').includes('Ocupado'), 'no debería estar en Del grupo');
});

test('día vacío vs filtro sin resultados', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'mine', branchByDate: {}, me: LEO });
  const d17 = s.rows.find((r) => r.kind === 'dayEmpty' && r.day.id === 'd17');
  ok(d17 && d17.kind === 'dayEmpty' && d17.reason === 'empty', 'd17 vacío');
  const c20 = s.rows.find((r) => r.kind === 'dayEmpty' && r.day.id === 'd19');
  ok(c20 && c20.kind === 'dayEmpty' && c20.reason === 'empty', 'd19: el plan B no cuenta');
  const s2 = buildPlanSections({ legs, blocks, filter: 'mine', branchByDate: {}, me: SOFI });
  const c = s2.rows.find((r) => r.kind === 'dayEmpty' && r.day.id === 'd18');
  ok(!c, 'Sofi tiene cosas el 18');
});

test('tramos paralelos: detecta 20–21 y agrupa', () => {
  eq(parallelDates(legs), ['2026-10-20', '2026-10-21']);
  const g = groupLegs(legs);
  eq(g.map((x) => x.legs.map((l) => l.id)), [['mvd'], ['bas', 'col'], ['ba']]); // empate: por id
  eq(g[1].parallel, true);
});

test('rama por defecto = la del usuario; Sofi ve Buenos Aires, Juan ve Colonia', () => {
  const g = groupLegs(legs)[1];
  eq(branchFor('2026-10-20', g, {}, SOFI)?.id, 'bas');
  eq(branchFor('2026-10-20', g, {}, JUAN)?.id, 'col');
  const sofi = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: SOFI });
  ok(sofi.rows.some((r) => r.kind === 'day' && r.day.id === 'b20'), 'Sofi ve b20');
  ok(!sofi.rows.some((r) => r.kind === 'day' && r.day.id === 'c20'), 'Sofi no ve c20');
});

test('cambiar de rama con selectBranch', () => {
  const g = groupLegs(legs)[1];
  const branch = selectBranch({}, g, 'col');
  eq(branch, { '2026-10-20': 'col', '2026-10-21': 'col' });
  const s = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: branch, me: SOFI });
  ok(s.rows.some((r) => r.kind === 'day' && r.day.id === 'c20'), 've c20');
  const header = s.rows.find((r) => r.kind === 'group' && r.group.parallel);
  ok(header && header.kind === 'group' && header.activeLegIds.join() === 'col', 'chip activo col');
});

test('Ver en paralelo: 2 columnas por fecha', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: SOFI, parallelView: true });
  const p = s.rows.filter((r) => r.kind === 'parallelDay');
  eq(p.length, 2);
  const first = p[0];
  ok(first.kind === 'parallelDay' && first.columns.length === 2, '2 columnas');
  if (first.kind === 'parallelDay') eq(first.columns.map((c) => c.blocks.map((b) => b.title)), [['Ferry'], ['Bus']]);
});

test('banco de ideas: contador y plegado', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: JUAN });
  const ideas = s.rows.find((r) => r.kind === 'ideas' && r.leg.id === 'mvd');
  ok(ideas && ideas.kind === 'ideas' && ideas.count === 1 && !ideas.expanded, 'Banco (1) plegado');
  ok(!s.rows.some((r) => r.kind === 'idea'), 'plegado = sin filas de idea');
  const s2 = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: JUAN, expandedIdeas: { mvd: true } });
  ok(s2.rows.some((r) => r.kind === 'idea' && r.block.id === 'chivito'), 'expandido muestra el chivito');
});

test('propuesta add → tarjeta fantasma en su día', () => {
  const s = buildPlanSections({
    legs,
    blocks,
    filter: 'all',
    branchByDate: {},
    me: JUAN,
    proposals: [{ id: 'p1', ops: [{ op: 'add', block: { title: 'Parrilla X', day_id: 'd19', start_time: '21:00' } }] }],
  });
  const g = s.rows.find((r) => r.kind === 'ghost');
  ok(g && g.kind === 'ghost' && g.ghost.title === 'Parrilla X', 'fantasma');
  ok(!s.rows.some((r) => r.kind === 'dayEmpty' && r.day.id === 'd19'), 'el día con fantasma no está vacío');
});

test('índices para scroll: cada tramo y día tiene fila', () => {
  const s = buildPlanSections({ legs, blocks, filter: 'all', branchByDate: {}, me: JUAN });
  for (const l of legs) ok(s.legRowIndex[l.id] !== undefined, `tramo ${l.id}`);
  eq(s.rows[s.dayRowIndex.d18].kind, 'day');
});

test('timeLabel y durationLabel', () => {
  eq(timeLabel({ start_time: '11:00:00', end_time: '13:30:00', time_flex: 'fixed' }), '11:00–13:30');
  eq(timeLabel({ start_time: null, end_time: null, time_flex: 'afternoon' }), 'Tarde');
  eq(timeLabel({ start_time: null, end_time: null, time_flex: 'any' }), 'Cuando sea');
  eq(durationLabel(165), '2 h 45');
  eq(durationLabel(45), '45 min');
});

test('compartir día', () => {
  const text = buildDayShareText({ city: 'Montevideo' }, { date: '2026-10-18' }, sofiBlocks.filter((b) => b.day_id === 'd18'));
  const lines = text.split('\n');
  eq(lines[0], 'Dom 18/10 · Montevideo');
  eq(lines[2], '11:00 Tour Ciudad Vieja');
  ok(lines.includes('18:00 Ocupado'), 'privado ajeno como Ocupado');
});

test('.ics: VEVENT con hora flotante, día completo y escapado', () => {
  const ics = buildIcs(
    [
      block({ id: 'x1', leg_id: 'mvd', day_id: 'd18', title: 'Teatro, visita; guiada', start_time: '16:00:00', end_time: '17:00:00', place_name: 'Teatro Solís' }),
      block({ id: 'x2', leg_id: 'mvd', day_id: 'd18', title: 'Libre', time_flex: 'afternoon' }),
      block({ id: 'x3', leg_id: 'mvd', day_id: null, title: 'Idea' }),
    ],
    legs[0].days,
    'Viaje',
    new Date(Date.UTC(2026, 9, 17, 12, 0, 0)),
  );
  ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//build101//ES'), 'cabecera');
  ok(ics.includes('DTSTART:20261018T160000\r\nDTEND:20261018T170000'), 'hora flotante');
  ok(ics.includes('SUMMARY:Teatro\\, visita\\; guiada'), 'escapado');
  ok(ics.includes('DTSTART;VALUE=DATE:20261018\r\nDTEND;VALUE=DATE:20261019'), 'día completo');
  ok(ics.includes('DTSTAMP:20261017T120000Z'), 'DTSTAMP UTC');
  eq(ics.split('BEGIN:VEVENT').length - 1, 2, 'sin la idea');
  ok(ics.endsWith('END:VCALENDAR\r\n'), 'cierre');
});

test('.ics: líneas plegadas a ≤ 75 octetos sin romper UTF-8', () => {
  const ics = buildIcs(
    [block({ id: 'x9', leg_id: 'mvd', day_id: 'd18', title: 'Visita guiada al Teatro Solís con explicación de la acústica y la historia del edificio ñandú', start_time: '10:00:00' })],
    legs[0].days,
    'Viaje',
  );
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) ok(enc.encode(line).length <= 75, `línea larga: ${line}`);
  const summary = ics.split('\r\n').filter((l, i, arr) => l.startsWith('SUMMARY') || (l.startsWith(' ') && arr[i - 1]?.startsWith('SUMMARY')));
  ok(summary.length >= 2, 'debería plegarse');
  ok(summary.map((l, i) => (i ? l.slice(1) : l)).join('').endsWith('ñandú'), 'reconstruye el texto');
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('ok');
