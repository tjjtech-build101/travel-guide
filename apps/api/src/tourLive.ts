// PRD 07 · Tour en vivo (backend): lectura de tour + paradas y helpers puros de `tours.progress`.
// Permisos: se lee el tour con el cliente del usuario (RLS: dueño o miembro del viaje); si lo ve, las escrituras
// (tours.progress / status, content_told de los participantes) van con service role.
import {
  distanceMeters,
  STOP_LAYER_COLUMN,
  STOP_LAYERS,
  type StopLayer,
  type TourProgress,
  type TourStopView,
} from '@build101/shared';
import { badInput, dbError, notFound } from './errors';
import type { ToolCtx } from './tools/types';

export type TourRow = {
  id: string;
  trip_id: string | null;
  block_id: string | null;
  owner_user_id: string | null;
  title: string | null;
  mode: string | null;
  status: string;
  duration_min: number | null;
  route: { polyline: string | null; total_walk_m?: number; est_duration_min?: number } | null;
  progress: TourProgress | null;
};

export type StopRow = {
  id: string;
  tour_id: string;
  place_id: string | null;
  sort_order: number | null;
  geofence_radius_m: number | null;
  dwell_min: number | null;
  look_at: string | null;
  narration_short: string | null;
  narration_more: string | null;
  narration_secret: string | null;
  myth_vs_fact: string | null;
  photo_spot: string | null;
  kid_mission: string | null;
  transition_to_next: string | null;
  nav_to_next: string | null;
  sources: unknown;
  place_library: { name: string | null; lat: number | null; lng: number | null } | null;
};

const TOUR_COLS = 'id,trip_id,block_id,owner_user_id,title,mode,status,duration_min,route,progress';
const STOP_COLS =
  'id,tour_id,place_id,sort_order,geofence_radius_m,dwell_min,look_at,narration_short,narration_more,narration_secret,myth_vs_fact,photo_spot,kid_mission,transition_to_next,nav_to_next,sources,place_library(name,lat,lng)';

/** Lee el tour con RLS (404 si el usuario no lo ve). */
export async function loadTour(ctx: ToolCtx, tourId: string): Promise<TourRow> {
  const { data, error } = await ctx.db.from('tours').select(TOUR_COLS).eq('id', tourId).maybeSingle();
  if (error) throw dbError(error, 'tours');
  if (!data) throw notFound('No encontré ese tour.');
  return data as unknown as TourRow;
}

export async function loadStops(ctx: ToolCtx, tourId: string): Promise<StopRow[]> {
  const { data, error } = await ctx.admin.from('tour_stops').select(STOP_COLS).eq('tour_id', tourId).order('sort_order');
  if (error) throw dbError(error, 'tour_stops');
  return (data ?? []) as unknown as StopRow[];
}

/** Parada por id con su tour (RLS sobre el tour). */
export async function loadStop(ctx: ToolCtx, stopId: string): Promise<{ stop: StopRow; tour: TourRow }> {
  const { data, error } = await ctx.admin.from('tour_stops').select(STOP_COLS).eq('id', stopId).maybeSingle();
  if (error) throw dbError(error, 'tour_stops');
  if (!data) throw notFound('No encontré esa parada.');
  const stop = data as unknown as StopRow;
  const tour = await loadTour(ctx, stop.tour_id);
  return { stop, tour };
}

/** Capas ya contadas a `userId` por lugar. */
export async function loadTold(ctx: ToolCtx, userId: string, placeIds: string[]): Promise<Map<string, StopLayer[]>> {
  const out = new Map<string, StopLayer[]>();
  if (!placeIds.length) return out;
  const { data, error } = await ctx.admin.from('content_told').select('place_id,layer').eq('user_id', userId).in('place_id', placeIds);
  if (error) throw dbError(error, 'content_told');
  for (const r of data ?? []) {
    const k = r.place_id as string;
    out.set(k, [...(out.get(k) ?? []), r.layer as StopLayer]);
  }
  return out;
}

export async function saveProgress(ctx: ToolCtx, tourId: string, progress: TourProgress, status?: string): Promise<void> {
  const patch: Record<string, unknown> = { progress };
  if (status) patch.status = status;
  const { error } = await ctx.admin.from('tours').update(patch).eq('id', tourId);
  if (error) throw dbError(error, 'tours');
}

// ---------- puros ----------

export function stopName(s: Pick<StopRow, 'place_library' | 'sort_order'>): string {
  return s.place_library?.name ?? `Parada ${s.sort_order ?? '?'}`;
}

export function layerText(s: StopRow, layer: StopLayer): string | null {
  const v = s[STOP_LAYER_COLUMN[layer]];
  return typeof v === 'string' && v.trim() ? v : null;
}

