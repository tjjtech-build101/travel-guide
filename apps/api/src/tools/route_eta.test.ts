import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from '../google/cache';
import { route_eta } from './route_eta';
import type { ToolCtx } from './types';

const A = { lat: -34.9067, lng: -56.2017 };
const B = { lat: -34.9145, lng: -56.1505 };
const ctx = {} as ToolCtx;
const ll = (p: { lat: number; lng: number }) => ({ latLng: { latitude: p.lat, longitude: p.lng } });

const SIMPLE = { routes: [{ duration: '1012s', distanceMeters: 1240, polyline: { encodedPolyline: 'simple_poly' } }] };
const DETAIL = {
  routes: [
    {
      duration: '1012s',
      distanceMeters: 1240,
      polyline: { encodedPolyline: 'detail_poly' },
      legs: [
        {
          steps: [
            {
              distanceMeters: 1240,
              staticDuration: '1012s',
              startLocation: ll(A),
              endLocation: ll(B),
              navigationInstruction: { maneuver: 'DEPART', instructions: 'Dirígete al este por Sarandí' },
              travelMode: 'WALK',
            },
          ],
        },
      ],
    },
  ],
};

let masks: string[] = [];
beforeEach(() => {
  masks = [];
  clearCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

function withGoogle() {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const mask = (init.headers as Record<string, string>)['X-Goog-FieldMask'];
      masks.push(mask);
      const out = mask.includes('navigationInstruction') ? DETAIL : SIMPLE;
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
}

describe('route_eta', () => {
  it('sin detail: igual que siempre (sin campo detail, una sola consulta)', async () => {
    withGoogle();
    const r = await route_eta({ stops: [A, B], mode: 'walk' }, ctx);
    expect(r.data).toEqual({
      segments: [{ from_idx: 0, to_idx: 1, duration_min: 17, distance_m: 1240, polyline: 'simple_poly' }],
      total_min: 17,
    });
    expect(masks).toHaveLength(1);
  });

  it('con detail: true y 2 paradas agrega detail (RouteDetail)', async () => {
    withGoogle();
    const r = await route_eta({ stops: [A, B], mode: 'walk', detail: true }, ctx);
    const data = r.data as { total_min: number; detail: { polyline: string; steps: unknown[]; estimated: boolean } };
    expect(data.total_min).toBe(17);
    expect(data.detail).toMatchObject({ mode: 'walk', polyline: 'detail_poly', estimated: false, duration_min: 17 });
    expect(data.detail.steps).toHaveLength(1);
  });

  it('con detail: una sola consulta a Google y segments/total_min salen del detalle', async () => {
    withGoogle();
    const r = await route_eta({ stops: [A, B], mode: 'walk', detail: true }, ctx);
    expect(masks).toHaveLength(1);
    expect(masks[0]).toContain('navigationInstruction');
    expect((r.data as { segments: unknown[] }).segments).toEqual([
      { from_idx: 0, to_idx: 1, duration_min: 17, distance_m: 1240, polyline: 'detail_poly' },
    ]);
  });

  it('con detail en transporte: las líneas salen del detalle, sin transitPlan aparte', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const TRANSIT = {
      routes: [
        {
          duration: '1500s',
          distanceMeters: 6000,
          polyline: { encodedPolyline: 'tp' },
          legs: [
            {
              steps: [
                { travelMode: 'WALK', staticDuration: '240s', distanceMeters: 300, startLocation: ll(A), endLocation: ll(A) },
                {
                  travelMode: 'TRANSIT',
                  staticDuration: '1080s',
                  distanceMeters: 5500,
                  startLocation: ll(A),
                  endLocation: ll(B),
                  transitDetails: {
                    stopDetails: { departureStop: { name: 'Ciudadela' }, arrivalStop: { name: 'Bvar. España' } },
                    localizedValues: { departureTime: { time: { text: '18:05' } } },
                    headsign: 'Pocitos',
                    stopCount: 9,
                    transitLine: { nameShort: '121', vehicle: { type: 'BUS' } },
                  },
                },
                { travelMode: 'WALK', staticDuration: '180s', distanceMeters: 200, startLocation: ll(B), endLocation: ll(B) },
              ],
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        masks.push((init.headers as Record<string, string>)['X-Goog-FieldMask']);
        return new Response(JSON.stringify(TRANSIT), { status: 200 });
      }),
    );
    const r = await route_eta({ stops: [A, B], mode: 'transit', detail: true }, ctx);
    expect(masks).toHaveLength(1);
    const data = r.data as { total_min: number; transit: { lines: { name: string; from_stop: string }[]; walk_before_min: number; walk_after_min: number; summary: string } };
    expect(data.total_min).toBe(25);
    expect(data.transit).toMatchObject({ walk_before_min: 4, walk_after_min: 3 });
    expect(data.transit.lines).toEqual([expect.objectContaining({ name: '121', from_stop: 'Ciudadela', departure: '18:05' })]);
    expect(data.transit.summary).toBeTruthy();
  });

  it('con detail y más de 2 paradas: no agrega detail', async () => {
    withGoogle();
    const r = await route_eta({ stops: [A, B, A], mode: 'walk', detail: true }, ctx);
    expect((r.data as Record<string, unknown>).detail).toBeUndefined();
    expect(masks.every((m) => !m.includes('navigationInstruction'))).toBe(true);
  });

  it('sin key: detail estimado, sin red', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await route_eta({ stops: [A, B], mode: 'car', detail: true }, ctx);
    const data = r.data as { estimated: boolean; detail: { estimated: boolean; polyline: null; steps: { instruction: string }[] } };
    expect(data.estimated).toBe(true);
    expect(data.detail).toMatchObject({ estimated: true, polyline: null, mode: 'car' });
    expect(data.detail.steps[0].instruction).toBe('Manejá hacia tu destino');
    expect(f).not.toHaveBeenCalled();
  });

  it('parada inválida sigue tirando 400', async () => {
    await expect(route_eta({ stops: [A, {}], mode: 'walk', detail: true }, ctx)).rejects.toThrow(/parada 1/);
  });
});
