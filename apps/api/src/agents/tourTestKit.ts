// Kit de pruebas del tour director: Claude falso, dependencias falsas (sin red) y un brief de ejemplo.
// Lo usan tourGenerator.test.ts (unidad) y tourGenerator.int.test.ts (Supabase local).
import type { ToolInput } from '@build101/shared';
import { emptyUsage } from './schemas';
import type { TourBrief } from './tourContext';
import type { TourDeps } from './tourGenerator';
import type { TourLLM } from './tourLlm';

export const PLACES = [
  { name: 'Plaza Independencia', lat: -34.9066, lng: -56.199, types: ['plaza'], year: '1837' },
  { name: 'Teatro Solís', lat: -34.9073, lng: -56.2006, types: ['performing_arts_theater'], year: '1856' },
  { name: 'Puerta de la Ciudadela', lat: -34.9066, lng: -56.2015, types: ['historical_landmark'], year: '1746' },
  { name: 'Cabildo de Montevideo', lat: -34.9071, lng: -56.2046, types: ['historical_landmark'], year: '1804' },
  { name: 'Iglesia Matriz', lat: -34.9061, lng: -56.2053, types: ['church'], year: '1790' },
  { name: 'Mercado del Puerto', lat: -34.9063, lng: -56.2125, types: ['market'], year: '1868' },
];

const article = (title: string) => {
  const p = PLACES.find((x) => x.name === title)!;
  return {
    title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    lang: 'es',
    text: `${title} es un lugar del centro de Montevideo. ${title} fue inaugurado en el año ${p.year} tras años de obras. La fachada tiene detalles de piedra que se ven desde la vereda de enfrente. ${'Durante mucho tiempo fue un punto de encuentro de vecinos y visitantes del barrio. '.repeat(4)}`,
  };
};

export function fakeLlm(): TourLLM & { writes: number } {
  const u = emptyUsage();
  const llm = {
    writes: 0,
    async extractFacts({ user }: { user: string }) {
      const title = /ARTÍCULO "([^"]+)"/.exec(user)![1];
      const p = PLACES.find((x) => x.name === title)!;
      return {
        usage: u,
        facts: [
          { text: `${title} se inauguró en ${p.year}`, quote: `${title} fue inaugurado en el año ${p.year} tras años de obras.`, kind: 'date' as const },
          { text: `${title} tiene una fachada con detalles de piedra`, quote: 'La fachada tiene detalles de piedra que se ven desde la vereda de enfrente.', kind: 'detail' as const },
          { text: `${title} fue un punto de encuentro de vecinos y visitantes`, quote: 'Durante mucho tiempo fue un punto de encuentro de vecinos y visitantes del barrio.', kind: 'story' as const },
          // Cita inventada: no está en el artículo → se descarta en código.
          { text: `${title} fue diseñado por Gaudí`, quote: 'Fue diseñado por el arquitecto Antoni Gaudí en persona.', kind: 'person' as const },
        ],
      };
    },
    async research() {
      return { facts: [], usage: u, web_search_calls: 0 };
    },
    async verifyFact() {
      return { result: null, usage: u };
    },
    async judgeFacts({ user }: { user: string }) {
      const ids = [...user.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]);
      return { usage: u, verdicts: ids.map((id) => ({ id, supported: true })) };
    },
    async interpret({ user }: { user: string }) {
      return { usage: u, request: { must_include: /portones/i.test(user) ? ['Los portones de Carrasco'] : [], avoid: [], themes: [] } };
    },
    async direct({ user }: { user: string }) {
      const keys = [...user.split('ALTERNATIVAS')[0].matchAll(/\[(p\d+)\]/g)].map((m) => m[1]);
      return {
        usage: u,
        plan: {
          title: 'La ciudad que miró al puerto',
          thesis: 'Cómo una ciudad amurallada aprendió a vivir del puerto',
          storyline: null,
          swaps: [],
          stops: keys.map((key, i) => ({ key, role: i === 0 ? ('gancho' as const) : ('desarrollo' as const), angle: 'La piedra cuenta la historia', point_at: 'la fachada', personal_hook: i === 0 ? 'Ana, que ama la arquitectura' : null, callbacks_to: [] })),
        },
      };
    },
    async writeStop({ user }: { user: string }) {
      llm.writes++;
      const name = /PARADA \d+ de \d+: (.+?) \(/.exec(user)![1];
      const fact = /\[(f\d+)\] .* se inauguró en (\d{4})/.exec(user);
      const id = fact?.[1] ?? 'f1';
      const year = fact?.[2] ?? '0000';
      const last = user.includes('Es la ÚLTIMA parada');
      return {
        usage: u,
        stop: {
          look_at: 'Mirá la fachada de piedra desde la vereda de enfrente.',
          narration_short: `Fijense en esa piedra gastada: tiene más historia que todos nosotros juntos. ${name} se inauguró en ${year} [${id}]. En 1999 lo visitó Napoleón en persona. Imaginen el ruido de las obras durante años, con carretas y gritos, mientras la ciudad crecía alrededor y nadie sabía todavía en qué se iba a convertir esto que hoy miramos.`,
          narration_more: `Acá conviene mirar con calma cada detalle. La fachada tiene detalles de piedra que se ven desde enfrente, y cada bloque fue puesto a mano por obreros que trabajaron durante años con herramientas simples, subiendo materiales por rampas de madera. Si se acercan, van a ver marcas de cincel que todavía se distinguen, como firmas anónimas de gente que nunca imaginó que alguien las iba a buscar con la vista tanto tiempo después.`,
          narration_secret: 'Casi nadie mira para arriba acá, pero arriba de la puerta hay un detalle que vale la pena: busquen la piedra más oscura de todas y piensen de dónde habrá venido.',
          myth_vs_fact: null,
          photo_spot: 'Desde la vereda de enfrente, con la fachada entera.',
          kid_mission: '¿Cuántas ventanas podés contar desde acá?',
          transition_to_next: last ? null : 'Ahora vamos a un lugar que guarda un secreto.',
          nav_to_next: last ? null : 'Caminamos unos minutos hacia el oeste.',
        },
      };
    },
    async critique() {
      return { usage: u, review: { overall: 'Bien', stops: [] } };
    },
  };
  return llm;
}