export function stopSources(s: StopRow): { url: string; title?: string }[] {
  if (!Array.isArray(s.sources)) return [];
  return (s.sources as unknown[])
    .map((x) => {
      if (typeof x === 'string') return { url: x };
      const o = x as { url?: unknown; source_url?: unknown; title?: unknown };
      const url = typeof o?.url === 'string' ? o.url : typeof o?.source_url === 'string' ? o.source_url : null;
      return url ? { url, ...(typeof o.title === 'string' ? { title: o.title } : {}) } : null;
    })
    .filter((x): x is { url: string; title?: string } => !!x);
}

export function stopView(s: StopRow, told: StopLayer[] = []): TourStopView {
  return {
    stop_id: s.id,
    place_id: s.place_id,
    name: stopName(s),
    sort_order: s.sort_order ?? 0,
    lat: s.place_library?.lat ?? null,
    lng: s.place_library?.lng ?? null,
    geofence_radius_m: s.geofence_radius_m ?? 35,
    dwell_min: s.dwell_min ?? 4,
    look_at: s.look_at,
    layers_told: told,
    layers_available: STOP_LAYERS.filter((l) => layerText(s, l) != null),
  };
}

/** Duración del tour para el reloj: duration_min, si no la estimada de la ruta, si no 60. */
export function tourDurationMin(t: Pick<TourRow, 'duration_min' | 'route'>): number {
  return t.duration_min ?? t.route?.est_duration_min ?? 60;
}

export function initialProgress(stops: Pick<StopRow, 'id'>[], durationMin: number, now = new Date()): TourProgress {
  return {
    current_stop_id: stops[0]?.id ?? null,
    visited: [],
    skipped: [],
    started_at: now.toISOString(),
    ends_at: new Date(now.getTime() + durationMin * 60_000).toISOString(),
  };
}

/** Paradas que faltan (ni visitadas ni salteadas), en orden. */
export function pendingStops<S extends Pick<StopRow, 'id' | 'sort_order'>>(stops: S[], p: TourProgress): S[] {
  const done = new Set([...p.visited.map((v) => v.stop_id), ...p.skipped]);
  return [...stops].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).filter((s) => !done.has(s.id));
}

export function remainingMin(p: TourProgress, now = new Date()): number {
  return Math.max(0, Math.round((new Date(p.ends_at).getTime() - now.getTime()) / 60_000));
}

/**
 * next_stop: la actual queda visitada (left_at = ahora) y la siguiente es la primera pendiente
 * (en explorador con posición: la pendiente más cercana).
 */
export function advance<S extends Pick<StopRow, 'id' | 'sort_order'> & { place_library?: { lat: number | null; lng: number | null } | null }>(
  stops: S[],
  p: TourProgress,
  opts: { now?: Date; near?: { lat: number; lng: number } | null } = {},
): { progress: TourProgress; previousId: string | null; next: S | null } {
  const now = (opts.now ?? new Date()).toISOString();
  const visited = p.visited.map((v) => ({ ...v }));
  const previousId = p.current_stop_id;
  if (previousId && !p.skipped.includes(previousId)) {
    const v = visited.find((x) => x.stop_id === previousId);
    if (v) v.left_at = v.left_at ?? now;
    else visited.push({ stop_id: previousId, arrived_at: now, left_at: now });
  }
  const progress: TourProgress = { ...p, visited };
  let pending = pendingStops(stops, progress);
  const near = opts.near;
  if (near) {
    pending = [...pending].sort((a, b) => dist(a, near) - dist(b, near));
  }
  const next = pending[0] ?? null;
  progress.current_stop_id = next?.id ?? null;
  return { progress, previousId, next };
}

function dist(s: { place_library?: { lat: number | null; lng: number | null } | null }, p: { lat: number; lng: number }): number {
  const lat = s.place_library?.lat;
  const lng = s.place_library?.lng;
  return lat == null || lng == null ? Infinity : distanceMeters({ lat, lng }, p);
}

/** skip_stop: la marca salteada; si era la actual, la actual pasa a la próxima pendiente. */
export function skip<S extends Pick<StopRow, 'id' | 'sort_order'>>(stops: S[], p: TourProgress, stopId: string): TourProgress {
  if (!stops.some((s) => s.id === stopId)) throw badInput('Esa parada no es de este tour.');
  const skipped = p.skipped.includes(stopId) ? p.skipped : [...p.skipped, stopId];
  const progress: TourProgress = { ...p, skipped };
  if (p.current_stop_id === stopId || p.current_stop_id == null) {
    progress.current_stop_id = pendingStops(stops, progress)[0]?.id ?? null;
  }
  return progress;
}
