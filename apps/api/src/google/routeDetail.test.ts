import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { routeDetail, type GDetailResponse } from './routes';

// Ciudad Vieja → Pocitos (Montevideo).
const A = { lat: -34.9067, lng: -56.2017 };
const B = { lat: -34.9145, lng: -56.1505 };
const ll = (lat: number, lng: number) => ({ latLng: { latitude: lat, longitude: lng } });

// Respuestas con la forma real de routes.googleapis.com/directions/v2:computeRoutes (recortadas).
const WALK: GDetailResponse = {
  routes: [
    {
      distanceMeters: 1240,
      duration: '1012s',
      polyline: { encodedPolyline: 'xmktE`|ivIoBgHy@uC' },
      legs: [
        {
          steps: [
            {
              distanceMeters: 210,
              staticDuration: '170s',
              startLocation: ll(-34.9067, -56.2017),
              endLocation: ll(-34.9071, -56.1995),
              navigationInstruction: { maneuver: 'DEPART', instructions: 'Dirígete al este por Sarandí hacia Juan Carlos Gómez' },
              travelMode: 'WALK',
            },
            {
              distanceMeters: 1010,
              staticDuration: '830s',
              startLocation: ll(-34.9071, -56.1995),
              endLocation: ll(-34.9145, -56.1505),
              navigationInstruction: { maneuver: 'TURN_RIGHT', instructions: 'Gira a la derecha en 18 de Julio' },
              travelMode: 'WALK',
            },
            {
              distanceMeters: 20,
              staticDuration: '12s',
              startLocation: ll(-34.9145, -56.1505),
              endLocation: ll(-34.9145, -56.1504),
              navigationInstruction: { maneuver: 'STRAIGHT', instructions: 'El destino está a la izquierda' },
              travelMode: 'WALK',
            },
          ],
        },
      ],
    },
  ],
};

const DRIVE: GDetailResponse = {
  routes: [
    {
      distanceMeters: 6830,
      duration: '845s',
      polyline: { encodedPolyline: 'drive_poly' },
      legs: [
        {
          steps: [
            {
              distanceMeters: 400,
              staticDuration: '60s',
              startLocation: ll(-34.9067, -56.2017),
              endLocation: ll(-34.908, -56.198),
              navigationInstruction: { maneuver: 'DEPART', instructions: 'Dirígete al sudeste por Rincón' },
              travelMode: 'DRIVE',
            },
            {
              distanceMeters: 6430,
              staticDuration: '720s',
              startLocation: ll(-34.908, -56.198),
              endLocation: ll(-34.9145, -56.1505),
              navigationInstruction: { maneuver: 'RAMP_RIGHT', instructions: 'Toma la rampa a la Rambla' },
              travelMode: 'DRIVE',
            },
          ],
        },
      ],
    },
  ],
};

const walkStep = (s: number, m: number, from: [number, number], to: [number, number]) => ({
  distanceMeters: m,
  staticDuration: `${s}s`,
  startLocation: ll(...from),
  endLocation: ll(...to),
  navigationInstruction: { maneuver: 'STRAIGHT', instructions: 'Continúa' },
  travelMode: 'WALK',
});

const TRANSIT: GDetailResponse = {
  routes: [
    {
      distanceMeters: 7100,
      duration: '1680s',
      polyline: { encodedPolyline: 'transit_poly' },
      legs: [
        {
          steps: [
            walkStep(120, 150, [-34.9067, -56.2017], [-34.9069, -56.2001]),
            walkStep(130, 170, [-34.9069, -56.2001], [-34.9072, -56.1985]),
            {
              distanceMeters: 6500,
              staticDuration: '1080s',
              startLocation: ll(-34.9072, -56.1985),
              endLocation: ll(-34.914, -56.152),
              navigationInstruction: { instructions: 'Autobús hacia Pocitos' },
              travelMode: 'TRANSIT',
              transitDetails: {
                stopDetails: {
                  departureStop: { name: 'Ciudadela' },
                  arrivalStop: { name: 'Bvar. España' },
                  departureTime: '2026-10-17T21:05:00Z',
                  arrivalTime: '2026-10-17T21:23:00Z',
                },
                localizedValues: { departureTime: { time: { text: '18:05' } }, arrivalTime: { time: { text: '18:23' } } },
                headsign: 'Pocitos',
                stopCount: 9,
                transitLine: { name: 'Ciudad Vieja - Pocitos', nameShort: '121', vehicle: { type: 'BUS' } },
              },
            },
            walkStep(100, 120, [-34.914, -56.152], [-34.9143, -56.151]),
            walkStep(90, 110, [-34.9143, -56.151], [-34.9145, -56.1505]),
          ],
        },
      ],
    },
  ],
};

type Call = { url: string; mask: string; body: Record<string, unknown> };
let calls: Call[] = [];

function mockFetch(responder: (body: Record<string, unknown>) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, mask: (init.headers as Record<string, string>)['X-Goog-FieldMask'], body });
      const out = responder(body);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

