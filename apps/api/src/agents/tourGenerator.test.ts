import { describe, expect, it } from 'vitest';
import {
  claimsSupported,
  clampStopCount,
  dedupeCandidates,
  extractClaims,
  filterCandidates,
  nameSimilarity,
  orderStops,
  pickTopCandidates,
  scoreCandidate,
  type Fact,
  type RawCandidate,
} from './tourGenerator';

const cand = (over: Partial<RawCandidate> = {}): RawCandidate => ({
  source: 'google',
  google_place_id: null,
  osm_id: null,
  wikidata_id: null,
  name: 'Teatro Solís',
  lat: -34.9073,
  lng: -56.2006,
  interests: ['arquitectura'],
  notability: 50,
  facts: [],
  ...over,
});

describe('nameSimilarity', () => {
  it('nombres iguales → 1; distintos → bajo', () => {
    expect(nameSimilarity('Teatro Solís', 'Teatro Solís')).toBe(1);
    expect(nameSimilarity('Teatro Solís', 'Teatro Solis')).toBeGreaterThan(0.8); // sin tilde
    expect(nameSimilarity('Teatro Solís', 'Mercado del Puerto')).toBeLessThan(0.3);
  });
});

describe('dedupeCandidates', () => {
  it('fusiona por wikidata_id igual, se queda con la fuente más rica', () => {
    const a = cand({ source: 'wikipedia', wikidata_id: 'Q123', notability: 10 });
    const b = cand({ source: 'place_library', wikidata_id: 'Q123', notability: 99, tier: 'curated', facts: [{ text: 'x', source_url: 'y', verified: true }] });
    const out = dedupeCandidates([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe('curated');
    expect(out[0].facts).toHaveLength(1);
  });

  it('fusiona por cercanía + nombre similar aunque no compartan ids', () => {
    const a = cand({ name: 'Teatro Solis', lat: -34.9073, lng: -56.2006, google_place_id: 'g1' });
    const b = cand({ name: 'Teatro Solís', lat: -34.90732, lng: -56.20061, osm_id: 'N1' });
    const out = dedupeCandidates([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].google_place_id).toBe('g1');
    expect(out[0].osm_id).toBe('N1');
  });

  it('no fusiona lugares distintos cerca uno del otro', () => {
    const a = cand({ name: 'Teatro Solís', lat: -34.9073, lng: -56.2006 });
    const b = cand({ name: 'Plaza Independencia', lat: -34.9074, lng: -56.2007 });
    expect(dedupeCandidates([a, b])).toHaveLength(2);
  });
});

describe('scoreCandidate', () => {
  it('bonus 1.5x para curated', () => {
    const base = cand({ interests: ['historia'], notability: 100 });
    const curated = cand({ interests: ['historia'], notability: 100, tier: 'curated' });
    const weights = { historia: 5 };
    expect(scoreCandidate(curated, weights)).toBeCloseTo(scoreCandidate(base, weights) * 1.5, 5);
  });

  it('mayor afinidad de intereses → mayor score', () => {
    const weights = { historia: 5, comida: 1 };
    const historia = cand({ interests: ['historia'], notability: 10 });
    const comida = cand({ interests: ['comida'], notability: 10 });
    expect(scoreCandidate(historia, weights)).toBeGreaterThan(scoreCandidate(comida, weights));
  });
});

describe('filterCandidates', () => {
  it('descarta por avoid (match en nombre/categoría)', () => {
    const museo = cand({ name: 'Museo Nacional', category_hint: 'museum' });
    const plaza = cand({ name: 'Plaza Independencia' });
    const out = filterCandidates([museo, plaza], { avoid: ['museo'], stepFree: false });
    expect(out).toEqual([plaza]);
  });

  it('descarta wheelchair=no cuando step_free', () => {
    const a = cand({ wheelchair: 'no' });
    const b = cand({ wheelchair: 'yes' });
    expect(filterCandidates([a, b], { avoid: [], stepFree: true })).toEqual([b]);
    expect(filterCandidates([a, b], { avoid: [], stepFree: false })).toHaveLength(2);
  });
});

describe('clampStopCount', () => {
  it('redondea duration_min/8 entre 3 y 12', () => {
    expect(clampStopCount(30)).toBe(4);
    expect(clampStopCount(60)).toBe(8);
    expect(clampStopCount(15)).toBe(3); // clamp mínimo
    expect(clampStopCount(240)).toBe(12); // clamp máximo
  });
});

describe('pickTopCandidates', () => {
  it('elige los N de mayor score', () => {
    const weights = { historia: 5 };
    const cands = [
      cand({ name: 'A', interests: ['historia'], notability: 5 }),
      cand({ name: 'B', interests: ['historia'], notability: 500 }),
      cand({ name: 'C', interests: [], notability: 1 }),
    ];
    const out = pickTopCandidates(cands, weights, 2);
    expect(out.map((c) => c.name)).toEqual(['B', 'A']);
  });
});

describe('orderStops', () => {
  it('arranca en el punto 0 y visita todos', () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.05 },
      { lat: 0, lng: 0.02 },
    ];
    const order = orderStops(pts);
    expect(order[0]).toBe(0);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });

  it('con endIndex, termina ahí', () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.05 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0.02 },
    ];
    const order = orderStops(pts, 1);
    expect(order.at(-1)).toBe(1);
  });

  it('nunca repite ni pierde puntos (N random)', () => {
    const pts = Array.from({ length: 8 }, (_, i) => ({ lat: Math.sin(i) * 0.01, lng: Math.cos(i * 2) * 0.01 }));
    const order = orderStops(pts);
    expect([...order].sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });
});

describe('extractClaims', () => {
  it('saca años, números y nombres propios (no al principio de oración)', () => {
    const claims = extractClaims('El Teatro Solís se inauguró en 1856 con 2500 butacas, diseñado por Carlo Zucchi.');
    expect(claims).toContain('1856');
    expect(claims).toContain('2500');
    expect(claims).toContain('Carlo');
    expect(claims).toContain('Zucchi.'.replace(/\.$/, '')); // el regex limpia puntuación final
  });

  it('no incluye la primera palabra de la oración', () => {
    const claims = extractClaims('Desde acá se ve toda la plaza.');
    expect(claims).not.toContain('Desde');
  });
});

describe('claimsSupported', () => {
  const facts: Fact[] = [
    { text: 'El Teatro Solís se inauguró en 1856.', source_url: 'https://a', verified: true },
    { text: 'Fue diseñado por Carlo Zucchi.', source_url: 'https://b', verified: false },
  ];

  it('true si todos los claims aparecen en facts VERIFICADOS', () => {
    expect(claimsSupported(['1856'], facts)).toBe(true);
  });

  it('false si el claim solo está en un fact no verificado', () => {
    expect(claimsSupported(['Zucchi'], facts)).toBe(false);
  });

  it('false si el claim no aparece en ningún fact', () => {
    expect(claimsSupported(['1920'], facts)).toBe(false);
  });
});
