import { describe, expect, it } from 'vitest';
import { composeTour, dedupeCandidates, filterCandidates, matchMustInclude, nameSimilarity, type RawCandidate } from './tourGenerator';
import { brief, fakeDeps, fakeLlm, input } from './tourTestKit';

const cand = (over: Partial<RawCandidate> = {}): RawCandidate => ({
  source: 'google',
  google_place_id: null,
  osm_id: null,
  wikidata_id: null,
  name: 'Teatro Solís',
  lat: -34.9073,
  lng: -56.2006,
  interests: ['arquitectura'],
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
  it('fusiona por wikidata_id igual, se queda con la fuente más rica y conserva el título de Wikipedia', () => {
    const a = cand({ source: 'wikipedia', wikidata_id: 'Q123', wiki_title: 'Teatro Solís', sitelinks: 30 });
    const b = cand({ source: 'place_library', wikidata_id: 'Q123', tier: 'curated', facts: [{ text: 'x', source_url: 'y', verified: true }] });
    const out = dedupeCandidates([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].tier).toBe('curated');
    expect(out[0].facts).toHaveLength(1);
    expect(out[0].wiki_title).toBe('Teatro Solís');
    expect(out[0].sitelinks).toBe(30);
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

describe('filterCandidates', () => {
  it('evitar museos: el museo queda solo como fachada; otros avoid descartan', () => {
    const museo = cand({ name: 'Museo Torres García', category_hint: 'museum' });
    const iglesia = cand({ name: 'Iglesia Matriz', category_hint: 'church' });
    const plaza = cand({ name: 'Plaza Independencia' });
    const out = filterCandidates([museo, iglesia, plaza], { avoid: ['museos', 'iglesias'], stepFree: false });
    expect(out.map((c) => c.name)).toEqual(['Museo Torres García', 'Plaza Independencia']);
    expect(out[0].exteriorOnly).toBe(true);
  });

  it('descarta lugares que no son de tour (estacionamientos, hoteles, bancos)', () => {
    const out = filterCandidates([cand({ name: 'Parking Convencion' }), cand({ name: 'Algo', category_hint: 'tourism=hotel' }), cand({ name: 'Cabildo' })], { avoid: [], stepFree: false });
    expect(out.map((c) => c.name)).toEqual(['Cabildo']);
  });

  it('descarta wheelchair=no cuando step_free', () => {
    const a = cand({ wheelchair: 'no' });
    const b = cand({ wheelchair: 'yes' });
    expect(filterCandidates([a, b], { avoid: [], stepFree: true })).toEqual([b]);
    expect(filterCandidates([a, b], { avoid: [], stepFree: false })).toHaveLength(2);
  });
});

describe('matchMustInclude', () => {
  it('encuentra por nombre parcial o parecido y devuelve los que faltan', () => {
    const cands = [cand({ name: 'Mercado del Puerto' }), cand({ name: 'Teatro Solís' })];
    const r = matchMustInclude(cands, ['el mercado del puerto', 'Solis', 'Palacio Legislativo']);
    expect([...r.keys].sort()).toEqual([0, 1]);
    expect(r.missing).toEqual(['Palacio Legislativo']);
  });
});

// ───────────────────────── composeTour de punta a punta con dependencias falsas (sin red)

describe('composeTour (dependencias falsas)', () => {
  it('arma un tour con tesis, borra datos sin respaldo y cita solo fuentes verificadas', async () => {
    const llm = fakeLlm();
    const lines: string[] = [];
    const t = await composeTour({ input: input(), brief: brief(), progress: (l) => lines.push(l), startedAt: Date.now() }, fakeDeps(llm));

    expect(t.title).toBe('La ciudad que miró al puerto');
    expect(t.thesis).toContain('puerto');
    expect(t.stops.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const s of t.stops) {
      // La oración inventada ("1999… Napoleón") se borró; la respaldada quedó y sin la marca [fN].
      expect(s.written.narration_short).not.toMatch(/Napoleón|1999/);
      expect(s.written.narration_short).not.toMatch(/\[f\d+\]/);
      expect(s.written.narration_short).toMatch(/se inauguró en \d{4}\./);
      // La cita inventada (Gaudí) nunca llega a los facts.
      expect(s.facts.every((f) => f.verified && !/Gaudí/.test(f.text))).toBe(true);
      expect(s.sources.length).toBeGreaterThan(0);
      expect(s.sources.every((src) => src.url.startsWith('https://es.wikipedia.org/'))).toBe(true);
      expect(s.dwell_min).toBeGreaterThan(0);
      expect([25, 30, 35, 40, 50]).toContain(s.geofence_radius_m);
    }
    expect(t.stops[t.stops.length - 1].written.transition_to_next).toBeNull();
    expect(t.stats.sentences_dropped).toBeGreaterThanOrEqual(t.stops.length);
    expect(t.stats.facts_rejected).toBeGreaterThan(0);
    expect(t.estDurationMin).toBeLessThanOrEqual(66);
  });

  it('con un lugar pedido sí o sí, queda en el recorrido', async () => {
    const t = await composeTour(
      { input: input({ must_include: ['Mercado del Puerto'], duration_min: 45 }), brief: brief(), progress: () => {}, startedAt: Date.now() },
      fakeDeps(fakeLlm()),
    );
    expect(t.stops.map((s) => s.candidate.name)).toContain('Mercado del Puerto');
  });

  it('menos de 3 candidatos → error legible', async () => {
    const deps = fakeDeps(fakeLlm());
    deps.searchGoogle = async () => [];
    deps.searchWikipedia = async () => [];
    await expect(composeTour({ input: input(), brief: brief(), progress: () => {}, startedAt: Date.now() }, deps)).rejects.toThrow(/mínimo 3/);
  });
});
