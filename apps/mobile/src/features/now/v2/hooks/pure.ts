// Lógica pura de los hooks de datos de Ahora v2 (docs/AHORA-V2.md). Sin React ni red: se testea con
// `pnpm --filter mobile test:nowdata` (pure.test.ts).
import {
  type AgentProposalRow,
  type LocationSharing,
  type NowBriefSnapshotT,
  type ToolInput,
  type WeatherDay,
  wmoIcon,
} from '@build101/shared';

import type { PlanBlock, PlanOverview } from '../../../plan/selectors';
import { blockWindow, clock, distanceM, type LatLng } from '../../selectors';
import type { GapSuggestion, GroupPosition, RainPlanB, WeatherSummary } from '../types';

function hhmmToMin(t: string | null | undefined): number | null {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ───────────────────────── Clima

/** Prob. de lluvia desde la que avisamos. */
export const RAIN_PROB = 60;
const RAIN_HORIZON_MIN = 180;

const SUMMARY: Record<WeatherSummary['icon'], string> = {
  sun: 'Despejado',
  cloud: 'Nublado',
  rain: 'Lluvia',
  storm: 'Tormenta',
  snow: 'Nieve',
  fog: 'Niebla',
};

function iconFor(code: number): WeatherSummary['icon'] {
  const i = wmoIcon(code);
  if (i === 'cloud-sun') return code <= 1 ? 'sun' : 'cloud';
  return i;
}

/** WeatherDay (herramienta weather) → resumen para el chip, a la hora local `nowMin`. */
export function summarizeWeather(day: WeatherDay | null | undefined, nowMin: number): WeatherSummary | null {
  if (!day) return null;
  const hours = (day.hourly ?? []).map((h) => ({ ...h, min: hhmmToMin(h.h) ?? 0 }));
  const nowHour = Math.floor(nowMin / 60) * 60;
  const cur = hours.find((h) => h.min === nowHour) ?? null;
  const code = cur?.code ?? day.code;
  const icon = iconFor(code);
  const rainy = hours.find((h) => h.min >= nowHour && h.min <= nowMin + RAIN_HORIZON_MIN && h.pp >= RAIN_PROB);
  const temp = cur?.t ?? (Number.isFinite(day.tmax) ? day.tmax : null);
  return {
    temp_c: temp == null ? null : Math.round(temp),
    icon,
    summary: rainy && icon !== 'rain' && icon !== 'storm' ? `${SUMMARY[icon]} · lluvia a las ${clock(rainy.min)}` : SUMMARY[icon],
    rainSoon: !!rainy,
    rainFrom: rainy ? clock(rainy.min) : null,
  };
}

// ───────────────────────── Plan B por lluvia

const OUTDOOR_TYPES = new Set<PlanBlock['type']>(['activity', 'tour', 'free']);

/** Al aire libre = actividad / tour / libre con lugar. */
export function isOutdoor(b: PlanBlock): boolean {
  return OUTDOOR_TYPES.has(b.type) && (b.lat != null || !!b.place_name || !!b.google_place_id);
}

/**
 * Si llueve (rainSoon) y hay un bloque al aire libre del día que cae en la franja de lluvia (desde rainFrom
 * hasta 3 h después), el primero. hasRainVariant: hay bloques plan_variant 'rain' ese día.
 */
export function rainPlanB(args: {
  weather: WeatherSummary | null;
  dayBlocks: PlanBlock[];
  allBlocks: PlanBlock[];
  dayId: string | null;
}): RainPlanB | null {
  const { weather, dayBlocks, allBlocks, dayId } = args;
  const from = hhmmToMin(weather?.rainFrom);
  if (!weather?.rainSoon || from == null || !dayId) return null;
  const hit = dayBlocks
    .filter((b) => b.day_id === dayId && !b.masked && (!b.plan_variant || b.plan_variant === 'main'))
    .filter(isOutdoor)
    .map((b) => ({ b, w: blockWindow(b) }))
    .filter((x): x is { b: PlanBlock; w: { start: number; end: number } } => !!x.w && x.w.end > from && x.w.start < from + RAIN_HORIZON_MIN)
    .sort((a, z) => a.w.start - z.w.start)[0];
  if (!hit) return null;
  return {
    blockId: hit.b.id,
    blockTitle: hit.b.title,
    at: clock(Math.max(from, hit.w.start)),
    hasRainVariant: allBlocks.some((b) => b.day_id === dayId && b.plan_variant === 'rain'),
  };
}

// ───────────────────────── Compartir mi ubicación

export const PUBLISH_EVERY_MS = 30_000;
export const PUBLISH_MOVE_M = 50;

export type Published = { at: number; lat: number; lng: number };

/** Throttle de publicación: la primera vez, cada 30 s o al moverse 50 m (lo primero). */
export function shouldPublish(last: Published | null, fix: LatLng, nowMs: number): boolean {
  if (!last) return true;
  if (nowMs - last.at >= PUBLISH_EVERY_MS) return true;
  return distanceM(last, fix) >= PUBLISH_MOVE_M;
}

/**
 * ¿Corresponde compartir ahora? (PRD 13)
 * - 'never' o fantasma activo (ghost_until en el futuro) o viaje terminado → no.
 * - 'always' → sí.
 * - 'shared_only' (default) → solo durante un bloque compartido en curso (yo + ≥ 1 persona) o un tour en vivo.
 */
export function sharingAllowed(args: {
  sharing: LocationSharing | null | undefined;
  ghostUntil: string | null | undefined;
  tripStatus?: string | null;
  nowMs: number;
  sharedNow: boolean;
}): boolean {
  const { sharing, ghostUntil, tripStatus, nowMs, sharedNow } = args;
  if (tripStatus === 'finished') return false;
  if (sharing === 'never') return false;
  if (ghostUntil && Date.parse(ghostUntil) > nowMs) return false;
  if (sharing === 'always') return true;
  return sharedNow;
}

/** Bloque compartido: me incluye a mí y a alguien más. */
export function isSharedBlock(b: Pick<PlanBlock, 'participant_ids'> | null | undefined, me: string): boolean {
  return !!b && b.participant_ids.includes(me) && b.participant_ids.length >= 2;
}

// ───────────────────────── Posiciones del grupo

export const GROUP_MAX_AGE_MS = 15 * 60_000;

export type MemberLocationRow = {
  user_id: string;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
};

/** Las de los demás, frescas (≤ 15 min), con distancia a mí. Las más cercanas primero. */
export function buildGroupPositions(
  rows: MemberLocationRow[],
  members: PlanOverview['members'],
  me: string,
  here: LatLng | null,
  nowMs: number,
): GroupPosition[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  return rows
    .filter((r) => r.user_id !== me && r.lat != null && r.lng != null && r.updated_at)
    .filter((r) => nowMs - Date.parse(r.updated_at!) <= GROUP_MAX_AGE_MS)
    .map((r) => {
      const p = { lat: r.lat!, lng: r.lng! };
      const m = byId.get(r.user_id);
      return {
        user_id: r.user_id,
        display_name: m?.display_name ?? null,
        avatar_url: m?.avatar_url ?? null,
        lat: p.lat,
        lng: p.lng,
        updated_at: r.updated_at!,
        distance_m: here ? Math.round(distanceM(here, p)) : null,
      };
    })
    .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
}

// ───────────────────────── Caché offline (now_screen:{trip_id})

export const NOW_CACHE_VERSION = 1;
export const nowCacheKey = (tripId: string) => `now_screen:${tripId}`;

export type NowCacheData = {
  overview?: PlanOverview;
  blocks?: PlanBlock[];
  proposals?: AgentProposalRow[];
};
export type NowCache = NowCacheData & { v: number; trip_id: string; fetched_at: string };

export function serializeNowCache(tripId: string, data: NowCacheData, nowMs: number): string | null {
  if (!data.overview && !data.blocks && !data.proposals) return null;
  const c: NowCache = { v: NOW_CACHE_VERSION, trip_id: tripId, fetched_at: new Date(nowMs).toISOString(), ...data };
  return JSON.stringify(c);
}

/** null si no hay, está roto, es de otra versión o de otro viaje. */
export function parseNowCache(raw: string | null | undefined, tripId: string): NowCache | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as NowCache;
    if (!c || c.v !== NOW_CACHE_VERSION || c.trip_id !== tripId || !c.fetched_at || Number.isNaN(Date.parse(c.fetched_at))) {
      return null;
    }
    if (c.blocks && !Array.isArray(c.blocks)) return null;
    if (c.proposals && !Array.isArray(c.proposals)) return null;
    if (c.overview && (!Array.isArray(c.overview.legs) || !Array.isArray(c.overview.members))) return null;
    return c;
  } catch {
    return null;
  }
}

