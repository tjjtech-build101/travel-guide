import { describe, expect, it } from 'vitest';
import { hhmm, parseTransit, type GTransitResponse, type TransitPlan } from '../google/routes';
import { planDayTransfers, transitSummary, type DayBlock, type TransferDeps } from './dayTransfers';

// Respuesta de Google Routes TRANSIT (forma real, valores de ejemplo): caminar → bus 121 → caminar.
const GOOGLE: GTransitResponse = {
  routes: [
    {
      duration: '1560s',
      distanceMeters: 6200,
      legs: [
        {
          steps: [
            { travelMode: 'WALK', staticDuration: '240s' },
            {
              travelMode: 'TRANSIT',
              staticDuration: '1080s',
              transitDetails: {
                stopDetails: { departureStop: { name: 'Ciudadela' }, arrivalStop: { name: '21 de Setiembre' }, departureTime: '2026-10-18T21:05:00Z' },
                localizedValues: { departureTime: { time: { text: '6:05 p.m.' } }, arrivalTime: { time: { text: '18:23' } } },
                headsign: 'Pocitos',
                stopCount: 14,
                transitLine: { nameShort: '121', vehicle: { type: 'BUS' } },
              },
            },
            { travelMode: 'WALK', staticDuration: '180s' },
          ],
        },
      ],
    },
  ],
};

describe('parseTransit (Google Routes)', () => {
  it('líneas, paradas, horario local y minutos a pie', () => {
    const p = parseTransit(GOOGLE)!;
    expect(p).toEqual({
      duration_min: 26,
      walk_min: 7,
      lines: [{ name: '121', vehicle: 'bus', from_stop: 'Ciudadela', to_stop: '21 de Setiembre', departure: '18:05', arrival: '18:23', headsign: 'Pocitos', stops: 14 }],
    });
    expect(transitSummary(p)).toBe('Bus 121 en Ciudadela (sale 18:05) · 7 min a pie');
  });
  it('sin pasos de transporte (todo a pie) o sin rutas → null', () => {
    expect(parseTransit({ routes: [{ duration: '600s', legs: [{ steps: [{ travelMode: 'WALK', staticDuration: '600s' }] }] }] })).toBeNull();
    expect(parseTransit({})).toBeNull();
  });
  it('hhmm: texto localizado am/pm, 24 h o ISO (UTC−3)', () => {
    expect(hhmm('6:05 p.m.', undefined)).toBe('18:05');
    expect(hhmm('12:10 a. m.', undefined)).toBe('00:10');
    expect(hhmm(undefined, '2026-10-18T21:05:00Z')).toBe('18:05');
  });
});

const block = (id: string, start: string, end: string, lat: number, lng: number, o: Partial<DayBlock> = {}): DayBlock => ({
  id,
  day_id: 'd1',
  type: 'activity',
  title: id,
  place_name: id,
  lat,
  lng,
  start_time: start,
  end_time: end,
  duration_min: null,
  status: 'confirmed',
  plan_variant: 'main',
  ...o,
});

const BUS: TransitPlan = { duration_min: 26, walk_min: 7, lines: [{ name: '121', vehicle: 'bus', from_stop: 'Ciudadela', departure: '18:05' }] };

function deps(walk: number, transit: TransitPlan | null): TransferDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    walk: async () => walk,
    transit: async (_a, _b, iso) => (asked.push(iso), transit),
  };
}

// Ciudad Vieja → Pocitos (~5 km) y un vecino a 200 m.
const CV = [-34.9066, -56.2027] as const;
const POCITOS = [-34.9127, -56.1517] as const;

describe('planDayTransfers', () => {
  it('lejos: bus con líneas, a la hora en que termina el bloque anterior, con link a Maps', async () => {
    const d = deps(70, BUS);
    const out = await planDayTransfers([block('Mercado', '13:00', '18:00', ...CV), block('Rambla', '18:30', '20:00', ...POCITOS)], '2026-10-18', d);
    expect(d.asked).toEqual(['2026-10-18T18:00:00-03:00']);
    expect(out).toHaveLength(1);
    expect(out[0].input).toMatchObject({ type: 'transfer', title: 'Bus 121 a Rambla', start_time: '18:00:00', end_time: '18:26:00', time_flex: 'fixed' });
    expect(out[0].input.transfer).toMatchObject({ mode: 'bus', duration_min: 26, walk_min: 7, from: 'Mercado', to: 'Rambla' });
    expect(out[0].input.transfer?.maps_url).toContain('travelmode=transit');
    expect(out[0].input.alerts).toBeUndefined();
  });

  it('si el traslado no entra en el hueco: alerta de llegada tarde', async () => {
    const out = await planDayTransfers([block('Mercado', '13:00', '18:20', ...CV), block('Rambla', '18:30', '20:00', ...POCITOS)], '2026-10-18', deps(70, BUS));
    expect(out[0].input.alerts).toEqual([{ kind: 'late', text: 'Con el traslado llegás ~16 min tarde a «Rambla»' }]);
  });

  it('cerca, o caminable (≤20 min): nada; ideas, variantes y sin hora: se ignoran', async () => {
    expect(await planDayTransfers([block('A', '10:00', '11:00', ...CV), block('B', '11:30', '12:00', -34.9068, -56.2010)], '2026-10-18', deps(3, BUS))).toEqual([]);
    expect(await planDayTransfers([block('A', '10:00', '11:00', ...CV), block('B', '11:30', '12:00', ...POCITOS)], '2026-10-18', deps(18, BUS))).toEqual([]);
    const ignored = await planDayTransfers(
      [block('A', '10:00', '11:00', ...CV), block('Idea', '11:30', '12:00', ...POCITOS, { status: 'idea' }), block('Lluvia', '11:30', '12:00', ...POCITOS, { plan_variant: 'rain' })],
      '2026-10-18',
      deps(70, BUS),
    );
    expect(ignored).toEqual([]);
  });

  it('ya hay un traslado entre medio: no duplica', async () => {
    const out = await planDayTransfers(
      [block('A', '10:00', '11:00', ...CV), block('T', '11:00', '11:25', ...CV, { type: 'transfer' }), block('B', '11:30', '12:00', ...POCITOS)],
      '2026-10-18',
      deps(70, BUS),
    );
    expect(out).toEqual([]);
  });

  it('transporte no gana: caminata si es ≤45 min; si es más y no hay datos, traslado estimado', async () => {
    const walk = await planDayTransfers([block('A', '10:00', '11:00', ...CV), block('B', '11:40', '12:00', ...POCITOS)], '2026-10-18', deps(30, { ...BUS, duration_min: 28 }));
    expect(walk[0].input).toMatchObject({ title: 'Caminata a B' });
    expect(walk[0].input.transfer).toMatchObject({ mode: 'walk', duration_min: 30 });
    const est = await planDayTransfers([block('A', '10:00', '11:00', ...CV), block('B', '11:40', '12:00', ...POCITOS)], '2026-10-18', deps(70, null));
    expect(est[0].input.transfer).toMatchObject({ mode: 'transit', estimated: true });
    expect(est[0].input.title).toBe('Traslado a B');
  });
});
