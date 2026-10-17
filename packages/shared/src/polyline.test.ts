import { describe, expect, it } from 'vitest';

import { decodePolyline, encodePolyline } from './polyline';

describe('decodePolyline', () => {
  it('decodifica el ejemplo de la doc de Google', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(pts[1]).toEqual({ lat: 40.7, lng: -120.95 });
    expect(pts[2]).toEqual({ lat: 43.252, lng: -126.453 });
  });

  it('vacío o null → []', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline(undefined)).toEqual([]);
  });

  it('cadena cortada: devuelve lo leído sin tirar', () => {
    const full = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const pts = decodePolyline(full.slice(0, full.length - 3));
    expect(pts.length).toBe(2);
  });

  it('ida y vuelta con coordenadas del sur (Montevideo)', () => {
    const pts = [
      { lat: -34.90656, lng: -56.19903 },
      { lat: -34.9071, lng: -56.2015 },
      { lat: -34.90598, lng: -56.20449 },
    ];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
});