/** Errores de red (supabase-js / fetch / callTool), no de permisos ni de datos. */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const code = (e as { code?: unknown }).code;
  if (code === 'network_error') return true;
  const msg = `${(e as { message?: unknown }).message ?? ''} ${(e as { details?: unknown }).details ?? ''}`;
  return /network request failed|failed to fetch|network ?error|timed? ?out|internet|offline|could not connect/i.test(msg);
}

export function minutesSince(ms: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - ms) / 60_000));
}

// ───────────────────────── Frase de Scout

/** Tramos de tiempo libre: la key no cambia con cada minuto que pasa, solo al cruzar un umbral. */
function gapBucket(min: number | null | undefined): number | null {
  if (min == null) return null;
  return min < 30 ? 0 : min < 60 ? 1 : min < 120 ? 2 : 3;
}

function leaveBucket(min: number | null | undefined): string | null {
  if (min == null) return null;
  return min < 0 ? 'late' : min <= 10 ? 'soon' : 'ok';
}

/**
 * Qué es el momento: protagonista, lo actual y lo próximo. Mientras no cambie, la frase anterior de Claude
 * sigue valiendo (no se vuelve a las reglas mientras se pide la nueva).
 */
export function briefIdentity(s: NowBriefSnapshotT | null): string | null {
  if (!s) return null;
  return JSON.stringify([s.hero, s.current?.title ?? null, s.next?.title ?? null]);
}

