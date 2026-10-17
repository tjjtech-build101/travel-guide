// "Cómo llego" embebido (docs/AHORA-V2.md): lógica pura de la pantalla de ruta. Sin React ni red: se testea con tsx.
// - route_eta con `detail: true` → RouteDetail; si la API todavía no lo devuelve, lo armamos con lo de siempre.
// - Textos de la próxima indicación, encabezado ("Llegás 15:52"), línea de tiempo del transporte y links a otras apps.
import {
  leaveInMin,
  type RouteDetail,
  type RouteMode,
  type RouteStepDetail,
} from '@build101/shared';

type LatLng = { lat: number; lng: number };

/** A pie hasta… (min); más que esto, el default es transporte (igual que useEta). */
export const WALK_DEFAULT_MAX_MIN = 25;

export const MODE_LABEL: Record<RouteMode, string> = { walk: 'A pie', transit: 'Transporte', car: 'Auto' };
export const ROUTE_MODE_ORDER: RouteMode[] = ['walk', 'transit', 'car'];

/** Modo inicial: a pie si son ≤ 25 min (o todavía no sabemos), si no transporte. */
export function defaultMode(walkMin: number | null | undefined): RouteMode {
  if (walkMin == null) return 'walk';
  return walkMin <= WALK_DEFAULT_MAX_MIN ? 'walk' : 'transit';
}

// ───────── Respuesta de route_eta → RouteDetail

type RouteEtaData = {
  segments?: { duration_min: number; distance_m: number; polyline: string | null }[];
  total_min?: number;
  estimated?: boolean;
  transit?: {
    duration_min: number;
    walk_before_min?: number;
    walk_after_min?: number;
    lines: (Omit<NonNullable<RouteStepDetail['transit']>, 'line'> & { name: string })[];
  };
  detail?: RouteDetail;
};

/**
 * RouteDetail desde lo que devuelva route_eta. Con `detail` lo usa tal cual; si no (API vieja o sin key), arma uno con
 * la polilínea del segmento y, en transporte, las líneas (pasos sin coordenadas finas: alcanzan para la línea de tiempo).
 */
export function toRouteDetail(data: RouteEtaData, mode: RouteMode, from: LatLng, to: LatLng): RouteDetail {
  if (data.detail && Array.isArray(data.detail.steps)) return data.detail;
  const seg = data.segments?.[0];
  const polyline = seg?.polyline ?? null;
  const steps: RouteStepDetail[] = [];
  const t = mode === 'transit' ? data.transit : undefined;
  if (t?.lines?.length) {
    const walk = (min: number | undefined, a: LatLng, b: LatLng, to_name?: string): void => {
      if (!min) return;
      steps.push({ instruction: to_name ? `Caminá hasta ${to_name}` : 'Caminá', maneuver: null, distance_m: 0, duration_min: min, start: a, end: b });
    };
    walk(t.walk_before_min, from, from, t.lines[0].from_stop);
    for (const l of t.lines) {
      steps.push({
        instruction: `${l.name}${l.headsign ? ` hacia ${l.headsign}` : ''}`,
        maneuver: null,
        distance_m: 0,
        duration_min: 0,
        start: from,
        end: to,
        transit: {
          line: l.name,
          vehicle: l.vehicle,
          from_stop: l.from_stop,
          to_stop: l.to_stop,
          departure: l.departure,
          arrival: l.arrival,
          headsign: l.headsign,
          stops: l.stops,
        },
      });
    }
    walk(t.walk_after_min, to, to);
  }
  return {
    mode,
    duration_min: t?.duration_min ?? seg?.duration_min ?? data.total_min ?? 0,
    distance_m: seg?.distance_m ?? 0,
    polyline,
    steps,
    estimated: !!data.estimated || !polyline,
  };
}

// ───────── Formatos

/** "80 m", "900 m", "1,2 km", "12 km". */
export function formatDistance(m: number): string {
  const v = Math.max(0, m);
  if (v < 1000) return `${Math.round(v / 10) * 10} m`;
  const km = v / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}

