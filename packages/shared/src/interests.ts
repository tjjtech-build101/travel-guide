// Mapa de intereses (PRD 06, paso "Score"): a qué tipos de Google Places / tags de OSM corresponde
// cada interés de profile.ts (INTEREST_TAGS — la lista que elige el usuario en el onboarding, PRD 10).
// Un solo vocabulario de intereses en todo el proyecto: este archivo solo mapea categorías externas
// a esos tags, nunca inventa uno nuevo.
import type { InterestTag } from './profile';

/** Google Places (New) `types` → intereses que afina. */
export const GOOGLE_TYPE_INTERESTS: Record<string, InterestTag[]> = {
  historical_landmark: ['historia'],
  historical_place: ['historia'],
  monument: ['historia'],
  museum: ['museos', 'historia', 'arte'],
  art_gallery: ['arte'],
  church: ['religion', 'arquitectura', 'historia'],
  hindu_temple: ['religion', 'arquitectura'],
  mosque: ['religion', 'arquitectura'],
  synagogue: ['religion', 'arquitectura'],
  place_of_worship: ['religion', 'arquitectura'],
  park: ['naturaleza'],
  national_park: ['naturaleza'],
  beach: ['playa', 'naturaleza'],
  restaurant: ['comida'],
  cafe: ['comida'],
  bar: ['comida', 'vida_nocturna'],
  market: ['comida', 'mercados'],
  shopping_mall: ['compras'],
  night_club: ['vida_nocturna', 'musica'],
  performing_arts_theater: ['arte', 'musica'],
  stadium: ['deporte'],
};

/** OSM: `key=value` (ej. "historic=monument", "tourism=viewpoint") → intereses. */
export const OSM_TAG_INTERESTS: Record<string, InterestTag[]> = {
  'historic=*': ['historia'],
  'historic=monument': ['historia'],
  'historic=memorial': ['historia'],
  'historic=castle': ['historia', 'arquitectura'],
  'historic=church': ['religion', 'arquitectura', 'historia'],
  'tourism=artwork': ['arte'],
  'tourism=viewpoint': ['naturaleza'],
  'tourism=museum': ['museos', 'historia', 'arte'],
  'amenity=place_of_worship': ['religion', 'arquitectura'],
  'amenity=theatre': ['arte', 'musica'],
  'amenity=marketplace': ['comida', 'mercados'],
  'leisure=park': ['naturaleza'],
  'leisure=garden': ['naturaleza'],
  'leisure=stadium': ['deporte'],
  'memorial=*': ['historia'],
  'natural=beach': ['playa', 'naturaleza'],
  'shop=*': ['compras'],
};

function normType(t: string): InterestTag[] {
  return GOOGLE_TYPE_INTERESTS[t] ?? [];
}

/** Intereses de un lugar según sus `types` de Google Places (unión, sin repetir). Vacío = sin categoría clara. */
export function interestsForGoogleTypes(types: string[]): InterestTag[] {
  return [...new Set(types.flatMap(normType))];
}

/** Intereses de un lugar según sus tags OSM crudos (ej. de Overpass: {historic: 'monument', tourism: undefined}). */
export function interestsForOsmTags(tags: Record<string, string | undefined>): InterestTag[] {
  const out = new Set<InterestTag>();
  for (const [k, v] of Object.entries(tags)) {
    if (!v) continue;
    for (const match of [`${k}=${v}`, `${k}=*`]) {
      const hit = OSM_TAG_INTERESTS[match];
      if (hit) hit.forEach((i) => out.add(i));
    }
  }
  return [...out];
}

/** Perfil combinado del grupo: peso promedio por interés (0 si nadie lo tiene). Entrada: profiles.interests[] (jsonb, pesos 1-5). */
export function combineInterestWeights(profiles: (Record<string, number> | null | undefined)[]): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const p of profiles) {
    if (!p) continue;
    for (const [k, w] of Object.entries(p)) {
      const e = sums.get(k) ?? { total: 0, count: 0 };
      e.total += Number(w) || 0;
      e.count += 1;
      sums.set(k, e);
    }
  }
  return Object.fromEntries([...sums.entries()].map(([k, { total, count }]) => [k, count ? total / count : 0]));
}

/** Afinidad 0-1 de un lugar con el perfil combinado, a partir de sus intereses detectados. */
export function affinityScore(placeInterests: InterestTag[], weights: Record<string, number>): number {
  if (!placeInterests.length) return 0.3; // sin categoría clara: afinidad base, no se descarta
  const scores = placeInterests.map((i) => (weights[i] ?? 0) / 5); // peso declarado es 1-5
  return Math.max(...scores, 0.3);
}
