// place_library como memoria compartida de lugares: la escriben research (voz), la cámara (PRD 08) y el generador de
// tours (PRD 06); la leen la cámara, los tours y el verificador. Se acumula con el uso:
//  - findPlaceByName: el lugar por nombre (sin tildes), el más cercano si hay ubicación
//  - ensurePlace: si no existe, lo ubica con search_places (coordenadas reales) y lo crea tier 'researched'
//  - mergeFacts / appendFacts: suma facts verificados sin duplicar (nunca reemplaza: lo de otros orígenes se conserva)
import { distanceMeters } from '@build101/shared';
import { searchPlaces, type PlaceSummary } from '../google/places';
import type { Db } from '../supabase';

/** Un dato de place_library.facts (jsonb). Los campos opcionales se agregaron después: los viejos no los tienen. */
export type LibraryFact = {
  text: string;
  source_url: string;
  verified: boolean;
  /** Frase textual de la fuente que respalda el dato (la devuelve el verificador). */
  quote?: string;
  verified_at?: string;
  origin?: 'research' | 'tour' | 'camera' | 'curated';
  /** research: la pregunta que lo originó. */
  question?: string;
};

export const normText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Suma facts sin duplicar por texto normalizado. Devuelve la lista nueva y cuántos agregó. */
export function mergeFacts(existing: LibraryFact[] | null | undefined, add: LibraryFact[]): { facts: LibraryFact[]; added: number } {
  const list = [...(existing ?? [])];
  const seen = new Set(list.map((f) => normText(f.text)));
  let added = 0;
  for (const f of add) {
    const k = normText(f.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    list.push(f);
    added++;
  }
  return { facts: list, added };
}

/** Palabras con peso del nombre (sin "de", "la", "el"…). */
function nameWords(name: string): string[] {
  return normText(name)
    .split(' ')
    .filter((w) => w.length > 3);
}

type Row = { id: string; name: string | null; lat: number | null; lng: number | null };

export async function findPlaceByName(admin: Db, name: string, near?: { lat: number; lng: number } | null): Promise<string | null> {
  const words = nameWords(name);
  if (!words.length) return null;
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  const { data } = await admin.from('place_library').select('id,name,lat,lng').ilike('name', `%${longest}%`).limit(20);
  const rows = ((data ?? []) as Row[]).filter((p) => words.every((w) => normText(p.name ?? '').includes(w)));
  if (!rows.length) return null;
  if (!near) return rows[0].id;
  const dist = (p: Row) => (p.lat == null || p.lng == null ? Infinity : distanceMeters(near, { lat: p.lat, lng: p.lng }));
  const best = rows.sort((a, b) => dist(a) - dist(b))[0];
  // Mismo nombre pero en otra ciudad (> 20 km): no es este.
  return dist(best) > 20_000 ? null : best.id;
}

export type EnsureDeps = { search: (args: Parameters<typeof searchPlaces>[0]) => Promise<PlaceSummary[]> };
const defaultEnsureDeps: EnsureDeps = { search: searchPlaces };

/** Elige el resultado de search_places que corresponde al nombre (todas las palabras con peso) y está cerca. */
export function pickSearchResult(results: PlaceSummary[], name: string, near?: { lat: number; lng: number } | null): PlaceSummary | null {
  const words = nameWords(name);
  const ok = results.filter((r) => r.lat != null && r.lng != null && words.every((w) => normText(r.name).includes(w)));
  const pool = ok.length ? ok : results.filter((r) => r.lat != null && r.lng != null).slice(0, 1);
  const best = pool[0] ?? null;
  if (!best || !near) return best;
  return distanceMeters(near, { lat: best.lat!, lng: best.lng! }) <= 5_000 ? best : null;
}

/**
 * El lugar en place_library; si no está, lo crea (tier 'researched', sin facts) con las coordenadas de search_places.
 * Dedupe por google_place_id / osm_id y por nombre cerca. null si no se pudo ubicar (no se crea nada a ciegas).
 */
export async function ensurePlace(
  admin: Db,
  args: { name: string; near?: { lat: number; lng: number } | null; language?: string },
  deps: EnsureDeps = defaultEnsureDeps,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await findPlaceByName(admin, args.name, args.near);
  if (existing) return { id: existing, created: false };
  let results: PlaceSummary[] = [];
  try {
    results = await deps.search({ query: args.name, near: args.near ?? undefined, radius_m: 3000, max_results: 5 });
  } catch (e) {
    console.warn('[place_library] search_places:', (e as Error).message);
    return null;
  }
  const hit = pickSearchResult(results, args.name, args.near);
  if (!hit) return null;
  // Sin GOOGLE_MAPS_API_KEY el id viene como osm:<N|W|R><id> (PRD 01): va a osm_id.
  const osm = hit.google_place_id.startsWith('osm:') ? hit.google_place_id.slice(4) : null;
  const gid = osm ? null : hit.google_place_id;
  const { data: same } = await admin
    .from('place_library')
    .select('id')
    .eq(osm ? 'osm_id' : 'google_place_id', osm ?? gid!)
    .maybeSingle();
  if (same) return { id: same.id as string, created: false };
  const { data, error } = await admin
    .from('place_library')
    .insert({
      name: hit.name,
      lat: hit.lat,
      lng: hit.lng,
      google_place_id: gid,
      osm_id: osm,
      tier: 'researched',
      facts: [],
      base_lang: args.language ?? 'es',
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[place_library] insert:', error.message);
    return null;
  }
  console.log(`[place_library] nuevo lugar: ${hit.name} (${hit.lat}, ${hit.lng})`);
  return { id: data.id as string, created: true };
}

/** Suma facts verificados a un lugar (sin duplicar). Devuelve cuántos agregó. */
export async function appendFacts(admin: Db, placeId: string, facts: LibraryFact[]): Promise<number> {
  if (!facts.length) return 0;
  const { data: place } = await admin.from('place_library').select('facts').eq('id', placeId).maybeSingle();
  if (!place) return 0;
  const merged = mergeFacts(place.facts as LibraryFact[] | null, facts);
  if (!merged.added) return 0;
  const { error } = await admin.from('place_library').update({ facts: merged.facts, updated_at: new Date().toISOString() }).eq('id', placeId);
  if (error) {
    console.warn('[place_library] facts:', error.message);
    return 0;
  }
  return merged.added;
}
