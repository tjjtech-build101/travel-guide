import { describe, expect, it } from 'vitest';
import { composeLeg } from './compose';
import { byId, fakeSearch, group, ITEMS, leg, pick } from './composeTestKit';
import { coverageFor } from './coverage';
import type { ComposedBlock } from './types';

const b = (over: Partial<ComposedBlock>): ComposedBlock => ({
  type: 'activity',
  title: 'X',
  day_id: 'd-mon',
  choice_key: null,
  item_id: null,
  option_id: null,
  ...over,
});

describe('coverageFor', () => {
  const musts = ['recoleta-cementerio', 'caminito', 'malba', 'colon'].map((id) => ({ item: byId(id), option_id: `opt-${id}` }));

  it('cuenta principales y opciones de una elección; faltantes con el motivo de unplaced', () => {
    const blocks = [
      b({ item_id: 'recoleta-cementerio' }),
      b({ item_id: 'malba', choice_key: 'act:d-wed', status: 'proposed' }),
      b({ item_id: 'usina', choice_key: 'act:d-wed', status: 'proposed' }),
      b({ type: 'meal', choice_key: 'dinner:d-mon' }),
      b({ type: 'meal', choice_key: 'dinner:d-mon' }),
      b({ type: 'lodging', choice_key: 'lodging:leg-ba' }),
    ];
    const cov = coverageFor({ id: 'leg-ba', city: 'Buenos Aires' }, musts, blocks, [
      { item: byId('caminito'), option_id: 'opt-caminito', reason: 'no entró en 2 días: priorizá otro o sumá un día' },
    ]);
    expect(cov).toEqual({
      leg_id: 'leg-ba',
      city: 'Buenos Aires',
      must_total: 4,
      must_covered: 2,
      missing: [
        { option_id: 'opt-caminito', item_id: 'caminito', name: 'Caminito', reason: 'no entró en 2 días: priorizá otro o sumá un día' },
        { option_id: 'opt-colon', item_id: 'colon', name: 'Teatro Colón', reason: 'quedó afuera del armado' },
      ],
      choices: 3,
    });
  });

  it('un bloque en el banco de ideas (day_id null) no cubre', () => {
    const cov = coverageFor({ id: 'l', city: 'BA' }, musts.slice(0, 1), [b({ item_id: 'recoleta-cementerio', day_id: null })], []);
    expect(cov.must_covered).toBe(0);
  });

  it('imperdibles repetidos cuentan una vez; sin imperdibles todo en cero', () => {
    const cov = coverageFor({ id: 'l', city: 'BA' }, [...musts.slice(0, 1), ...musts.slice(0, 1)], [b({ item_id: 'recoleta-cementerio' })], []);
    expect(cov.must_total).toBe(1);
    expect(cov.must_covered).toBe(1);
    expect(coverageFor({ id: 'l', city: 'BA' }, [], [], [])).toMatchObject({ must_total: 0, must_covered: 0, missing: [], choices: 0 });
  });

  it('sobre el armado real: todos los imperdibles cubiertos y elecciones contadas', async () => {
    const out = await composeLeg({ leg: leg(), group: group(), picks: ITEMS.map((i) => pick(i)) }, { searchPlaces: fakeSearch() });
    const mustItems = ITEMS.filter((i) => i.tier === 'must').map((item) => ({ item, option_id: `opt-${item.id}` }));
    const cov = coverageFor({ id: 'leg-ba', city: 'Buenos Aires' }, mustItems, out.blocks, out.unplaced);
    expect(cov.must_total).toBe(mustItems.length);
    expect(cov.must_covered).toBe(mustItems.length);
    // 4 cenas + alojamiento + al menos una actividad para elegir.
    expect(cov.choices).toBeGreaterThanOrEqual(6);
  });

  it('el imperdible que cierra todos los días del tramo sale como faltante con el motivo', async () => {
    const l = leg({ days: [{ id: 'd1', date: '2026-11-16' }], dayWindows: {}, weather: {}, lodging: { lat: -34.58, lng: -58.42 } });
    const ba = { ...byId('bellas-artes'), tier: 'must' as const };
    const out = await composeLeg({ leg: l, group: group(), picks: [pick(ba)] }, { searchPlaces: fakeSearch() });
    const cov = coverageFor({ id: l.id, city: l.city }, [{ item: ba, option_id: 'opt-bellas-artes' }], out.blocks, out.unplaced);
    expect(cov.missing[0].reason).toBe('cierra los lunes y estás solo el lunes');
  });
});
