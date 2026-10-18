import { distanceMeters } from '@build101/shared';
import { describe, expect, it } from 'vitest';
import { PACE_CAPACITY, weekdayOf } from './check';
import { clusterItems, composeLeg, parseInstruction, routeOrder } from './compose';
import { byId, DAYS, fakeSearch, group, ITEMS, item, leg, pick } from './composeTestKit';
import type { ComposedBlock, PickedItem } from './types';

const allPicks = (over: (p: PickedItem) => PickedItem = (p) => p) => ITEMS.map((it) => over(pick(it)));
const dayBlocks = (blocks: ComposedBlock[], dayId: string) =>
  blocks.filter((b) => b.day_id === dayId).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
/** Bloques que "cuentan": principales + la primera opción de cada elección. */
const counted = (blocks: ComposedBlock[]) => {
  const seen = new Set<string>();
  return blocks.filter((b) => (b.choice_key ? (seen.has(b.choice_key) ? false : (seen.add(b.choice_key), true)) : true));
};
const MUST_IDS = new Set(ITEMS.filter((i) => i.tier === 'must').map((i) => i.id));

describe('fixture', () => {
  it('el tramo arranca un lunes', () => {
    expect(weekdayOf('2026-11-16')).toBe(1);
    expect(weekdayOf('2026-11-17')).toBe(2);
  });
});

