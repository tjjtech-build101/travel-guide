import { describe, expect, it } from 'vitest';
import type { NearbyRaw } from '../google/places';
import { distanceM, summarizeLocation } from './where_am_i';

// Un punto en el campus de la UdeM (el pin de Google de la universidad queda a ~150 m).
const here = { lat: -34.9188, lng: -56.1535 };

const place = (o: Partial<NearbyRaw> & { google_place_id: string; name: string; lat: number; lng: number }): NearbyRaw => ({
  address: null,
  rating: null,
  price_level: null,
  open_now: null,
  types: [],
  primary_type: null,
  primary_type_label: null,
  viewport: null,
  ...o,
});
const box = (lat: number, lng: number, d: number) => ({ low: { lat: lat - d, lng: lng - d }, high: { lat: lat + d, lng: lng + d } });

const udem = place({
  google_place_id: 'udem',
  name: 'Universidad de Montevideo',
  lat: -34.9175,
  lng: -56.1530,
  types: ['university', 'point_of_interest'],
  primary_type: 'university',
  primary_type_label: 'Universidad',
  viewport: box(-34.9182, -56.1532, 0.0015),
});
const cafe = place({ google_place_id: 'cafe', name: 'Café del campus', lat: -34.9187, lng: -56.1534, types: ['cafe'], viewport: box(-34.9187, -56.1534, 0.0001) });
const farmacia = place({ google_place_id: 'farm', name: 'Farmacia', lat: -34.9200, lng: -56.1550, types: ['pharmacy'] });

describe('where_am_i · summarizeLocation', () => {
  it('detecta que está adentro de un lugar grande aunque su pin esté lejos', () => {
    const r = summarizeLocation(here, 20, [farmacia, cafe, udem], { neighborhood: 'Punta Carretas', city: 'Montevideo', country: 'Uruguay', country_code: 'UY' });
    expect(distanceM(here, { lat: udem.lat!, lng: udem.lng! })).toBeGreaterThan(100);
    expect(r.inside).toMatchObject({ name: 'Universidad de Montevideo', confidence: 'high', type: 'Universidad' });
    expect(r.nearby.map((p) => p.google_place_id)).toEqual(['cafe', 'farm']);
    expect(r.area).toEqual({ neighborhood: 'Punta Carretas', city: 'Montevideo', country: 'Uruguay' });
  });

  it('sin lugar grande: el más cercano si está pegado (medium)', () => {
    const r = summarizeLocation(here, 10, [farmacia, cafe], null);
    expect(r.inside).toMatchObject({ google_place_id: 'cafe', confidence: 'medium' });
    expect(r.nearby.map((p) => p.google_place_id)).toEqual(['farm']);
  });

  it('nada pegado → inside null; dedupe y descarta calles/barrios', () => {
    const calle = place({ google_place_id: 'calle', name: 'Bv. Artigas', lat: here.lat, lng: here.lng, types: ['route'] });
    const r = summarizeLocation(here, 10, [farmacia, farmacia, calle], null);
    expect(r.inside).toBeNull();
    expect(r.nearby.map((p) => p.google_place_id)).toEqual(['farm']);
  });

  it('un viewport del tamaño de un barrio no cuenta como "adentro"', () => {
    const parque = { ...udem, google_place_id: 'big', name: 'Parque enorme', types: ['park'], viewport: box(here.lat, here.lng, 0.05) };
    const r = summarizeLocation(here, 10, [parque], null);
    expect(r.inside).toBeNull();
  });
});
