import { describe, expect, it } from 'vitest';
import { bboxAround, isOsmId, photonToSummary } from './osm';

describe('fallback OSM (sin key de Google)', () => {
  it('photon → PlaceSummary con id osm:', () => {
    const p = photonToSummary({
      properties: { osm_type: 'W', osm_id: 179066483, osm_key: 'amenity', osm_value: 'food_court', name: 'Mercado del Puerto', street: 'Piedras', city: 'Montevideo', country: 'Uruguay' },
      geometry: { coordinates: [-56.2117422, -34.9056495] },
    });
    expect(p).toMatchObject({ google_place_id: 'osm:W179066483', name: 'Mercado del Puerto', lat: -34.9056495, lng: -56.2117422, address: 'Piedras, Montevideo, Uruguay' });
    expect(isOsmId(p!.google_place_id)).toBe(true);
    expect(photonToSummary({ properties: { osm_type: 'N', osm_id: 1 }, geometry: { coordinates: [0, 0] } })).toBeNull();
  });

  it('bbox alrededor de un punto', () => {
    const [minLng, minLat, maxLng, maxLat] = bboxAround(-34.9, -56.2, 4000).split(',').map(Number);
    expect(minLat).toBeLessThan(-34.9);
    expect(maxLat).toBeGreaterThan(-34.9);
    expect(minLng).toBeLessThan(-56.2);
    expect(maxLng - minLng).toBeGreaterThan(maxLat - minLat); // más ancho en longitud fuera del ecuador
  });
});
