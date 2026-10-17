import { describe, expect, it } from 'vitest';
import { checkPlan, dayFrame, isOpenOn, normProb, repairPlan, transferFor, weekdayOf } from './check';
import { composeLeg } from './compose';
import { byId, DAYS, fakeSearch, group, ITEMS, leg, pick } from './composeTestKit';
import type { ComposedBlock } from './types';

const blk = (over: Partial<ComposedBlock>): ComposedBlock => ({
  type: 'activity',
  title: 'X',
  time_flex: 'morning',
  duration_min: 60,
  status: 'confirmed',
  sort_order: 1,
  day_id: 'd-mon',
  choice_key: null,
  item_id: null,
  option_id: null,
  ...over,
});
const act = (id: string, over: Partial<ComposedBlock> = {}) => {
  const it = byId(id);
  return blk({ title: it.name, place_name: it.name, item_id: it.id, lat: it.lat!, lng: it.lng!, duration_min: it.duration_min, ...over });
};
const lunch = (day: string, order: number, over: Partial<ComposedBlock> = {}) =>
  blk({ type: 'meal', title: 'Almuerzo', time_flex: 'afternoon', duration_min: 75, day_id: day, sort_order: order, ...over });
const dinner = (day: string, order: number, over: Partial<ComposedBlock> = {}) =>
  blk({ type: 'meal', title: 'Cena', time_flex: 'evening', duration_min: 90, day_id: day, sort_order: order, ...over });
/** Un día "sano" con almuerzo y cena, para que el chequeo solo hable de lo que probamos. */
const okDay = (day: string): ComposedBlock[] => [lunch(day, 50), dinner(day, 90)];
const ctx = { items: ITEMS };
const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);

describe('dayFrame', () => {
  it('capacidad por ritmo y arranque por cronotipo', () => {
    const l = leg();
    expect(dayFrame(l, group({ pace: 'relaxed' }), '2026-11-17').cap).toBe(330);
    expect(dayFrame(l, group({ pace: 'balanced' }), '2026-11-17').cap).toBe(450);
    expect(dayFrame(l, group({ pace: 'intense' }), '2026-11-17').cap).toBe(570);
    expect(dayFrame(l, group({ chronotype: 'early' }), '2026-11-17').start).toBe(510);
    expect(dayFrame(l, group({ chronotype: 'night' }), '2026-11-17').start).toBe(660);
  });

  it('recorta por llegada y salida', () => {
    const l = leg({ dayWindows: { '2026-11-16': { start_min: 18 * 60, end_min: 1410 }, '2026-11-19': { start_min: 0, end_min: 15 * 60 } } });
    const arr = dayFrame(l, group(), '2026-11-16');
    expect(arr.start).toBe(18 * 60);
    expect(arr.lunch).toBeNull();
    expect(arr.dinner).not.toBeNull();
    expect(arr.cap).toBeLessThan(300);
    expect(arr.full).toBe(false);
    const dep = dayFrame(l, group(), '2026-11-19');
    expect(dep.dinner).toBeNull();
    expect(dep.lunch).not.toBeNull();
  });

  it('lluvia en 0-100 o 0-1', () => {
    expect(normProb(80)).toBe(0.8);
    expect(normProb(0.3)).toBe(0.3);
    expect(normProb(null)).toBe(0);
    expect(dayFrame(leg(), group(), '2026-11-18').rain).toBe(0.8);
  });

  it('isOpenOn con closed_days y periods', () => {
    expect(weekdayOf('2026-11-16')).toBe(1);
    expect(isOpenOn(byId('bellas-artes'), '2026-11-16')).toBe(false);
    expect(isOpenOn(byId('bellas-artes'), '2026-11-17')).toBe(true);
    const sunOnly = { closed_days: [], periods: [{ open: { day: 0, hour: 10, minute: 0 }, close: { day: 0, hour: 18, minute: 0 } }] };
    expect(isOpenOn(sunOnly, '2026-11-15')).toBe(true);
    expect(isOpenOn(sunOnly, '2026-11-16')).toBe(false);
  });

  it('transferFor: a pie cerca, transporte lejos', () => {
    expect(transferFor({ lat: -34.6, lng: -58.38 }, { lat: -34.601, lng: -58.381 })!.mode).toBe('walk');
    expect(transferFor({ lat: -34.6, lng: -58.38 }, { lat: -34.58, lng: -58.42 })!.mode).toBe('transit');
  });
});