beforeEach(() => {
  calls = [];
  clearCache();
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe('routeDetail (Google Routes)', () => {
  it('a pie: polilínea y pasos de navegación tal cual', async () => {
    mockFetch(() => WALK);
    const d = await routeDetail(A, B, 'walk');
    expect(d).toMatchObject({ mode: 'walk', duration_min: 17, distance_m: 1240, polyline: 'xmktE`|ivIoBgHy@uC', estimated: false });
    expect(d.steps).toHaveLength(3);
    expect(d.steps[1]).toEqual({
      instruction: 'Gira a la derecha en 18 de Julio',
      maneuver: 'TURN_RIGHT',
      distance_m: 1010,
      duration_min: 14,
      start: { lat: -34.9071, lng: -56.1995 },
      end: { lat: -34.9145, lng: -56.1505 },
      mode: 'walk',
    });
    expect(d.steps[2].duration_min).toBe(0); // paso corto
    // Request: field mask completo, español, sin departureTime a pie.
    expect(calls).toHaveLength(1);
    expect(calls[0].mask).toContain('routes.polyline.encodedPolyline');
    expect(calls[0].mask).toContain('routes.legs.steps.navigationInstruction');
    expect(calls[0].mask).toContain('routes.legs.steps.transitDetails');
    expect(calls[0].body).toMatchObject({ travelMode: 'WALK', languageCode: 'es' });
    expect(calls[0].body.departureTime).toBeUndefined();
  });

  it('en auto: TRAFFIC_AWARE y departureTime solo si es futuro', async () => {
    mockFetch(() => DRIVE);
    const d = await routeDetail(A, B, 'car', '2020-01-01T10:00:00-03:00');
    expect(d).toMatchObject({ mode: 'car', duration_min: 14, distance_m: 6830, polyline: 'drive_poly', estimated: false });
    expect(d.steps.map((s) => s.maneuver)).toEqual(['DEPART', 'RAMP_RIGHT']);
    expect(d.steps.every((s) => s.mode === 'car')).toBe(true);
    expect(calls[0].body).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' });
    expect(calls[0].body.departureTime).toBeUndefined();

    const future = new Date(Date.now() + 3600_000).toISOString();
    await routeDetail(A, B, 'car', future);
    expect(calls[1].body.departureTime).toBe(future);
  });

  it('transporte: caminatas agrupadas y tramo en vehículo con línea, paradas y horarios', async () => {
    mockFetch(() => TRANSIT);
    const dep = '2026-10-17T18:00:00-03:00';
    const d = await routeDetail(A, B, 'transit', dep);
    expect(calls[0].body).toMatchObject({ travelMode: 'TRANSIT', departureTime: dep });
    expect(d).toMatchObject({ mode: 'transit', duration_min: 28, distance_m: 7100, polyline: 'transit_poly', estimated: false });
    expect(d.steps).toHaveLength(3);
    expect(d.steps[0]).toEqual({
      instruction: 'Caminá 4 min hasta la parada Ciudadela',
      maneuver: null,
      distance_m: 320,
      duration_min: 4,
      start: { lat: -34.9067, lng: -56.2017 },
      end: { lat: -34.9072, lng: -56.1985 },
      mode: 'walk',
    });
    expect(d.steps[1]).toMatchObject({
      instruction: 'Tomá el bus 121 hacia Pocitos',
      maneuver: null,
      distance_m: 6500,
      duration_min: 18,
      mode: 'transit',
      transit: {
        line: '121',
        vehicle: 'bus',
        from_stop: 'Ciudadela',
        to_stop: 'Bvar. España',
        departure: '18:05',
        arrival: '18:23',
        headsign: 'Pocitos',
        stops: 9,
      },
    });
    expect(d.steps[2]).toMatchObject({ instruction: 'Caminá 3 min hasta tu destino', distance_m: 230, duration_min: 3, mode: 'walk' });
    expect(d.steps[2].end).toEqual({ lat: -34.9145, lng: -56.1505 });
  });

  it('transporte que Google resuelve caminando: pasos a pie sin agrupar', async () => {
    mockFetch(() => WALK);
    const d = await routeDetail(A, B, 'transit');
    expect(d.mode).toBe('transit');
    expect(d.steps).toHaveLength(3);
    expect(d.steps[0]).toMatchObject({ maneuver: 'DEPART', mode: 'walk' });
  });

  it('cachea la misma consulta', async () => {
    mockFetch(() => WALK);
    await routeDetail(A, B, 'walk');
    await routeDetail(A, B, 'walk');
    expect(calls).toHaveLength(1);
  });
});

describe('routeDetail (fallback estimado)', () => {
  it('sin GOOGLE_MAPS_API_KEY: un paso en línea recta, sin llamar a Google', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    mockFetch(() => WALK);
    const d = await routeDetail(A, B, 'walk');
    expect(calls).toHaveLength(0);
    expect(d.estimated).toBe(true);
    expect(d.polyline).toBeNull();
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0]).toMatchObject({ instruction: 'Caminá hacia tu destino', maneuver: null, start: A, end: B, mode: 'walk' });
    expect(d.distance_m).toBeGreaterThan(4000);
    expect(d.steps[0].duration_min).toBe(d.duration_min);
  });

  it('en auto dice "Manejá" y usa el nombre del destino si viene', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const d = await routeDetail(A, B, 'car', undefined, 'Museo Torres García');
    expect(d.steps[0].instruction).toBe('Manejá hacia Museo Torres García');
  });

  it('si Google falla (500) o no hay ruta, estima en vez de tirar error', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    const fail = await routeDetail(A, B, 'transit');
    expect(fail).toMatchObject({ estimated: true, polyline: null, mode: 'transit' });

    clearCache();
    mockFetch(() => ({}));
    const empty = await routeDetail(A, B, 'walk');
    expect(empty).toMatchObject({ estimated: true, polyline: null });
  });
});
