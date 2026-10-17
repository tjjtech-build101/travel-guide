// Ciudad de juguete para los tests del armador de días (compose/check/coverage). Buenos Aires, coordenadas reales.
// Tramo: lunes 16/11/2026 (llegada 10:00) → jueves 19/11 (salida 22:30). Miércoles con 80 % de lluvia.
// Solo la usan los tests de compose.test.ts, check.test.ts y coverage.test.ts.
import type { CatalogItem } from '@build101/shared';
import type { PlaceSummary } from '../../google/places';
import type { ComposeDeps, ComposeLeg, PickedItem, PlannerGroup, PlannerMember } from './types';

export const DAYS = [
  { id: 'd-mon', date: '2026-11-16' },
  { id: 'd-tue', date: '2026-11-17' },
  { id: 'd-wed', date: '2026-11-18' },
  { id: 'd-thu', date: '2026-11-19' },
];

export const member = (over: Partial<PlannerMember> = {}): PlannerMember => ({
  user_id: 'u-sofi',
  name: 'Sofi',
  interests: { arte: 5, historia: 4 },
  avoid: [],
  must: [],
  dietary: [],
  pace: 'balanced',
  chronotype: 'normal',
  budget: 'mid',
  step_free: false,
  max_walk_km: null,
  ...over,
});

export const group = (over: Partial<PlannerGroup> = {}): PlannerGroup => ({
  members: [member(), member({ user_id: 'u-juan', name: 'Juan', interests: { comida: 5 } })],
  weights: { arte: 5, historia: 4, comida: 4 },
  avoid: [],
  must: [],
  dietary: [],
  pace: 'balanced',
  chronotype: 'normal',
  budget: 'mid',
  hasKids: false,
  firstTime: true,
  stepFree: false,
  ...over,
});

export const leg = (over: Partial<ComposeLeg> = {}): ComposeLeg => ({
  id: 'leg-ba',
  trip_id: 'trip-1',
  city: 'Buenos Aires',
  country: 'Argentina',
  center: { lat: -34.6037, lng: -58.3816 },
  days: DAYS,
  dayWindows: { '2026-11-16': { start_min: 600, end_min: 1410 }, '2026-11-19': { start_min: 0, end_min: 1350 } },
  weather: {
    '2026-11-16': { precip_prob: 10, temp_max: 26, sunset_min: 1188 },
    '2026-11-17': { precip_prob: 5, temp_max: 27, sunset_min: 1189 },
    '2026-11-18': { precip_prob: 80, temp_max: 21, sunset_min: 1190 },
    '2026-11-19': { precip_prob: 20, temp_max: 25, sunset_min: 1191 },
  },
  lodging: null,
  lodgingZones: [
    { zone: 'Palermo', why: 'Verde, gastronómico y seguro para caminar de noche.', lat: -34.5889, lng: -58.4199 },
    { zone: 'Recoleta', why: 'Elegante y céntrico, cerca de museos.', lat: -34.5875, lng: -58.393 },
  ],
  ...over,
});

export const item = (over: Partial<CatalogItem> & Pick<CatalogItem, 'id' | 'name'>): CatalogItem => ({
  category: 'landmark',
  tier: 'recommended',
  zone: null,
  google_place_id: `gp-${over.id}`,
  lat: null,
  lng: null,
  duration_min: 60,
  best_time: 'any',
  indoor: false,
  booking: 'none',
  cost_hint: null,
  interests: [],
  why: `${over.name} vale la pena.`,
  tip: null,
  closed_days: [],
  periods: null,
  event_dates: null,
  event_time: null,
  sources: [{ url: `https://example.com/${over.id}`, title: over.name }],
  notability: 0.5,
  rating: 4.6,
  rating_count: 1000,
  ...over,
});