describe('checkPlan', () => {
  const l = leg();
  const g = group();

  it('plan sano: sin issues', () => {
    const blocks = [act('recoleta-cementerio', { sort_order: 1 }), act('pilar', { sort_order: 2 }), act('floralis', { sort_order: 3 }), ...okDay('d-mon')];
    // Lunes de 150 min es "liviano" para balanced (450): too_short no aplica porque supera 120.
    expect(checkPlan(leg({ days: [DAYS[0]] }), blocks, g, ctx)).toEqual([]);
  });

  it('cerrado ese día', () => {
    const issues = checkPlan(leg({ days: [DAYS[0]] }), [act('bellas-artes'), ...okDay('d-mon')], g, ctx);
    expect(kinds(issues)).toContain('closed');
    expect(issues.find((i) => i.kind === 'closed')!.text).toMatch(/cierra el lunes/);
  });

  it('día demasiado largo y demasiado corto', () => {
    const long = [act('pilar', { duration_min: 280 }), act('palermo-soho', { duration_min: 280, sort_order: 2 }), ...okDay('d-mon')];
    expect(kinds(checkPlan(leg({ days: [DAYS[0]] }), long, g, ctx))).toContain('too_long');
    const short = [act('obelisco'), ...okDay('d-tue')].map((b) => ({ ...b, day_id: 'd-tue' }));
    expect(kinds(checkPlan(leg({ days: [DAYS[1]] }), short, g, ctx))).toContain('too_short');
  });

  it('sin almuerzo o cena (solo si la ventana del día los cubre)', () => {
    const issues = checkPlan(leg({ days: [DAYS[1]] }), [act('obelisco', { day_id: 'd-tue', duration_min: 200 })], g, ctx);
    expect(issues.filter((i) => i.kind === 'no_meal').map((i) => i.text)).toEqual(['El martes no tiene almuerzo.', 'El martes no tiene cena.']);
    const late = leg({ days: [DAYS[0]], dayWindows: { '2026-11-16': { start_min: 18 * 60, end_min: 1410 } } });
    const i2 = checkPlan(late, [dinner('d-mon', 2)], g, ctx);
    expect(kinds(i2)).not.toContain('no_meal');
  });

  it('salto de más de 3 km a pie entre seguidos', () => {
    const blocks = [act('recoleta-cementerio', { sort_order: 1 }), act('caminito', { sort_order: 2 }), ...okDay('d-mon')];
    expect(kinds(checkPlan(leg({ days: [DAYS[0]] }), blocks, g, ctx))).toContain('far');
    const withTransit = [act('recoleta-cementerio', { sort_order: 1 }), act('caminito', { sort_order: 2, transfer: { mode: 'transit', duration_min: 30 } }), ...okDay('d-mon')];
    expect(kinds(checkPlan(leg({ days: [DAYS[0]] }), withTransit, g, ctx))).not.toContain('far');
  });

  it('lugar repetido entre días (no cuenta opciones de la misma elección)', () => {
    const blocks = [act('obelisco', { day_id: 'd-mon' }), act('obelisco', { day_id: 'd-thu' }), ...okDay('d-mon'), ...okDay('d-thu')];
    expect(kinds(checkPlan(l, blocks, g, ctx))).toContain('duplicate');
    const same = [act('obelisco', { choice_key: 'k' }), act('obelisco', { choice_key: 'k' })];
    expect(kinds(checkPlan(l, same, g, ctx))).not.toContain('duplicate');
  });

  it('al aire libre con lluvia ≥ 60 %', () => {
    const blocks = [act('caminito', { day_id: 'd-wed' }), act('malba', { day_id: 'd-wed', sort_order: 2 })];
    const out = checkPlan(l, blocks, g, ctx).filter((i) => i.kind === 'outdoor_rain');
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/Caminito.*80 %/);
  });

  it('arranque antes del cronotipo', () => {
    const blocks = [act('colon', { start_time: '08:00', time_flex: 'fixed', day_id: 'd-tue' })];
    expect(kinds(checkPlan(l, blocks, group({ chronotype: 'night' }), ctx))).toContain('late_start');
    expect(kinds(checkPlan(l, blocks, group({ chronotype: 'early' }), ctx))).not.toContain('late_start');
  });

  it('imperdible faltante', () => {
    const out = checkPlan(l, [act('obelisco')], g, { ...ctx, mustIds: ['caminito', 'obelisco'] });
    expect(out.filter((i) => i.kind === 'must_missing').map((i) => i.text)).toEqual(['Falta un imperdible: Caminito.']);
  });
});

