// Modelo del Mapa (PRD 03, 2D): qué puntos y líneas dibujar según el alcance (viaje entero o un día),
// y qué `focus` se le pasa al Scout al tocar un elemento. Puro (sin React ni Mapbox) para testearlo.
import type { DayRow } from '@build101/shared';

import type { ScoutFocus } from '../../voice/useScout';
import { LEG_COLORS, legColorMap, TYPE_LABEL } from '../plan/labels';
import { compareBlocks, hhmm, shortDay, type PlanBlock, type PlanLeg } from '../plan/selectors';

export type LngLat = [number, number];

export type MapPoint = {
  /** Único en el mapa: `leg:<id>`, `block:<id>`, `stop:<tourId>:<stopId>`. */
  id: string;
  kind: 'leg' | 'block' | 'stop';
  label: string;
  sublabel: string | null;
  lat: number;
  lng: number;
  color: string;
  /** Número a dibujar (orden en el día o en el tour); null = sin número. */
  order: number | null;
  blockId?: string;
  legId?: string;
  tourId?: string;
  googlePlaceId?: string | null;
  /** Bloques: hora de inicio/fin ('HH:MM' o null), lugar y tipo legible (para la lista tipo sendero). */
  start?: string | null;
  end?: string | null;
  place?: string | null;
  typeLabel?: string | null;
};

export type MapLine = { id: string; color: string; coords: LngLat[]; dashed: boolean };

export type MapScope = { kind: 'trip' } | { kind: 'day'; dayId: string };

export type MapTour = { id: string; title: string; stops: { id: string; name: string; lat: number; lng: number; google_place_id: string | null }[] };

export type MapModel = {
  points: MapPoint[];
  lines: MapLine[];
  /** Bloques del día sin coordenadas (chip "N sin ubicación"). */
  unlocated: PlanBlock[];
  bounds: { ne: LngLat; sw: LngLat } | null;
};

export type DayOption = { dayId: string; legId: string; date: string; label: string; color: string };

// Paradas de tour: rojo del pañuelo (los tours los arma el Scout).
const STOP_COLOR = '#D33B2D';

function sortLegs(legs: PlanLeg[]): PlanLeg[] {
  return [...legs].sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );
}