export const ITEMS: CatalogItem[] = [
  // Recoleta
  item({ id: 'recoleta-cementerio', name: 'Cementerio de la Recoleta', zone: 'Recoleta', lat: -34.5875, lng: -58.393, tier: 'must', duration_min: 90, best_time: 'morning', tip: 'Andá temprano.' }),
  item({ id: 'bellas-artes', name: 'Museo Nacional de Bellas Artes', zone: 'Recoleta', lat: -34.5839, lng: -58.3929, category: 'museum', duration_min: 120, indoor: true, closed_days: [1] }),
  item({ id: 'floralis', name: 'Floralis Genérica', zone: 'Recoleta', lat: -34.5816, lng: -58.3943, duration_min: 30 }),
  item({ id: 'pilar', name: 'Basílica Nuestra Señora del Pilar', zone: 'Recoleta', lat: -34.5878, lng: -58.3918, duration_min: 30, indoor: true }),
  // Palermo
  item({ id: 'rosedal', name: 'Rosedal de Palermo', zone: 'Palermo', lat: -34.5715, lng: -58.4175, category: 'park', duration_min: 60, best_time: 'sunset' }),
  item({ id: 'jardin-japones', name: 'Jardín Japonés', zone: 'Palermo', lat: -34.5755, lng: -58.4097, category: 'park', duration_min: 75 }),
  item({ id: 'malba', name: 'MALBA', zone: 'Palermo', lat: -34.577, lng: -58.4033, category: 'museum', duration_min: 120, indoor: true, closed_days: [2], tier: 'must' }),
  item({ id: 'palermo-soho', name: 'Palermo Soho', zone: 'Palermo', lat: -34.5886, lng: -58.4304, category: 'neighborhood', duration_min: 120, best_time: 'afternoon' }),
  // San Telmo
  item({ id: 'mercado-san-telmo', name: 'Mercado de San Telmo', zone: 'San Telmo', lat: -34.621, lng: -58.3717, category: 'market', duration_min: 60, indoor: true }),
  item({ id: 'plaza-dorrego', name: 'Plaza Dorrego', zone: 'San Telmo', lat: -34.6206, lng: -58.3716, duration_min: 45 }),
  item({ id: 'zanjon', name: 'El Zanjón de Granados', zone: 'San Telmo', lat: -34.6188, lng: -58.3713, category: 'museum', duration_min: 60, indoor: true, booking: 'recommended' }),
  // La Boca
  item({ id: 'caminito', name: 'Caminito', zone: 'La Boca', lat: -34.6393, lng: -58.3627, category: 'neighborhood', duration_min: 90, tier: 'must' }),
  item({ id: 'usina', name: 'Usina del Arte', zone: 'La Boca', lat: -34.6286, lng: -58.3567, category: 'museum', duration_min: 60, indoor: true }),
  item({ id: 'proa', name: 'Fundación Proa', zone: 'La Boca', lat: -34.6355, lng: -58.364, category: 'museum', duration_min: 75, indoor: true }),
  // Centro
  item({ id: 'plaza-de-mayo', name: 'Plaza de Mayo y Casa Rosada', zone: 'Centro', lat: -34.6081, lng: -58.3703, tier: 'must', duration_min: 60 }),
  item({ id: 'colon', name: 'Teatro Colón', zone: 'Centro', lat: -34.6011, lng: -58.383, tier: 'must', duration_min: 60, indoor: true, booking: 'required' }),
  item({ id: 'obelisco', name: 'Obelisco', zone: 'Centro', lat: -34.6037, lng: -58.3816, duration_min: 20 }),
  item({ id: 'tortoni', name: 'Café Tortoni', zone: 'Centro', lat: -34.6087, lng: -58.3784, category: 'food', duration_min: 60, indoor: true, best_time: 'midday' }),
  // Puerto Madero
  item({ id: 'puente-mujer', name: 'Puente de la Mujer', zone: 'Puerto Madero', lat: -34.608, lng: -58.3653, duration_min: 30 }),
  // Noche, comida, evento, escapadas
  item({ id: 'floreria', name: 'Florería Atlántico', zone: 'Retiro', lat: -34.5925, lng: -58.3755, category: 'nightlife', duration_min: 90, indoor: true, best_time: 'night' }),
  item({ id: 'don-julio', name: 'Don Julio', zone: 'Palermo', lat: -34.5866, lng: -58.4258, category: 'food', duration_min: 90, indoor: true, best_time: 'evening', booking: 'recommended' }),
  item({ id: 'bombonera', name: 'Partido en La Bombonera', zone: 'La Boca', lat: -34.6356, lng: -58.3647, category: 'event', duration_min: 120, event_dates: ['2026-11-19'], event_time: '17:00' }),
  item({ id: 'tigre', name: 'Tigre y el Delta', zone: null, lat: -34.426, lng: -58.5796, category: 'day_trip', duration_min: 480, tier: 'must' }),
  item({ id: 'colonia', name: 'Colonia del Sacramento', zone: null, lat: -34.4711, lng: -57.8443, category: 'day_trip', duration_min: 600 }),
];

export const byId = (id: string) => ITEMS.find((i) => i.id === id)!;

export function pick(it: CatalogItem, over: Partial<PickedItem> = {}): PickedItem {
  return {
    option_id: `opt-${it.id}`,
    item: it,
    section: it.tier === 'must' ? 'must' : 'for_you',
    must: false,
    score: it.tier === 'must' ? 0.9 : 0.6,
    for_user_ids: [],
    reason: null,
    reactions: [],
    ...over,
  };
}

type SearchArgs = { query: string; near?: { lat: number; lng: number }; radius_m?: number; max_results?: number };

/** Restaurantes y hoteles falsos alrededor de `near`: ids estables, ratings y precios variados. */
export function fakeSearch(): ComposeDeps['searchPlaces'] & { calls: SearchArgs[] } {
  const calls: SearchArgs[] = [];
  const RATINGS = [4.7, 4.5, 4.3, 4.1, 4.8, 3.9, 4.4];
  const PRICES = [2, 3, 1, 4, 2, 2, 3];
  const fn = async (args: SearchArgs): Promise<PlaceSummary[]> => {
    calls.push(args);
    const c = args.near ?? { lat: -34.6037, lng: -58.3816 };
    const tag = `${args.query}@${c.lat.toFixed(3)},${c.lng.toFixed(3)}`;
    return RATINGS.slice(0, args.max_results ?? 7).map((rating, i) => ({
      google_place_id: `place:${tag}:${i}`,
      name: `${args.query.replace(/^\w/, (x) => x.toUpperCase())} ${tag.slice(-6)}-${i + 1}`,
      address: null,
      lat: c.lat + (i - 3) * 0.0015,
      lng: c.lng + ((i % 3) - 1) * 0.0015,
      rating,
      price_level: PRICES[i],
      open_now: null,
      types: ['restaurant'],
    }));
  };
  return Object.assign(fn, { calls });
}
