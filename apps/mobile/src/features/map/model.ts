// Modelo del Mapa (PRD 03, 2D): qué puntos y líneas dibujar según el alcance (viaje entero o un día),
// y qué `focus` se le pasa al Scout al tocar un elemento. Puro (sin React ni Mapbox) para testearlo.
import type { DayRow } from '@build101/shared';

import type { ScoutFocus } from '../../voice/useScout';
import { collapseChoices } from '../plan/choices';
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
  /** Bloques: descripción del plan (el gancho del ▶ "Ver el día"). */
  description?: string | null;
};

export type MapLine = { id: string; color: string; coords: LngLat[]; dashed: boolean };

export type MapScope = { kind: 'trip' } | { kind: 'day'; dayId: string };

export type MapTour = { id: string; title: string; thesis?: string | null; stops: { id: string; name: string; lat: number; lng: number; google_place_id: string | null }[] };

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
  // Un lugar "elegí 1 de N" pendiente es un solo pin: la opción recomendada (PRD 31).
  const dayBlocks = collapseChoices(
    blocks.filter((b) => b.day_id === scope.dayId && (!b.plan_variant || b.plan_variant === 'main')),
  ).sort(compareBlocks);
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
    description: b.description,
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

/**
 * GeoJSON de los puntos para ShapeSource. Props: id, kind, color, order (número a dibujar), status y label.
 * Las paradas de tour van sin número en el mapa (si no, chocan con los números de los bloques del día);
 * terminados en gris; `label` solo para el elegido y ahora/próximo (el resto, limpio).
 */
export function pointsGeoJSON(points: MapPoint[], status: Map<string, PointStatus> = new Map(), selectedId: string | null = null) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => {
      const st = status.get(p.id) ?? '';
      const showLabel = p.id === selectedId || st === 'now' || st === 'next';
      return {
        type: 'Feature' as const,
        id: p.id,
        properties: {
          id: p.id,
          kind: p.kind,
          color: st === 'done' ? DONE_COLOR : p.color,
          order: p.kind === 'stop' || p.order == null ? '' : String(p.order),
          status: st,
          label: showLabel ? shortTitle(p.label) : '',
        },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      };
    }),
  };
}

/** Pines ya hechos: caqui apagado, como en la lista. */
export const DONE_COLOR = '#B9A88A';

function shortTitle(s: string, max = 26): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// ── Chips del selector ──────────────────────────────────────────────────────────────────────────

/** "Dom 18/10" → "Dom 18" (la ciudad va como separador entre chips, no en cada uno). */
export function chipDay(date: string): string {
  return shortDay(date).replace(/\/\d+$/, '');
}

/** Ciudad a mostrar antes de cada chip: solo cuando cambia respecto del anterior. */
export function citySeparators(options: DayOption[], legCity: (legId: string) => string): (string | null)[] {
  let prev: string | null = null;
  return options.map((o) => {
    const city = legCity(o.legId);
    const out = city !== prev ? city : null;
    prev = city;
    return out;
  });
}

// ── Distancias (aproximadas, sin route_eta) ─────────────────────────────────────────────────────

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minutos a pie: línea recta × 1,3 (las calles no son rectas) a 80 m/min. Null si es lejísimos (> 60 min). */
export function walkMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number | null {
  const min = Math.max(1, Math.round((distanceM(a, b) * 1.3) / 80));
  return min > 60 ? null : min;
}

export function formatKm(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

// ── ▶ "Ver el día con el Scout" ─────────────────────────────────────────────────────────────────

export type PreviewStep =
  | { kind: 'intro'; title: string; body: string }
  | { kind: 'stop'; point: MapPoint; title: string; body: string }
  | { kind: 'outro'; title: string; body: string };

/** Primera oración (o un recorte prolijo) de un texto: un gancho, no un párrafo. */
export function hookOf(text: string | null | undefined, max = 140): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const first = t.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? t;
  return first.length <= max ? first : `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * Guion del recorrido animado del día: intro (la tesis del tour si hay, si no el resumen), una escena por
 * bloque con ubicación (hora + título + un gancho) y el cierre ("¿Arrancamos?").
 */
export function previewSteps(points: MapPoint[], tours: MapTour[], dayLabel: string): PreviewStep[] {
  const blocks = points.filter((p) => p.kind === 'block');
  if (!blocks.length) return [];
  let total = 0;
  for (let i = 1; i < blocks.length; i++) total += distanceM(blocks[i - 1], blocks[i]) * 1.3;
  const thesisTour = tours.find((t) => t.thesis && blocks.some((b) => b.tourId === t.id));
  const summary = `${blocks.length} ${blocks.length === 1 ? 'lugar' : 'lugares'}${blocks.length > 1 ? ` · ~${formatKm(total)} de recorrido` : ''}`;
  const steps: PreviewStep[] = [
    {
      kind: 'intro',
      title: dayLabel,
      body: thesisTour ? `${thesisTour.thesis!.replace(/\.$/, '')}. ${summary}.` : `Te muestro el día: ${summary}.`,
    },
  ];
  for (const p of blocks) {
    const tour = p.tourId ? tours.find((t) => t.id === p.tourId) : undefined;
    const hook =
      hookOf(p.description) ??
      (tour ? `${tour.stops.length} paradas${tour.thesis ? `: ${hookOf(tour.thesis)}` : ''}` : null) ??
      [p.typeLabel, p.place && !sameish(p.place, p.label) ? p.place : null].filter(Boolean).join(' · ');
    steps.push({ kind: 'stop', point: p, title: [p.start, p.label].filter(Boolean).join(' · '), body: hook });
  }
  steps.push({ kind: 'outro', title: '¿Arrancamos?', body: 'Si querés cambiar algo, decímelo y lo acomodo.' });
  return steps;
}

/** ¿El lugar ya está dicho en el título? ("Visita guiada al Teatro Solís" / "Teatro Solís"). */
export function sameish(place: string, title: string): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return n(title).includes(n(place));
}

/** Rumbo (grados) de a → b, para que la cámara mire hacia donde va el Scout. */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
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