export function fakeDeps(llm: TourLLM): TourDeps {
  return {
    llm,
    config: { effort: 'low', maxTokens: 1000, maxIterations: 2, fallbacks: false, directorEffort: 'low', writerEffort: 'low', critic: true },
    now: () => new Date('2026-10-17T18:30:00Z'),
    weather: async () => null,
    reverseGeocode: async () => null,
    nearbyPlaceLibrary: async () => [],
    searchGoogle: async () =>
      PLACES.map((p, i) => ({
        source: 'google' as const,
        google_place_id: `g${i}`,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        interests: ['historia', 'arquitectura'],
        google_types: p.types,
        rating_count: 5000,
        category_hint: p.types.join(' '),
        facts: [],
      })),
    searchByName: async () => null,
    searchWikipedia: async () => PLACES.map((p) => ({ source: 'wikipedia' as const, wiki_title: p.name, wiki_lang: 'es', name: p.name, lat: p.lat, lng: p.lng, interests: [], facts: [] })),
    searchOverpass: async () => [],
    searchEvents: async () => [],
    wikidataInfo: async () => new Map(),
    wikipediaIntros: async (titles) => new Map(titles.map((t) => [t, `${t} es un lugar histórico.`])),
    wikipediaArticle: async (title) => article(title),
    fetchPageText: async () => null,
    computeWalk: async (stops) => {
      const legs = stops.slice(1).map((s, i) => {
        const m = Math.hypot((s.lat - stops[i].lat) * 111_000, (s.lng - stops[i].lng) * 92_000);
        return { m: Math.round(m), min: Math.max(1, Math.round(m / 75)) };
      });
      return { total_min: legs.reduce((t, l) => t + l.min, 0), total_m: legs.reduce((t, l) => t + l.m, 0), polyline: null, legs };
    },
  };
}

export const brief = (): TourBrief => ({
  members: [
    {
      id: 'u1',
      name: 'Ana',
      interests: { arquitectura: 5, historia: 4 },
      avoid: [],
      dietary: [],
      pace: 'balanced',
      budget_level: null,
      step_free: false,
      max_walk_km: null,
      mobility_notes: null,
      languages: ['es'],
      guide_style: null,
      traits: [],
      trip_goal: null,
      trip_must: [],
      trip_avoid: [],
      companions: null,
    },
  ],
  memories: [],
  told: new Map(),
  previousTourPlaceIds: new Set(),
  itinerary: [],
  saved: [],
  start: new Date('2026-10-17T18:30:00Z'),
  durationMin: 60,
  local: { day: 6, minutes: 15 * 60 + 30, text: 'sábado 15:30', date: '2026-10-17' },
  weather: null,
  place: { neighborhood: 'Ciudad Vieja', city: 'Montevideo', country: 'Uruguay', country_code: 'UY' },
  answers: {},
});

export const input = (over: Partial<ToolInput<'generate_tour'>> = {}): ToolInput<'generate_tour'> => ({
  mode: 'spontaneous',
  start_lat: -34.9066,
  start_lng: -56.199,
  duration_min: 60,
  storyline: false,
  language: 'es',
  ...over,
});