/**
 * Key del snapshot para now_brief: cambia solo cuando cambia algo que se nota (protagonista, actual, próximo,
 * un umbral de salida o de tiempo libre, lluvia, ideas, grupo). Sin la hora: no se pide una frase nueva cada 5 min.
 */
export function briefKey(s: NowBriefSnapshotT | null): string | null {
  if (!s) return null;
  return JSON.stringify([
    s.hero,
    s.current?.title ?? null,
    s.next?.title ?? null,
    leaveBucket(s.leave_in_min),
    s.walk_min == null ? null : Math.round(s.walk_min / 10),
    gapBucket(s.gap_min),
    s.weather?.rain_soon ?? null,
    (s.suggestions ?? []).map((x) => x.title),
    (s.group ?? []).map((g) => g.name),
  ]);
}

// ───────────────────────── Sugerencias del hueco

/** Hora del hueco: ahora redondeado para arriba a 5 min ("15:07" → "15:10"). */
export function gapStartTime(localTime: string): string {
  const m = hhmmToMin(localTime) ?? 0;
  return clock(Math.min(23 * 60 + 55, Math.ceil(m / 5) * 5));
}

export type GapAction =
  | { kind: 'move'; blockId: string; dayId: string; startTime: string; title: string }
  | { kind: 'add'; input: ToolInput<'add_block'> };

/** Idea del banco → move_block al día/hora del hueco. Lugar/evento → add_block personal con la hora del hueco. */
export function gapAction(
  item: GapSuggestion,
  ctx: { tripId: string; legId: string; dayId: string; me: string; localTime: string; minutes: number },
): GapAction {
  const start = gapStartTime(ctx.localTime);
  if (item.source === 'idea' && item.block_id) {
    return { kind: 'move', blockId: item.block_id, dayId: ctx.dayId, startTime: start, title: item.title };
  }
  const startTime = item.source === 'event' && item.start_time && /^\d{1,2}:\d{2}/.test(item.start_time) ? item.start_time.slice(0, 5) : start;
  return {
    kind: 'add',
    input: {
      trip_id: ctx.tripId,
      leg_id: ctx.legId,
      day_id: ctx.dayId,
      type: 'activity',
      title: item.title,
      ...(item.place_name ? { place_name: item.place_name } : {}),
      ...(item.lat != null && item.lng != null ? { lat: item.lat, lng: item.lng } : {}),
      ...(item.google_place_id ? { google_place_id: item.google_place_id } : {}),
      ...(item.url && /^https?:\/\//.test(item.url) ? { booking_url: item.url } : {}),
      start_time: startTime,
      duration_min: Math.max(15, Math.min(90, ctx.minutes)),
      participant_ids: [ctx.me],
      reason: 'Agregado desde Ahora para el rato libre',
    },
  };
}

// ───────────────────────── Vista previa del tour

export type TourPreview = {
  stopsCount: number;
  durationMin: number | null;
  distanceKm: number | null;
  stopNames: string[];
  stops: LatLng[];
};

export type TourPreviewRow = {
  duration_min: number | null;
  route: { total_walk_m?: number | null; est_duration_min?: number | null } | null;
  tour_stops: { sort_order: number | null; place_library: { name: string | null; lat: number | null; lng: number | null } | null }[];
};

export function summarizeTour(row: TourPreviewRow): TourPreview {
  const sorted = [...(row.tour_stops ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const stops = sorted
    .filter((s) => s.place_library?.lat != null && s.place_library?.lng != null)
    .map((s) => ({ lat: s.place_library!.lat!, lng: s.place_library!.lng! }));
  let walkM = row.route?.total_walk_m ?? null;
  if (walkM == null && stops.length >= 2) {
    // Sin ruta calculada: línea recta entre paradas × 1,3 (calles).
    walkM = stops.slice(1).reduce((acc, p, i) => acc + distanceM(stops[i], p), 0) * 1.3;
  }
  return {
    stopsCount: sorted.length,
    durationMin: row.route?.est_duration_min ?? row.duration_min ?? null,
    distanceKm: walkM == null ? null : Math.round(walkM / 100) / 10,
    stopNames: sorted.map((s) => s.place_library?.name ?? 'Parada'),
    stops,
  };
}