describe('repairPlan', () => {
  const g = group();
  const l = leg();

  it('mueve lo cerrado a otro día abierto', () => {
    const blocks = [act('bellas-artes', { day_id: 'd-mon' }), ...okDay('d-mon'), ...okDay('d-thu')];
    const out = repairPlan(l, blocks, checkPlan(l, blocks, g, ctx), g, ctx);
    const ba = out.blocks.find((b) => b.item_id === 'bellas-artes')!;
    expect(ba.day_id).not.toBe('d-mon');
    expect(checkPlan(l, out.blocks, g, ctx).filter((i) => i.kind === 'closed')).toEqual([]);
  });

  it('si no hay otro día abierto, lo saca y avisa', () => {
    const one = leg({ days: [DAYS[0]] });
    const blocks = [act('bellas-artes'), ...okDay('d-mon')];
    const out = repairPlan(one, blocks, [], g, ctx);
    expect(out.blocks.some((b) => b.item_id === 'bellas-artes')).toBe(false);
    expect(out.issues.join(' ')).toMatch(/lo saqué/);
  });

  it('lo de afuera con lluvia va a un día seco; el evento no se mueve', () => {
    const blocks = [act('caminito', { day_id: 'd-wed' }), act('bombonera', { day_id: 'd-wed', time_flex: 'fixed', start_time: '17:00', sort_order: 2 })];
    const out = repairPlan(l, blocks, [], g, ctx);
    expect(out.blocks.find((b) => b.item_id === 'caminito')!.day_id).not.toBe('d-wed');
    expect(out.blocks.find((b) => b.item_id === 'bombonera')!.day_id).toBe('d-wed');
  });

  it('saca repetidos', () => {
    const blocks = [act('obelisco', { day_id: 'd-mon' }), act('obelisco', { day_id: 'd-thu' })];
    const out = repairPlan(l, blocks, [], g, ctx);
    expect(out.blocks.filter((b) => b.item_id === 'obelisco')).toHaveLength(1);
  });

  it('acorta hasta 30 % y, si no alcanza, mueve o saca el de menor puntaje (nunca un imperdible)', () => {
    const one = leg({ days: [DAYS[3]] });
    const blocks = [
      act('malba', { day_id: 'd-thu', duration_min: 200 }),
      act('palermo-soho', { day_id: 'd-thu', duration_min: 200, sort_order: 2 }),
      act('jardin-japones', { day_id: 'd-thu', duration_min: 150, sort_order: 3 }),
      ...okDay('d-thu').map((b) => ({ ...b, day_id: 'd-thu' })),
    ];
    const out = repairPlan(one, blocks, [], g, { ...ctx, mustIds: ['malba'], scores: { malba: 0.9, 'palermo-soho': 0.7, 'jardin-japones': 0.3 } });
    expect(out.blocks.some((b) => b.item_id === 'malba')).toBe(true);
    const mins = out.blocks.filter((b) => b.type === 'activity').reduce((s, b) => s + (b.duration_min ?? 0), 0);
    expect(mins).toBeLessThanOrEqual(450 * 1.15);
    for (const b of out.blocks.filter((x) => x.type === 'activity')) {
      const orig = blocks.find((x) => x.item_id === b.item_id)!;
      expect(b.duration_min!).toBeGreaterThanOrEqual(Math.floor(orig.duration_min! * 0.7));
    }
    expect(checkPlan(one, out.blocks, g, ctx).filter((i) => i.kind === 'too_long')).toEqual([]);
  });

  it('reordena para evitar saltos largos y, si sigue lejos, pone transporte', () => {
    const one = leg({ days: [DAYS[0]] });
    const blocks = [
      act('recoleta-cementerio', { sort_order: 1 }),
      act('caminito', { sort_order: 2 }),
      act('pilar', { sort_order: 3 }),
      act('proa', { sort_order: 4 }),
      lunch('d-mon', 5),
      dinner('d-mon', 6),
    ];
    const out = repairPlan(one, blocks, [], g, ctx);
    expect(checkPlan(one, out.blocks, g, ctx).filter((i) => i.kind === 'far')).toEqual([]);
    const seq = out.blocks.filter((b) => b.type === 'activity').sort((a, b) => a.sort_order! - b.sort_order!).map((b) => b.item_id);
    // Recoleta junto, La Boca junto.
    expect(Math.abs(seq.indexOf('recoleta-cementerio') - seq.indexOf('pilar'))).toBe(1);
    expect(Math.abs(seq.indexOf('caminito') - seq.indexOf('proa'))).toBe(1);
  });

  it('agrega la comida que falta sin inventar lugar', () => {
    const one = leg({ days: [DAYS[1]] });
    const blocks = [act('obelisco', { day_id: 'd-tue', duration_min: 200 })];
    const out = repairPlan(one, blocks, [], g, ctx);
    const meals = out.blocks.filter((b) => b.type === 'meal');
    expect(meals).toHaveLength(2);
    for (const m of meals) expect(m.google_place_id).toBeUndefined();
    expect(checkPlan(one, out.blocks, g, ctx).filter((i) => i.kind === 'no_meal')).toEqual([]);
  });

  it('el plan del armador sale limpio del chequeo (sin cerrados, lluvia, repetidos ni saltos a pie)', async () => {
    const out = await composeLeg({ leg: l, group: g, picks: ITEMS.map((i) => pick(i)) }, { searchPlaces: fakeSearch() });
    const left = checkPlan(l, out.blocks, g, ctx).filter((i) => ['closed', 'duplicate', 'far', 'no_meal', 'too_long', 'outdoor_rain'].includes(i.kind));
    expect(left).toEqual([]);
  });
});
