import { describe, expect, it } from 'vitest';
import { bearingDeg, rankNearby, relativeDeg, sanitizeOutput, type NearbyPlace } from './look_at_photo';

// Plaza Independencia (centro) y puntos a su alrededor.
const here = { lat: -34.90656, lng: -56.19903 };

describe('look_at_photo: geometría', () => {
  it('bearing: norte ≈ 0, este ≈ 90, oeste ≈ 270', () => {
    expect(bearingDeg(here, { lat: here.lat + 0.001, lng: here.lng })).toBeCloseTo(0, 0);
    expect(bearingDeg(here, { lat: here.lat, lng: here.lng + 0.001 })).toBeCloseTo(90, 0);
    expect(bearingDeg(here, { lat: here.lat, lng: here.lng - 0.001 })).toBeCloseTo(270, 0);
  });

  it('relativeDeg normaliza a −180..180', () => {
    expect(relativeDeg(10, 350)).toBe(20);
    expect(relativeDeg(350, 10)).toBe(-20);
    expect(relativeDeg(180, 0)).toBe(-180);
  });

  it('rankNearby: enfrente primero, saca lejanos y facts no verificados', () => {
    const rows = [
      { id: 'oeste', name: 'Puerta de la Ciudadela', lat: here.lat, lng: here.lng - 0.0015, tier: 'curated', facts: [
        { text: 'Dato ok', source_url: 'https://a', verified: true },
        { text: 'Dato dudoso', source_url: 'https://b', verified: false },
      ] },
      { id: 'norte', name: 'Palacio Salvo', lat: here.lat + 0.0005, lng: here.lng, tier: 'curated', facts: null },
      { id: 'lejos', name: 'Lejos', lat: here.lat + 0.01, lng: here.lng, tier: 'curated', facts: [] },
    ];
    const r = rankNearby(rows, here, 270); // apuntando al oeste
    expect(r.map((p) => p.place_id)).toEqual(['oeste', 'norte']);
    expect(r[0].in_front).toBe(true);
    expect(r[0].facts).toEqual([{ text: 'Dato ok', source_url: 'https://a' }]);
    // Sin brújula: por distancia, nadie "enfrente".
    const sin = rankNearby(rows, here, null);
    expect(sin.map((p) => p.place_id)).toEqual(['norte', 'oeste']);
    expect(sin.every((p) => !p.in_front && p.relative_deg === null)).toBe(true);
  });
});

describe('look_at_photo: sanitizeOutput', () => {
  const nearby: NearbyPlace[] = [
    { place_id: 'p1', name: 'Puerta', distance_m: 50, bearing_deg: 270, relative_deg: 0, in_front: true, facts: [{ text: 'F1', source_url: 'https://a' }] },
  ];
  it('descarta place_id fuera de la lista y facts inventados', () => {
    const out = sanitizeOutput(
      {
        narration: 'x',
        place: { place_id: 'inventado', name: 'Otro', confidence: 0.9 },
        inscriptions: [],
        facts_used: [
          { text: 'F1', source_url: 'https://a' },
          { text: 'Inventado', source_url: 'https://z' },
        ],
        quality: 'ok',
      },
      nearby,
    );
    expect(out.place).toEqual({ place_id: null, name: 'Otro', confidence: 0.5 });
    expect(out.facts_used).toEqual([{ text: 'F1', source_url: 'https://a' }]);
  });
  it('deja pasar un place_id válido', () => {
    const out = sanitizeOutput(
      { narration: 'x', place: { place_id: 'p1', name: 'Puerta', confidence: 0.92 }, inscriptions: [], facts_used: [], quality: 'ok' },
      nearby,
    );
    expect(out.place?.place_id).toBe('p1');
  });
});