describe('composeLeg: ciudad de juguete (Buenos Aires, 4 días)', async () => {
  const search = fakeSearch();
  const out = await composeLeg({ leg: leg(), group: group(), picks: allPicks() }, { searchPlaces: search });
  const acts = out.blocks.filter((b) => b.type === 'activity');

  it('cada día tiene almuerzo y cena', () => {
    for (const d of DAYS) {
      const meals = dayBlocks(out.blocks, d.id).filter((b) => b.type === 'meal');
      expect(meals.some((m) => m.time_flex === 'afternoon'), `almuerzo ${d.date}`).toBe(true);
      expect(meals.some((m) => m.time_flex === 'evening'), `cena ${d.date}`).toBe(true);
    }
  });

  it('nada en días cerrados (Bellas Artes cierra lunes, MALBA martes)', () => {
    for (const b of out.blocks.filter((x) => x.item_id === 'bellas-artes')) expect(b.day_id).not.toBe('d-mon');
    for (const b of out.blocks.filter((x) => x.item_id === 'malba')) expect(b.day_id).not.toBe('d-tue');
  });

  it('el evento va en su fecha y con hora fija', () => {
    const ev = out.blocks.find((b) => b.item_id === 'bombonera')!;
    expect(ev.day_id).toBe('d-thu');
    expect(ev.start_time).toBe('17:00');
    expect(ev.time_flex).toBe('fixed');
  });

  it('la escapada ocupa un día entero que no es de llegada ni salida, y es una sola', () => {
    const trip = out.blocks.find((b) => b.item_id === 'tigre')!;
    expect(trip).toBeTruthy();
    expect(['d-mon', 'd-thu']).not.toContain(trip.day_id);
    expect(trip.day_id).toBe('d-tue'); // el miércoles llueve
    expect(trip.description).toMatch(/Escapada de día completo/);
    const others = dayBlocks(out.blocks, trip.day_id!).filter((b) => b.type === 'activity' && b.item_id !== 'tigre');
    expect(others).toHaveLength(0);
    expect(out.blocks.some((b) => b.item_id === 'colonia')).toBe(false);
    expect(out.unplaced.find((u) => u.item.id === 'colonia')?.reason).toMatch(/escapada/);
  });

  it('lo de afuera evita el día de lluvia', () => {
    const wed = dayBlocks(out.blocks, 'd-wed').filter((b) => b.type === 'activity');
    expect(wed.length).toBeGreaterThan(0);
    for (const b of wed) expect(byId(b.item_id!).indoor, b.title).toBe(true);
  });

  it('la cena es "elegí 1 de 3" con lugares reales del resultado', () => {
    for (const d of DAYS) {
      const dinners = dayBlocks(out.blocks, d.id).filter((b) => b.type === 'meal' && b.time_flex === 'evening');
      expect(dinners).toHaveLength(3);
      expect(new Set(dinners.map((x) => x.choice_key)).size).toBe(1);
      expect(dinners[0].choice_key).toBeTruthy();
      for (const x of dinners) {
        expect(x.status).toBe('proposed');
        expect(x.google_place_id).toBeTruthy();
        expect(typeof x.lat).toBe('number');
      }
    }
    // Nunca inventa: todo google_place_id de comida viene de la búsqueda o de un ítem elegido.
    const ids = new Set(ITEMS.map((i) => i.google_place_id));
    for (const m of out.blocks.filter((b) => b.type === 'meal' && b.google_place_id))
      expect(m.google_place_id!.startsWith('place:') || ids.has(m.google_place_id!)).toBe(true);
  });

  it('Don Julio (comida de noche elegida) entra como opción de cena cerca de Palermo', () => {
    const dj = out.blocks.find((b) => b.item_id === 'don-julio');
    expect(dj).toBeTruthy();
    expect(dj!.type).toBe('meal');
    expect(dj!.time_flex).toBe('evening');
    expect(dj!.notes).toMatch(/Conviene reservar/);
  });

  it('no repite restaurantes entre comidas', () => {
    const ids = out.blocks.filter((b) => b.type === 'meal' && b.google_place_id).map((b) => b.google_place_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filtra por rating ≥ 4,2 y precio del presupuesto', () => {
    // El fake devuelve 4.1 (precio 4) y 3.9 en las posiciones 3 y 5: nunca deberían aparecer.
    const meals = out.blocks.filter((b) => b.type === 'meal' && b.google_place_id?.startsWith('place:'));
    for (const m of meals) expect(m.google_place_id).not.toMatch(/:(3|5)$/);
  });

  it('a lo sumo 1 elección de actividad por día y nunca con un imperdible', () => {
    for (const d of DAYS) {
      const keys = new Set(dayBlocks(out.blocks, d.id).filter((b) => b.type === 'activity' && b.choice_key).map((b) => b.choice_key));
      expect(keys.size).toBeLessThanOrEqual(1);
    }
    for (const b of acts.filter((x) => x.choice_key)) {
      expect(MUST_IDS.has(b.item_id!)).toBe(false);
      expect(b.status).toBe('proposed');
    }
    expect(acts.some((b) => b.choice_key)).toBe(true);
  });

  it('las opciones de una elección comparten sort_order y la mejor va primero', () => {
    const keys = [...new Set(acts.filter((b) => b.choice_key).map((b) => b.choice_key))];
    for (const k of keys) {
      const opts = out.blocks.filter((b) => b.choice_key === k);
      expect(opts.length).toBeGreaterThanOrEqual(2);
      expect(opts.length).toBeLessThanOrEqual(3);
      expect(new Set(opts.map((o) => o.sort_order)).size).toBe(1);
    }
  });

  it('días agrupados por zona: distancia media dentro del día < entre días', () => {
    const located = counted(acts).filter((b) => typeof b.lat === 'number' && b.item_id !== 'tigre');
    let intra = 0, ni = 0, inter = 0, ne = 0;
    for (let i = 0; i < located.length; i++)
      for (let j = i + 1; j < located.length; j++) {
        const d = distanceMeters(located[i] as { lat: number; lng: number }, located[j] as { lat: number; lng: number });
        if (located[i].day_id === located[j].day_id) [intra, ni] = [intra + d, ni + 1];
        else [inter, ne] = [inter + d, ne + 1];
      }
    expect(ni).toBeGreaterThan(0);
    expect(intra / ni).toBeLessThan(inter / ne);
  });

  it('respeta la capacidad del ritmo (balanced)', () => {
    for (const d of DAYS) {
      if (d.id === 'd-tue') continue; // escapada
      const mins = counted(dayBlocks(out.blocks, d.id)).filter((b) => b.type === 'activity').reduce((s, b) => s + (b.duration_min ?? 0), 0);
      expect(mins, d.date).toBeLessThanOrEqual(PACE_CAPACITY.balanced * 1.15);
    }
  });

  it('los imperdibles entran antes que el resto', () => {
    const inPlan = new Set(out.blocks.map((b) => b.item_id));
    for (const id of MUST_IDS) expect(inPlan.has(id), id).toBe(true);
  });

  it('unplaced trae motivo legible', () => {
    expect(out.unplaced.length).toBeGreaterThan(0);
    for (const u of out.unplaced) expect(u.reason.length).toBeGreaterThan(10);
    // Lo que no entró no está en el plan.
    const inPlan = new Set(out.blocks.map((b) => b.item_id));
    for (const u of out.unplaced) expect(inPlan.has(u.item.id)).toBe(false);
  });

  it('todo lo elegido está en el plan o en unplaced', () => {
    const inPlan = new Set(out.blocks.map((b) => b.item_id));
    const out2 = new Set(out.unplaced.map((u) => u.item.id));
    for (const it of ITEMS) expect(inPlan.has(it.id) || out2.has(it.id), it.id).toBe(true);
  });

  it('alojamiento: elegí 1 de N hoteles en las zonas recomendadas, el primer día', () => {
    const lodg = out.blocks.filter((b) => b.type === 'lodging');
    expect(lodg.length).toBeGreaterThanOrEqual(2);
    expect(lodg.length).toBeLessThanOrEqual(3);
    for (const l of lodg) {
      expect(l.day_id).toBe('d-mon');
      expect(l.status).toBe('idea');
      expect(l.choice_key).toBe('lodging:leg-ba');
      expect(l.description).toMatch(/Por qué (Palermo|Recoleta)/);
      expect(l.google_place_id).toBeTruthy();
    }
    expect(search.calls.some((c) => c.query === 'hotel Palermo')).toBe(true);
  });

  it('textos: títulos con el nombre, fuentes, reservas y lugar exacto', () => {
    const rosedal = out.blocks.find((b) => b.item_id === 'rosedal');
    if (rosedal) expect(rosedal.title).toBe('Atardecer en Rosedal de Palermo');
    const cem = out.blocks.find((b) => b.item_id === 'recoleta-cementerio')!;
    expect(cem.title).toBe('Cementerio de la Recoleta');
    expect(cem.description).toMatch(/Tip: Andá temprano/);
    expect(cem.place_name).toBe('Cementerio de la Recoleta');
    expect(cem.google_place_id).toBe(byId('recoleta-cementerio').google_place_id);
    expect(cem.lat).toBe(-34.5875);
    expect(cem.sources?.[0].url).toBe('https://example.com/recoleta-cementerio');
    expect(cem.status).toBe('confirmed');
    expect(cem.start_time).toBeUndefined();
    const colon = out.blocks.find((b) => b.item_id === 'colon')!;
    expect(colon.notes).toMatch(/Conviene reservar/);
  });

  it('orden del día: lo de mañana antes del almuerzo, lo de noche después de la cena', () => {
    const cemDay = out.blocks.find((b) => b.item_id === 'recoleta-cementerio')!.day_id!;
    const seq = dayBlocks(out.blocks, cemDay);
    const lunchIdx = seq.findIndex((b) => b.type === 'meal' && b.time_flex === 'afternoon');
    expect(seq.findIndex((b) => b.item_id === 'recoleta-cementerio')).toBeLessThan(lunchIdx);
    const flo = out.blocks.find((b) => b.item_id === 'floreria');
    if (flo) {
      const s2 = dayBlocks(out.blocks, flo.day_id!);
      const dinnerIdx = s2.findIndex((b) => b.type === 'meal' && b.time_flex === 'evening');
      expect(s2.indexOf(flo)).toBeGreaterThan(dinnerIdx);
      expect(flo.time_flex).toBe('evening');
    }
  });

  it('sort_order incremental por día y sin start_time inventado', () => {
    for (const d of DAYS) {
      const orders = [...new Set(dayBlocks(out.blocks, d.id).filter((b) => b.type !== 'lodging').map((b) => b.sort_order!))];
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
    for (const b of out.blocks.filter((x) => x.start_time)) expect(b.item_id).toBe('bombonera');
  });

  it('es determinístico', async () => {
    const again = await composeLeg({ leg: leg(), group: group(), picks: allPicks() }, { searchPlaces: fakeSearch() });
    expect(again.blocks).toEqual(out.blocks);
  });
});

describe('composeLeg: ritmo', () => {
  const minsPerDay = (blocks: ComposedBlock[], dayId: string) =>
    counted(dayBlocks(blocks, dayId)).filter((b) => b.type === 'activity').reduce((s, b) => s + (b.duration_min ?? 0), 0);

  it('relaxed respeta 330 min y arma menos que intense', async () => {
    const relaxed = await composeLeg({ leg: leg(), group: group({ pace: 'relaxed' }), picks: allPicks() }, { searchPlaces: fakeSearch() });
    const intense = await composeLeg({ leg: leg(), group: group({ pace: 'intense' }), picks: allPicks() }, { searchPlaces: fakeSearch() });
    for (const d of DAYS.filter((x) => x.id !== 'd-tue')) {
      expect(minsPerDay(relaxed.blocks, d.id)).toBeLessThanOrEqual(330 * 1.15);
      expect(minsPerDay(intense.blocks, d.id)).toBeLessThanOrEqual(570 * 1.15);
    }
    const total = (bs: ComposedBlock[]) => DAYS.reduce((s, d) => s + minsPerDay(bs, d.id), 0);
    expect(total(intense.blocks)).toBeGreaterThan(total(relaxed.blocks));
    expect(relaxed.unplaced.length).toBeGreaterThan(intense.unplaced.length);
  });

  it('el día de llegada tarde no tiene almuerzo y arranca después del traslado', async () => {
    const l = leg({ dayWindows: { '2026-11-16': { start_min: 17 * 60, end_min: 1410 } } });
    const out = await composeLeg({ leg: l, group: group(), picks: allPicks() }, { searchPlaces: fakeSearch() });
    const mon = dayBlocks(out.blocks, 'd-mon');
    expect(mon.some((b) => b.type === 'meal' && b.time_flex === 'afternoon')).toBe(false);
    expect(mon.some((b) => b.type === 'meal' && b.time_flex === 'evening')).toBe(true);
    expect(minsPerDay(out.blocks, 'd-mon')).toBeLessThanOrEqual(1410 - 17 * 60 - 90 - 60);
  });

  it('"más tranqui" baja la capacidad y "el miércoles tarde libre" deja la tarde vacía', async () => {
    const base = await composeLeg({ leg: leg(), group: group(), picks: allPicks() }, { searchPlaces: fakeSearch() });
    const calm = await composeLeg({ leg: leg(), group: group(), picks: allPicks(), instruction: 'más tranqui, y el miércoles tarde libre' }, { searchPlaces: fakeSearch() });
    const sum = (bs: ComposedBlock[]) => DAYS.reduce((s, d) => s + minsPerDay(bs, d.id), 0);
    expect(sum(calm.blocks)).toBeLessThan(sum(base.blocks));
    const wed = dayBlocks(calm.blocks, 'd-wed');
    const lunch = wed.findIndex((b) => b.type === 'meal' && b.time_flex === 'afternoon');
    const afterLunchActs = wed.slice(lunch + 1).filter((b) => b.type === 'activity' && b.time_flex === 'afternoon');
    expect(afterLunchActs).toHaveLength(0);
  });
});

describe('composeLeg: casos de borde', () => {
  const oneDay = (date: string, over = {}) =>
    leg({ days: [{ id: 'd1', date }], dayWindows: {}, weather: {}, lodging: { lat: -34.5889, lng: -58.4199 }, ...over });

  it('"cierra los lunes y estás solo el lunes"', async () => {
    const out = await composeLeg({ leg: oneDay('2026-11-16'), group: group(), picks: [pick(byId('bellas-artes'))] }, { searchPlaces: fakeSearch() });
    expect(out.blocks.some((b) => b.item_id === 'bellas-artes')).toBe(false);
    expect(out.unplaced[0].reason).toBe('cierra los lunes y estás solo el lunes');
  });

  it('respeta periods de Google (sin closed_days)', async () => {
    const it = item({ id: 'solo-findes', name: 'Feria de Mataderos', lat: -34.66, lng: -58.5, category: 'market', periods: [{ open: { day: 0, hour: 11, minute: 0 }, close: { day: 0, hour: 19, minute: 0 } }] });
    const out = await composeLeg({ leg: oneDay('2026-11-16'), group: group(), picks: [pick(it)] }, { searchPlaces: fakeSearch() });
    expect(out.blocks.some((b) => b.item_id === 'solo-findes')).toBe(false);
    expect(out.unplaced[0].reason).toMatch(/no abre/);
  });

  it('lo que no entra: "no entró en 1 día"', async () => {
    const out = await composeLeg({ leg: oneDay('2026-11-17'), group: group(), picks: allPicks() }, { searchPlaces: fakeSearch() });
    expect(out.unplaced.some((u) => u.reason === 'no entró en 1 día: priorizá otro o sumá un día')).toBe(true);
  });

  it('el evento fuera del tramo queda afuera con motivo', async () => {
    const ev = item({ id: 'recital', name: 'Recital', category: 'event', event_dates: ['2026-12-01'], event_time: '21:00', lat: -34.59, lng: -58.44 });
    const out = await composeLeg({ leg: leg(), group: group(), picks: [pick(ev)] }, { searchPlaces: fakeSearch() });
    expect(out.unplaced[0].reason).toMatch(/2026-12-01.*no estás en Buenos Aires/);
  });

  it('la escapada no va el día de llegada aunque sea el único entero', async () => {
    const l = leg({ days: DAYS.slice(0, 2), dayWindows: { '2026-11-16': { start_min: 540, end_min: 1410 }, '2026-11-17': { start_min: 0, end_min: 1200 } } });
    const out = await composeLeg({ leg: l, group: group(), picks: [pick(byId('tigre'))] }, { searchPlaces: fakeSearch() });
    expect(out.blocks.some((b) => b.item_id === 'tigre')).toBe(false);
    expect(out.unplaced[0].reason).toMatch(/día completo/);
  });

  it('el "sí o sí" de alguien gana lugar sobre el imperdible del catálogo', async () => {
    const cheap = ITEMS.filter((i) => ['recoleta-cementerio', 'palermo-soho', 'jardin-japones', 'caminito', 'plaza-de-mayo', 'zanjon', 'usina'].includes(i.id));
    const picks = cheap.map((i) => pick(i, i.id === 'usina' ? { must: true, score: 0.1, reactions: [{ user_id: 'u-juan', reaction: 'must' }] } : {}));
    const out = await composeLeg({ leg: oneDay('2026-11-17'), group: group({ pace: 'relaxed' }), picks }, { searchPlaces: fakeSearch() });
    const usina = out.blocks.find((b) => b.item_id === 'usina')!;
    expect(usina).toBeTruthy();
    expect(usina.description).toMatch(/Sí o sí para Juan/);
    expect(usina.choice_key).toBeNull();
  });

  it('dieta vegetariana → busca "restaurante vegetariano"', async () => {
    const s = fakeSearch();
    await composeLeg({ leg: oneDay('2026-11-17'), group: group({ dietary: ['vegetarian'] }), picks: [pick(byId('obelisco'))] }, { searchPlaces: s });
    expect(s.calls.every((c) => /vegetariano|restaurante/.test(c.query))).toBe(true);
    expect(s.calls.some((c) => c.query === 'restaurante vegetariano')).toBe(true);
  });

  it('con alojamiento ya reservado no propone hoteles', async () => {
    const out = await composeLeg({ leg: oneDay('2026-11-17'), group: group(), picks: [pick(byId('obelisco'))] }, { searchPlaces: fakeSearch() });
    expect(out.blocks.some((b) => b.type === 'lodging')).toBe(false);
  });

  it('sin resultados de búsqueda deja la comida marcada sin inventar lugar', async () => {
    const out = await composeLeg({ leg: oneDay('2026-11-17'), group: group(), picks: [pick(byId('obelisco'))] }, { searchPlaces: async () => [] });
    const meals = out.blocks.filter((b) => b.type === 'meal');
    expect(meals).toHaveLength(2);
    for (const m of meals) {
      expect(m.google_place_id).toBeUndefined();
      expect(m.status).toBe('idea');
    }
  });

  it('nombres de for_user_ids en la descripción', async () => {
    const out = await composeLeg(
      { leg: oneDay('2026-11-17'), group: group(), picks: [pick(byId('obelisco'), { for_user_ids: ['u-sofi', 'u-juan'] })] },
      { searchPlaces: fakeSearch() },
    );
    expect(out.blocks.find((b) => b.item_id === 'obelisco')!.description).toMatch(/Ideal para Sofi y Juan/);
  });
});

describe('helpers', () => {
  it('parseInstruction', () => {
    const dates = DAYS.map((d) => d.date);
    expect(parseInstruction('quiero algo más relajado', dates).capFactor).toBe(0.8);
    expect(parseInstruction('dale', dates).capFactor).toBe(1);
    expect([...parseInstruction('el martes libre a la tarde', dates).pmOff]).toEqual(['2026-11-17']);
    expect([...parseInstruction('tarde libre el 18', dates).pmOff]).toEqual(['2026-11-18']);
    expect([...parseInstruction('el miércoles a full', dates).pmOff]).toEqual([]);
  });

  it('clusterItems agrupa por zona, suma sueltos cercanos y parte zonas enormes', () => {
    const c = clusterItems([
      { id: 'a', zone: 'Recoleta', ll: { lat: -34.5875, lng: -58.393 } },
      { id: 'b', zone: 'recoleta ', ll: { lat: -34.5839, lng: -58.3929 } },
      { id: 'c', zone: null, ll: { lat: -34.5845, lng: -58.3935 } },
      { id: 'd', zone: null, ll: { lat: -34.66, lng: -58.5 } },
      { id: 'e', zone: 'Gigante', ll: { lat: -34.55, lng: -58.45 } },
      { id: 'f', zone: 'Gigante', ll: { lat: -34.551, lng: -58.451 } },
      { id: 'g', zone: 'Gigante', ll: { lat: -34.65, lng: -58.36 } },
      { id: 'h', zone: 'Gigante', ll: { lat: -34.651, lng: -58.361 } },
    ]);
    expect(c.get('a')).toBe(c.get('b'));
    expect(c.get('c')).toBe(c.get('a'));
    expect(c.get('d')).not.toBe(c.get('a'));
    expect(c.get('e')).toBe(c.get('f'));
    expect(c.get('g')).toBe(c.get('h'));
    expect(c.get('e')).not.toBe(c.get('g'));
  });

  it('routeOrder: vecino más cercano + 2-opt no cruza', () => {
    const pts = [
      { lat: 0, lng: 0.03 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.04 },
      { lat: 0, lng: 0.02 },
    ];
    expect(routeOrder({ lat: 0, lng: 0 }, pts)).toEqual([1, 3, 0, 2]);
  });
});
