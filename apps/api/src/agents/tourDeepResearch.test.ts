import { describe, expect, it } from 'vitest';
import { emptyUsage } from './schemas';
import { chunkText, deepResearchPlace, dedupeFactList, internalToken, pickFactsForWriting, selfApiUrl, type DeepDeps } from './tourDeepResearch';
import type { Fact } from './tourGenerator';
import type { TourLLM } from './tourLlm';

const u = emptyUsage();

describe('chunkText', () => {
  it('corta en párrafos sin pasarse del máximo ni de la cantidad de tramos', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Párrafo ${i} ${'x'.repeat(900)}`).join('\n');
    const chunks = chunkText(text, 3000, 4);
    expect(chunks.length).toBe(4);
    expect(chunks.every((c) => c.length <= 3000)).toBe(true);
  });
});

describe('pickFactsForWriting / dedupeFactList', () => {
  it('historias y personas primero, máx. 15 por fuente en la primera vuelta', () => {
    const facts: Fact[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ text: `dato ${i}`, source_url: 'https://a', verified: true, kind: 'date' })),
      { text: 'historia', source_url: 'https://b', verified: true, kind: 'story' },
    ];
    const picked = pickFactsForWriting(facts, 20);
    expect(picked[0].text).toBe('historia');
    expect(picked.length).toBe(20);
  });
  it('dedupe por texto normalizado', () => {
    expect(dedupeFactList([{ text: 'El Solís abrió' }, { text: 'el solis  abrio' }])).toHaveLength(1);
  });
});

describe('internalToken / selfApiUrl', () => {
  it('token estable por parada y distinto entre paradas', () => {
    expect(internalToken('a', 's')).toBe(internalToken('a', 's'));
    expect(internalToken('a', 's')).not.toBe(internalToken('b', 's'));
  });
  it('URL propia: explícita > producción > deployment > null', () => {
    expect(selfApiUrl({ API_PUBLIC_URL: 'https://x.dev/' })).toBe('https://x.dev');
    expect(selfApiUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'api.vercel.app', VERCEL_URL: 'dep.vercel.app' })).toBe('https://api.vercel.app');
    expect(selfApiUrl({ VERCEL_URL: 'dep.vercel.app' })).toBe('https://dep.vercel.app');
    expect(selfApiUrl({})).toBeNull();
  });
});

const ARTICLE_ES = `El Teatro Solís es el principal teatro de Montevideo.\nEl Teatro Solís fue inaugurado el 25 de agosto de 1856.\nSu nombre homenajea a Juan Díaz de Solís, navegante español.\n${'Relleno del artículo con más historia del teatro. '.repeat(20)}`;

function deps(over: Partial<TourLLM> = {}): DeepDeps & { calls: Record<string, number> } {
  const calls: Record<string, number> = { research: 0, extract: 0, judge: 0 };
  const llm: TourLLM = {
    async extractFacts() {
      calls.extract++;
      return {
        usage: u,
        facts: [
          { text: 'El Teatro Solís se inauguró en 1856', quote: 'El Teatro Solís fue inaugurado el 25 de agosto de 1856.', kind: 'date' },
          { text: 'El nombre homenajea a Juan Díaz de Solís', quote: 'Su nombre homenajea a Juan Díaz de Solís, navegante español.', kind: 'person' },
          { text: 'Lo diseñó Gaudí', quote: 'Lo diseñó Antoni Gaudí en un viaje secreto a Montevideo.', kind: 'person' },
        ],
      };
    },
    async research({ user }) {
      calls.research++;
      const angle = /director: (.{10})/.exec(user)?.[1] ?? '';
      return { usage: u, web_search_calls: 2, facts: [{ text: `Dato web ${angle}`, source_url: `https://oficial.uy/${calls.research}`, source_title: 'Oficial', quote: 'Una frase textual larga que aparece en la página oficial del teatro.', kind: 'story' }] };
    },
    async verifyFact() {
      return { result: null, usage: u };
    },
    async judgeFacts({ user }) {
      calls.judge++;
      const ids = [...user.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
      return { usage: u, verdicts: ids.map((id) => ({ id, supported: true })) };
    },
    async direct() {
      throw new Error('no');
    },
    async writeStop() {
      throw new Error('no');
    },
    async critique() {
      throw new Error('no');
    },
    ...over,
  };
  return {
    calls,
    llm,
    config: { effort: 'low', maxTokens: 1000, maxIterations: 2, fallbacks: false, writerEffort: 'low' },
    wikipediaArticle: async (title, lang) => ({ title, lang, url: `https://${lang}.wikipedia.org/wiki/${title}`, text: ARTICLE_ES }),
    findWikiTitles: async () => ({ es: 'Teatro Solís', en: 'Solís Theatre' }),
    fetchPageText: async () => 'Encabezado. Una frase textual larga que aparece en la página oficial del teatro. Pie.',
    now: () => Date.now(),
  };
}

describe('deepResearchPlace', () => {
  it('Wikipedia es+en + 3 ángulos web; descarta citas que no están; no repite lo conocido', async () => {
    const d = deps();
    const r = await deepResearchPlace(
      { name: 'Teatro Solís', city: 'Montevideo', country: 'Uruguay', lat: -34.9, lng: -56.2, wikidata_id: null, audience: '', interests: [], known: [{ text: 'El nombre homenajea a Juan Díaz de Solís', source_url: 'x', verified: true }] },
      d,
    );
    expect(d.calls.research).toBe(3);
    expect(d.calls.extract).toBe(2); // es + en (un tramo cada uno)
    const texts = r.facts.map((f) => f.text);
    expect(texts).toContain('El Teatro Solís se inauguró en 1856');
    expect(texts.filter((t) => t.startsWith('Dato web'))).toHaveLength(3);
    expect(texts.some((t) => /Gaudí/.test(t))).toBe(false);
    expect(texts).not.toContain('El nombre homenajea a Juan Díaz de Solís'); // ya lo sabíamos
    expect(r.facts.every((f) => f.verified && f.quote && f.origin === 'tour')).toBe(true);
    expect(r.rejected).toBeGreaterThanOrEqual(2); // Gaudí en es y en en
  });
  it('si la cita web no está en la página, se descarta', async () => {
    const d = deps();
    d.fetchPageText = async () => 'Otra cosa totalmente distinta en la página.';
    const r = await deepResearchPlace({ name: 'Teatro Solís', city: '', country: '', lat: null, lng: null, wikidata_id: null, audience: '', interests: [], known: [] }, d);
    expect(r.facts.some((f) => f.text.startsWith('Dato web'))).toBe(false);
  });
});
