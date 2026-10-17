// Mapa de intereses (PRD 06, paso "Score"): categorías que usa profiles.interests (jsonb, peso 1-5)
// y a qué tipos de Google Places / tags de OSM / Wikidata instance-of corresponden.
// Nuevo interés: agregar acá, nunca inventar uno distinto en el prompt.

export const INTEREST_TAGS = [
  'historia',
  'arquitectura',
  'arte',
  'comida',
  'naturaleza',
  'religioso',
  'shopping',
  'nightlife',
  'curiosidades',
] as const;
export type InterestTag = (typeof INTEREST_TAGS)[number];

/** Google Places (New) `types` → intereses que afina. */
export const GOOGLE_TYPE_INTERESTS: Record<string, InterestTag[]> = {
  historical_landmark: ['historia', 'curiosidades'],
  historical_place: ['historia', 'curiosidades'],
  monument: ['historia', 'curiosidades'],
  museum: ['historia', 'arte', 'arquitectura'],
  art_gallery: ['arte'],
  church: ['religioso', 'arquitectura', 'historia'],
  hindu_temple: ['religioso', 'arquitectura'],
  mosque: ['religioso', 'arquitectura'],
  synagogue: ['religioso', 'arquitectura'],
  place_of_worship: ['religioso', 'arquitectura'],
  park: ['naturaleza'],
  national_park: ['naturaleza'],
  plaza: ['arquitectura', 'historia'],
  tourist_attraction: ['curiosidades'],
  restaurant: ['comida'],
  cafe: ['comida'],
  bar: ['comida', 'nightlife'],
  market: ['comida', 'shopping'],
  shopping_mall: ['shopping'],
  night_club: ['nightlife'],
  performing_arts_theater: ['arte', 'arquitectura'],
};

/** OSM: `key=value` (ej. "historic=monument", "tourism=viewpoint") → intereses. */
export const OSM_TAG_INTERESTS: Record<string, InterestTag[]> = {
  'historic=*': ['historia', 'curiosidades'],
  'historic=monument': ['historia', 'curiosidades'],
  'historic=memorial': ['historia', 'curiosidades'],
  'historic=castle': ['historia', 'arquitectura'],
  'historic=church': ['religioso', 'arquitectura', 'historia'],
  'tourism=attraction': ['curiosidades'],
  'tourism=artwork': ['arte'],
  'tourism=viewpoint': ['naturaleza', 'curiosidades'],
  'tourism=museum': ['historia', 'arte'],
  'amenity=place_of_worship': ['religioso', 'arquitectura'],
  'amenity=theatre': ['arte', 'arquitectura'],
  'amenity=marketplace': ['comida', 'shopping'],
  'leisure=park': ['naturaleza'],
  'leisure=garden': ['naturaleza'],
  'memorial=*': ['historia', 'curiosidades'],
  'shop=*': ['shopping'],
};

function normType(t: string): InterestTag[] {
  return GOOGLE_TYPE_INTERESTS[t] ?? [];
}

/** Intereses de un lugar según sus `types` de Google Places (unión, sin repetir). */
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

/** Perfil combinado del grupo: peso promedio por interés (0 si nadie lo tiene). Entrada: profiles.interests[] (jsonb). */
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