/** "45 min", "1 h", "1 h 10". */
export function formatMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** Minutos desde 00:00 → "15:52". */
export function clockText(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export type Headline = {
  /** "Llegás 15:52" (salís ya) o "Salí en 19 min" (todavía hay que esperar). */
  title: string;
  /** "12 min · 900 m", o "6 min · 450 m · llegás 15:55" cuando el título es "Salí en". */
  sub: string;
  /** Chip junto a "Llegás": "Salí ya" / "Vas 5 min tarde" (solo si el destino es un bloque de hoy con hora). */
  leave: { text: string; tone: 'soon' | 'late' } | null;
};

/**
 * Encabezado. `nowMin` = minutos locales del viaje; `startMin` = inicio del bloque (si es de hoy). La cuenta de "Salí en"
 * es la misma de Ahora (inicio − ETA − 5 min − ahora). Si todavía falta para salir, el título es "Salí en X" y la llegada
 * va abajo calculada desde esa salida: nunca "Llegás 15:36" (saliendo ya) al lado de "Salí en 19 min".
 */
export function headline({ nowMin, etaMin, distanceM, startMin }: { nowMin: number; etaMin: number; distanceM: number; startMin?: number | null }): Headline {
  const sub = distanceM > 0 ? `${formatMin(etaMin)} · ${formatDistance(distanceM)}` : formatMin(etaMin);
  const leaveIn = startMin == null ? null : Math.round(leaveInMin(startMin, nowMin, etaMin));
  if (leaveIn != null && leaveIn > 0) {
    return { title: `Salí en ${formatMin(leaveIn)}`, sub: `${sub} · llegás ${clockText(nowMin + leaveIn + etaMin)}`, leave: null };
  }
  return {
    title: `Llegás ${clockText(nowMin + etaMin)}`,
    sub,
    leave: leaveIn == null ? null : leaveIn < 0 ? { text: `Vas ${formatMin(-leaveIn)} tarde`, tone: 'late' } : { text: 'Salí ya', tone: 'soon' },
  };
}

// ───────── Indicaciones

/** Imperativos de Google (tú / usted) → voseo. Idempotente ("Doblá" no se toca). */
const VOSEO: [string[], string, string?][] = [
  [['Gira', 'Gire', 'Dobla', 'Doble'], 'Doblá'],
  [['Dirígete', 'Diríjase', 'Dirigite'], 'Andá'],
  [['Continúa', 'Continúe', 'Sigue', 'Siga'], 'Seguí'],
  [['Toma', 'Tome'], 'Tomá'],
  [['Mantente', 'Manténgase'], 'Mantenete'],
  [['Camina', 'Camine'], 'Caminá'],
  [['Cruza', 'Cruce'], 'Cruzá'],
  [['Sal', 'Salga'], 'Salí', ' (de|por|en|hacia|a)\\b'],
  [['Entra', 'Entre'], 'Entrá', ' (en|a|al|por)\\b'],
  [['Incorpórate', 'Incorpórese'], 'Incorporate'],
  [['Pasa', 'Pase'], 'Pasá', ' (por|junto)\\b'],
  [['Da la vuelta', 'Dé la vuelta'], 'Pegá la vuelta'],
];

// Sin \p{L} ni lookbehind (Hermes): letras explícitas y el carácter previo capturado.
const L = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
const VOSEO_RE: [RegExp, string][] = VOSEO.flatMap(([from, to, after]) => {
  const tail = `(?![${L}])${after ? `(?=${after})` : ''}`;
  const lower = (w: string) => w[0].toLowerCase() + w.slice(1);
  const re = (ws: string[]) => new RegExp(`(^|[^${L}])(?:${ws.join('|')})${tail}`, 'g');
  return [
    [re(from), `$1${to}`],
    [re(from.map(lower)), `$1${lower(to)}`],
  ] as [RegExp, string][];
});

export function voseo(text: string): string {
  return VOSEO_RE.reduce((s, [re, to]) => s.replace(re, to), text.trim());
}

function lcFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export type ManeuverKind = 'left' | 'right' | 'slightLeft' | 'slightRight' | 'uturn' | 'straight' | 'roundabout' | 'arrive';

/** Maniobra de Google → ícono. */
export function maneuverKind(maneuver: string | null | undefined, instruction = ''): ManeuverKind {
  const m = (maneuver ?? '').toUpperCase();
  if (m.includes('ROUNDABOUT')) return 'roundabout';
  if (m.startsWith('UTURN') || m.startsWith('U_TURN')) return 'uturn';
  if (m.includes('SLIGHT_LEFT') || m === 'FORK_LEFT' || m === 'RAMP_LEFT') return 'slightLeft';
  if (m.includes('SLIGHT_RIGHT') || m === 'FORK_RIGHT' || m === 'RAMP_RIGHT') return 'slightRight';
  if (m.includes('LEFT')) return 'left';
  if (m.includes('RIGHT')) return 'right';
  if (m) return 'straight';
  // Sin maniobra: miramos el texto.
  const t = instruction.toLowerCase();
  if (/rotonda/.test(t)) return 'roundabout';
  if (/izquierda/.test(t)) return /ligeramente|levemente/.test(t) ? 'slightLeft' : 'left';
  if (/derecha/.test(t)) return /ligeramente|levemente/.test(t) ? 'slightRight' : 'right';
  return 'straight';
}

/** "a Plaza Matriz" / "al Cabildo" (a + el = al). */
export function toPlace(name: string): string {
  const m = name.match(/^el\s+(.*)$/i);
  return m ? `al ${m[1]}` : `a ${name}`;
}

export type NextInstruction = { text: string; kind: ManeuverKind; distanceM: number };

/**
 * Próxima indicación. Google describe en cada paso la maniobra con la que EMPIEZA: mientras recorrés el paso `i`, lo que
 * viene es la maniobra del paso `i + 1`, a `distanceToStepEndM`. En el último paso: llegar.
 */
export function nextInstruction({
  steps,
  stepIndex,
  distanceToStepEndM,
  destName,
}: {
  steps: Pick<RouteStepDetail, 'instruction' | 'maneuver'>[];
  stepIndex: number;
  distanceToStepEndM: number;
  destName: string;
}): NextInstruction {
  const d = Math.max(0, Math.round(distanceToStepEndM));
  const when = d <= 15 ? 'Ahora' : `En ${formatDistance(d)}`;
  if (stepIndex < 0 || !steps.length) {
    return { text: d <= 15 ? `Llegás ${toPlace(destName)}` : `Seguí hacia ${destName}: faltan ${formatDistance(d)}`, kind: d <= 15 ? 'arrive' : 'straight', distanceM: d };
  }
  const next = steps[stepIndex + 1];
  if (!next) return { text: `${when}, llegás ${toPlace(destName)}`, kind: 'arrive', distanceM: d };
  const instr = voseo(next.instruction || 'Seguí derecho');
  return { text: `${when}, ${lcFirst(instr)}`, kind: maneuverKind(next.maneuver, instr), distanceM: d };
}

// ───────── Transporte: línea de tiempo

export type TimelineItem =
  | { kind: 'walk'; min: number; m: number; to?: string }
  | {
      kind: 'ride';
      line: string;
      vehicle: NonNullable<RouteStepDetail['transit']>['vehicle'];
      from_stop?: string;
      to_stop?: string;
      departure?: string;
      arrival?: string;
      headsign?: string;
      stops?: number;
      min: number;
    };

/** Pasos → "caminar → Bus 121 → caminar" (las caminatas seguidas se juntan). */
export function transitTimeline(steps: RouteStepDetail[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const s of steps) {
    if (s.transit) {
      out.push({ kind: 'ride', ...s.transit, min: s.duration_min });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'walk') {
      last.min += s.duration_min;
      last.m += s.distance_m;
    } else out.push({ kind: 'walk', min: s.duration_min, m: s.distance_m });
  }
  // A dónde camina cada tramo: la parada del próximo vehículo (si hay).
  out.forEach((it, i) => {
    const nx = out[i + 1];
    if (it.kind === 'walk' && nx?.kind === 'ride' && nx.from_stop) it.to = nx.from_stop;
  });
  return out.filter((it) => it.kind === 'ride' || it.min > 0 || it.m > 0);
}

/** true si hay al menos un vehículo con horario de Google. */
export function hasTransitTimes(steps: RouteStepDetail[]): boolean {
  return steps.some((s) => !!s.transit?.departure);
}

export const VEHICLE_LABEL: Record<NonNullable<RouteStepDetail['transit']>['vehicle'], string> = {
  bus: 'Bus',
  subway: 'Subte',
  train: 'Tren',
  tram: 'Tranvía',
  ferry: 'Ferry',
  other: 'Línea',
};

/** "Bus 121" (sin repetir si el nombre ya trae el tipo). */
export function rideTitle(it: Extract<TimelineItem, { kind: 'ride' }>): string {
  const label = VEHICLE_LABEL[it.vehicle];
  return new RegExp(`^${label}\\b`, 'i').test(it.line) ? it.line : `${label} ${it.line}`;
}

/** "Sale 18:05 desde Ciudadela · 6 paradas · dirección Pocitos". */
export function rideDetail(it: Extract<TimelineItem, { kind: 'ride' }>): string {
  const parts: string[] = [];
  if (it.departure) parts.push(`Sale ${it.departure}${it.from_stop ? ` desde ${it.from_stop}` : ''}`);
  else if (it.from_stop) parts.push(`Desde ${it.from_stop}`);
  if (it.stops) parts.push(`${it.stops} ${it.stops === 1 ? 'parada' : 'paradas'}`);
  if (it.headsign) parts.push(`dirección ${it.headsign}`);
  return parts.join(' · ');
}

// ───────── Abrir en otra app (CarPlay)

export type ExternalApp = 'apple' | 'google' | 'waze';
export const EXTERNAL_LABEL: Record<ExternalApp, string> = { apple: 'Apple Maps', google: 'Google Maps', waze: 'Waze' };

/** Esquema de la app y fallback web. Waze siempre es manejo. */
export function externalUrls(app: ExternalApp, mode: RouteMode, dest: LatLng): { scheme: string; web: string } {
  const ll = `${dest.lat},${dest.lng}`;
  if (app === 'apple') {
    const flg = mode === 'walk' ? 'w' : mode === 'transit' ? 'r' : 'd';
    return { scheme: `maps://?daddr=${ll}&dirflg=${flg}`, web: `https://maps.apple.com/?daddr=${ll}&dirflg=${flg}` };
  }
  if (app === 'google') {
    const gm = mode === 'walk' ? 'walking' : mode === 'transit' ? 'transit' : 'driving';
    return {
      scheme: `comgooglemaps://?daddr=${ll}&directionsmode=${gm}`,
      web: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=${gm}`,
    };
  }
  return { scheme: `waze://?ll=${ll}&navigate=yes`, web: `https://waze.com/ul?ll=${ll}&navigate=yes` };
}

/** Apps para la fila "Abrir en" (Apple Maps solo en iOS; Waze solo en auto, porque siempre arma ruta en auto). */
export function externalApps(platform: string, mode: RouteMode): ExternalApp[] {
  const apps: ExternalApp[] = platform === 'ios' ? ['apple', 'google'] : ['google'];
  return mode === 'car' ? [...apps, 'waze'] : apps;
}

/**
 * Lo que conviene que el lector de pantalla anuncie de una indicación: cambia al pasar de paso o al llegar a la
 * maniobra ("En 230 m, …" → "Ahora, …"), no con cada metro.
 */
export function announceKey(next: NextInstruction): string {
  return `${next.distanceM <= 15 ? 'now' : 'soon'}|${next.kind}|${next.text.replace(/^En [^,]+, /, '')}`;
}

// ───────── De dónde se abre y a dónde ir

/** Tab visible del viaje desde la que se abrió la ruta: "Volver" vuelve ahí (la ruta es una tab oculta). */
export type RouteOrigin = 'index' | 'map' | 'now';
const ORIGINS: readonly string[] = ['index', 'map', 'now'];

/** Valida el param `from` (o el nombre de una tab). Sin dato o raro (deep link, la propia ruta) → Ahora. */
export function routeOrigin(v: unknown): RouteOrigin {
  return typeof v === 'string' && ORIGINS.includes(v) ? (v as RouteOrigin) : 'now';
}

/** Pathname de expo-router de la tab de origen. */
export function originPath(o: RouteOrigin): '/trip/[tripId]' | '/trip/[tripId]/map' | '/trip/[tripId]/now' {
  return o === 'index' ? '/trip/[tripId]' : o === 'map' ? '/trip/[tripId]/map' : '/trip/[tripId]/now';
}

export type PlaceTarget = { lat: number; lng: number; name: string };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Sugerencia de Ahora (hueco libre) → destino de la ruta; sin coordenadas, null (la fila no abre nada). */
export function suggestionTarget(s: { title: string; place_name?: string | null; lat: number | null; lng: number | null }): PlaceTarget | null {
  if (!finite(s.lat) || !finite(s.lng)) return null;
  return { lat: s.lat, lng: s.lng, name: s.place_name || s.title };
}

/** Pin del Mapa → destino. Bloques y paradas de tour sí; un tramo (una ciudad entera) no es "a dónde ir". */
export function mapPointTarget(p: {
  kind: 'leg' | 'block' | 'stop';
  label: string;
  place?: string | null;
  lat: number;
  lng: number;
  blockId?: string;
}): (PlaceTarget & { block_id?: string }) | null {
  if (p.kind === 'leg' || !finite(p.lat) || !finite(p.lng)) return null;
  return {
    lat: p.lat,
    lng: p.lng,
    name: (p.kind === 'block' && p.place) || p.label,
    ...(p.kind === 'block' && p.blockId ? { block_id: p.blockId } : {}),
  };
}