/** Días del viaje en orden ("Dom 18/10 · Montevideo"), uno por tramo (los paralelos aparecen dos veces). */
export function dayOptions(legs: PlanLeg[]): DayOption[] {
  const colors = legColorMap(legs);
  const out: DayOption[] = [];
  for (const leg of sortLegs(legs)) {
    for (const d of [...leg.days].sort((a: DayRow, b: DayRow) => a.date.localeCompare(b.date))) {
      out.push({ dayId: d.id, legId: leg.id, date: d.date, label: `${shortDay(d.date)} · ${leg.city}`, color: colors.get(leg.id) ?? LEG_COLORS[0] });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Día por defecto: el de hoy si el viaje está en curso; si no, el primero que viene (o el primero del viaje). */
export function defaultDayId(options: DayOption[], todayDate: string, todayDayId?: string | null): string | null {
  if (todayDayId && options.some((o) => o.dayId === todayDayId)) return todayDayId;
  const upcoming = options.find((o) => o.date >= todayDate);
  return upcoming?.dayId ?? options[0]?.dayId ?? null;
}

function hasCoords<T extends { lat: number | null; lng: number | null }>(x: T): x is T & { lat: number; lng: number } {
  return x.lat != null && x.lng != null && Number.isFinite(x.lat) && Number.isFinite(x.lng);
}

export function boundsOf(points: { lat: number; lng: number }[]): MapModel['bounds'] {
  if (!points.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { ne: [maxLng, maxLat], sw: [minLng, minLat] };
}

/** Siguiente(s) tramo(s) de cada tramo: los que arrancan en la primera fecha posterior (ramas paralelas incluidas). */
function legEdges(legs: PlanLeg[]): [PlanLeg, PlanLeg][] {
  const sorted = sortLegs(legs);
  const edges: [PlanLeg, PlanLeg][] = [];
  for (const a of sorted) {
    const later = sorted.filter((b) => b.start_date > a.start_date);
    if (!later.length) continue;
    const nextDate = later[0].start_date;
    const nexts = later.filter((b) => b.start_date === nextDate);
    // Con tramos paralelos, cada rama sigue al tramo que comparte miembros (si se puede saber).
    const sharing = nexts.filter((b) => b.member_ids.some((m) => a.member_ids.includes(m)));
    for (const b of sharing.length ? sharing : nexts) edges.push([a, b]);
  }
  return edges;
}

export function buildMapModel({
  legs,
  blocks,
  tours,
  scope,
}: {
  legs: PlanLeg[];
  blocks: PlanBlock[];
  tours: MapTour[];
  scope: MapScope;
}): MapModel {
  const colors = legColorMap(legs);

  if (scope.kind === 'trip') {
    const located = sortLegs(legs).filter(hasCoords);
    const points: MapPoint[] = located.map((l, i) => ({
      id: `leg:${l.id}`,
      kind: 'leg',
      label: l.city,
      sublabel: `${shortDay(l.start_date)} → ${shortDay(l.end_date)}`,
      lat: l.lat,
      lng: l.lng,
      color: colors.get(l.id) ?? LEG_COLORS[0],
      order: i + 1,
      legId: l.id,
      googlePlaceId: l.google_place_id,
    }));
    const lines: MapLine[] = legEdges(located).map(([a, b]) => ({
      id: `leg:${a.id}->${b.id}`,
      color: colors.get(b.id) ?? LEG_COLORS[0],
      coords: [
        [a.lng!, a.lat!],
        [b.lng!, b.lat!],
      ],
      dashed: false,
    }));
    return { points, lines, unlocated: [], bounds: boundsOf(points) };
  }

  const leg = legs.find((l) => l.days.some((d) => d.id === scope.dayId));
  const color = (leg && colors.get(leg.id)) ?? LEG_COLORS[0];
  const dayBlocks = blocks
    .filter((b) => b.day_id === scope.dayId && (!b.plan_variant || b.plan_variant === 'main'))
    .sort(compareBlocks);
  const visible = dayBlocks.filter((b) => !b.masked);
  const located = visible.filter(hasCoords);
  const unlocated = visible.filter((b) => !hasCoords(b));

  const points: MapPoint[] = located.map((b, i) => ({
    id: `block:${b.id}`,
    kind: 'block',
    label: b.title ?? 'Sin título',
    sublabel: [hhmm(b.start_time) || null, b.place_name].filter(Boolean).join(' · ') || null,
    lat: b.lat,
    lng: b.lng,
    color,
    order: i + 1,
    blockId: b.id,
    legId: b.leg_id ?? undefined,
    tourId: b.tour_id ?? undefined,
    googlePlaceId: b.google_place_id,
    start: hhmm(b.start_time) || null,
    end: hhmm(b.end_time) || null,
    place: b.place_name,
    typeLabel: TYPE_LABEL[b.type] ?? null,
  }));
  const lines: MapLine[] =
    located.length > 1
      ? [{ id: `day:${scope.dayId}`, color, coords: located.map((b) => [b.lng, b.lat] as LngLat), dashed: true }]
      : [];

  // Paradas de los tours del día (bloques `tour` con tour_id).
  const tourIds = new Set(visible.map((b) => b.tour_id).filter((x): x is string => !!x));
  for (const tour of tours.filter((t) => tourIds.has(t.id))) {
    const stops = tour.stops.filter(hasCoords);
    stops.forEach((s, i) =>
      points.push({
        id: `stop:${tour.id}:${s.id}`,
        kind: 'stop',
        label: s.name,
        sublabel: `Parada ${i + 1} del tour "${tour.title}"`,
        lat: s.lat,
        lng: s.lng,
        color: STOP_COLOR,
        order: i + 1,
        tourId: tour.id,
        googlePlaceId: s.google_place_id,
      }),
    );
    if (stops.length > 1) {
      lines.push({ id: `tour:${tour.id}`, color: STOP_COLOR, coords: stops.map((s) => [s.lng, s.lat] as LngLat), dashed: false });
    }
  }

  return { points, lines, unlocated, bounds: boundsOf(points) };
}

export type PointStatus = 'done' | 'now' | 'next';

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Estado de cada bloque del día de hoy según la hora (`nowMin`, minutos desde las 00:00):
 * terminado, en curso ("Ahora") o el próximo que arranca ("Próximo"). Sin hora: sin estado.
 * Sin fin, un bloque dura hasta que empieza el siguiente.
 */
export function timelineStatus(points: MapPoint[], nowMin: number): Map<string, PointStatus> {
  const out = new Map<string, PointStatus>();
  const timed = points.filter((p) => p.kind === 'block' && p.start);
  let nextSet = false;
  timed.forEach((p, i) => {
    const start = toMin(p.start!);
    const following = timed[i + 1]?.start;
    const end = p.end ? toMin(p.end) : following ? toMin(following) : start + 60;
    if (end <= nowMin) out.set(p.id, 'done');
    else if (start <= nowMin) out.set(p.id, 'now');
    else if (!nextSet) {
      out.set(p.id, 'next');
      nextSet = true;
    }
  });
  return out;
}

/** `focus` de POST /voice/session (Contratos v1.1) para un elemento del mapa. */
export function focusForPoint(p: MapPoint): ScoutFocus {
  const focus: ScoutFocus = { lat: p.lat, lng: p.lng, label: p.kind === 'stop' && p.sublabel ? `${p.label} (${p.sublabel})` : p.label };
  if (p.kind === 'block' && p.blockId) focus.block_id = p.blockId;
  if (p.googlePlaceId) focus.google_place_id = p.googlePlaceId;
  return focus;
}

/** `focus` para un punto cualquiera del mapa (mantener apretado). */
export function focusForCoordinate(lat: number, lng: number): ScoutFocus {
  return { lat, lng, label: 'Este punto del mapa' };
}

/** GeoJSON de los puntos (props: id, kind, color, order, label) para ShapeSource. */
export function pointsGeoJSON(points: MapPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({
      type: 'Feature' as const,
      id: p.id,
      properties: { id: p.id, kind: p.kind, color: p.color, order: p.order == null ? '' : String(p.order), label: p.label },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  };
}

export function linesGeoJSON(lines: MapLine[]) {
  return {
    type: 'FeatureCollection' as const,
    features: lines.map((l) => ({
      type: 'Feature' as const,
      id: l.id,
      properties: { id: l.id, color: l.color, dashed: l.dashed ? 1 : 0 },
      geometry: { type: 'LineString' as const, coordinates: l.coords },
    })),
  };
}
