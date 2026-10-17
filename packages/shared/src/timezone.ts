// Zona horaria del tramo (Ahora v2, docs/AHORA-V2.md): IANA por país (nombre en español/inglés o ISO-2) y, para
// países con varias zonas, bandas simples de longitud/latitud. zonedParts/zonedUtc con Intl (Hermes lo soporta).
// Tests: timezone.test.ts (vitest).

type Coords = { lat: number | null; lng: number | null };
type Resolver = string | ((c: Coords) => string);

// ───────────────────────── Países con varias zonas (sin coordenadas: la zona de la capital / la más turística)

const us = ({ lat, lng }: Coords): string => {
  if (lat == null || lng == null) return 'America/New_York';
  if (lat < 23 && lng < -150) return 'Pacific/Honolulu';
  if (lat > 51 && lng < -129) return 'America/Anchorage';
  if (lng > -87.5) return 'America/New_York';
  if (lng > -101) return 'America/Chicago';
  if (lng > -114.5) return lat < 37 && lng < -109 ? 'America/Phoenix' : 'America/Denver';
  return 'America/Los_Angeles';
};

const ca = ({ lng }: Coords): string => {
  if (lng == null) return 'America/Toronto';
  if (lng > -59.5) return 'America/St_Johns';
  if (lng > -67) return 'America/Halifax';
  if (lng > -90) return 'America/Toronto';
  if (lng > -102) return 'America/Winnipeg';
  if (lng > -120) return 'America/Edmonton';
  return 'America/Vancouver';
};

const mx = ({ lat, lng }: Coords): string => {
  if (lat == null || lng == null) return 'America/Mexico_City';
  if (lng < -114.5 && lat > 28) return 'America/Tijuana';
  if (lng > -89.3 && lat < 22) return 'America/Cancun';
  if (lng < -105.5) return lat > 26 && lng < -109 ? 'America/Hermosillo' : 'America/Mazatlan';
  return 'America/Mexico_City';
};

const br = ({ lat, lng }: Coords): string => {
  if (lat == null || lng == null) return 'America/Sao_Paulo';
  if (lng > -33) return 'America/Noronha';
  if (lng < -67.5) return 'America/Rio_Branco';
  if (lng < -56) return 'America/Manaus';
  if (lng < -53 && lat < -7) return 'America/Cuiaba';
  return 'America/Sao_Paulo';
};

const au = ({ lat, lng }: Coords): string => {
  if (lat == null || lng == null) return 'Australia/Sydney';
  if (lng < 129) return 'Australia/Perth';
  if (lng < 138) return lat > -26 ? 'Australia/Darwin' : 'Australia/Adelaide';
  if (lng < 141 && lat < -26) return 'Australia/Adelaide';
  if (lat > -28.2) return 'Australia/Brisbane';
  if (lat < -39.5) return 'Australia/Hobart';
  if (lat < -36.2 && lng < 150) return 'Australia/Melbourne';
  return 'Australia/Sydney';
};

const ru = ({ lng }: Coords): string => {
  if (lng == null) return 'Europe/Moscow';
  const bands: [number, string][] = [
    [23, 'Europe/Kaliningrad'],
    [48, 'Europe/Moscow'],
    [55, 'Europe/Samara'],
    [66, 'Asia/Yekaterinburg'],
    [75, 'Asia/Omsk'],
    [88, 'Asia/Novosibirsk'],
    [100, 'Asia/Krasnoyarsk'],
    [113, 'Asia/Irkutsk'],
    [130, 'Asia/Yakutsk'],
    [142, 'Asia/Vladivostok'],
    [155, 'Asia/Magadan'],
  ];
  return bands.find(([max]) => lng < max)?.[1] ?? 'Asia/Kamchatka';
};

const id = ({ lng }: Coords): string => {
  if (lng == null) return 'Asia/Jakarta';
  if (lng < 114.6) return 'Asia/Jakarta'; // Java y Sumatra; Bali ya es UTC+8
  if (lng < 127) return 'Asia/Makassar';
  return 'Asia/Jayapura';
};

const cl = ({ lat, lng }: Coords): string => {
  if (lng != null && lng < -100) return 'Pacific/Easter';
  if (lat != null && lat < -48) return 'America/Punta_Arenas';
  return 'America/Santiago';
};

const es = ({ lat, lng }: Coords): string =>
  lat != null && lng != null && lng < -12 && lat < 30 ? 'Atlantic/Canary' : 'Europe/Madrid';

const pt = ({ lng }: Coords): string => {
  if (lng != null && lng < -20) return 'Atlantic/Azores';
  if (lng != null && lng < -15) return 'Atlantic/Madeira';
  return 'Europe/Lisbon';
};

const ec = ({ lng }: Coords): string => (lng != null && lng < -85 ? 'Pacific/Galapagos' : 'America/Guayaquil');

// ───────────────────────── País → zona. Claves normalizadas: minúsculas, sin tildes ni nada que no sea letra.

const ZONES: [Resolver, string[]][] = [
  // Sudamérica
  ['America/Montevideo', ['uruguay', 'uy']],
  ['America/Argentina/Buenos_Aires', ['argentina', 'ar']],
  [cl, ['chile', 'cl']],
  [br, ['brasil', 'brazil', 'br']],
  ['America/Asuncion', ['paraguay', 'py']],
  ['America/La_Paz', ['bolivia', 'bo']],
  ['America/Lima', ['peru', 'pe']],
  [ec, ['ecuador', 'ec']],
  ['America/Bogota', ['colombia', 'co']],
  ['America/Caracas', ['venezuela', 've']],
  // Norte y Centroamérica, Caribe
  [us, ['estadosunidos', 'estadosunidosdeamerica', 'eeuu', 'eua', 'unitedstates', 'unitedstatesofamerica', 'usa', 'us']],
  [ca, ['canada', 'ca']],
  [mx, ['mexico', 'mx']],
  ['America/Havana', ['cuba', 'cu']],
  ['America/Santo_Domingo', ['republicadominicana', 'dominicanrepublic', 'do']],
  ['America/Puerto_Rico', ['puertorico', 'pr']],
  ['America/Costa_Rica', ['costarica', 'cr']],
  ['America/Panama', ['panama', 'pa']],
  ['America/Guatemala', ['guatemala', 'gt']],
  ['America/Belize', ['belice', 'belize', 'bz']],
  ['America/Tegucigalpa', ['honduras', 'hn']],
  ['America/El_Salvador', ['elsalvador', 'sv']],
  ['America/Managua', ['nicaragua', 'ni']],
  ['America/Jamaica', ['jamaica', 'jm']],
  ['America/Nassau', ['bahamas', 'lasbahamas', 'thebahamas', 'bs']],
  ['America/Aruba', ['aruba', 'aw']],
  ['America/Curacao', ['curazao', 'curacao', 'cw']],
  // Europa
  [es, ['espana', 'spain', 'es']],
  [pt, ['portugal', 'pt']],
  ['Europe/Paris', ['francia', 'france', 'fr']],
  ['Europe/Rome', ['italia', 'italy', 'it']],
  ['Europe/Berlin', ['alemania', 'germany', 'deutschland', 'de']],
  ['Europe/London', ['reinounido', 'unitedkingdom', 'uk', 'gb', 'granbretana', 'greatbritain', 'inglaterra', 'england', 'escocia', 'scotland', 'gales', 'wales']],
  ['Europe/Dublin', ['irlanda', 'ireland', 'ie']],
  ['Europe/Amsterdam', ['paisesbajos', 'holanda', 'netherlands', 'holland', 'nl']],
  ['Europe/Brussels', ['belgica', 'belgium', 'be']],
  ['Europe/Luxembourg', ['luxemburgo', 'luxembourg', 'lu']],
  ['Europe/Zurich', ['suiza', 'switzerland', 'ch']],
  ['Europe/Vienna', ['austria', 'at']],
  ['Europe/Monaco', ['monaco', 'mc']],
  ['Europe/Athens', ['grecia', 'greece', 'gr']],
  ['Europe/Istanbul', ['turquia', 'turkey', 'turkiye', 'tr']],
  ['Europe/Zagreb', ['croacia', 'croatia', 'hr']],
  ['Europe/Ljubljana', ['eslovenia', 'slovenia', 'si']],
  ['Europe/Prague', ['republicacheca', 'chequia', 'czechrepublic', 'czechia', 'cz']],
  ['Europe/Budapest', ['hungria', 'hungary', 'hu']],
  ['Europe/Warsaw', ['polonia', 'poland', 'pl']],
  ['Europe/Copenhagen', ['dinamarca', 'denmark', 'dk']],
  ['Europe/Stockholm', ['suecia', 'sweden', 'se']],
  ['Europe/Oslo', ['noruega', 'norway', 'no']],
  ['Europe/Helsinki', ['finlandia', 'finland', 'fi']],
  ['Atlantic/Reykjavik', ['islandia', 'iceland', 'is']],
  ['Europe/Tallinn', ['estonia', 'ee']],
  ['Europe/Riga', ['letonia', 'latvia', 'lv']],
  ['Europe/Vilnius', ['lituania', 'lithuania', 'lt']],
  ['Europe/Bucharest', ['rumania', 'romania', 'ro']],
  ['Europe/Sofia', ['bulgaria', 'bg']],
  ['Europe/Belgrade', ['serbia', 'rs']],
  ['Europe/Podgorica', ['montenegro', 'me']],
  ['Europe/Tirane', ['albania', 'al']],
  ['Europe/Malta', ['malta', 'mt']],
  ['Asia/Nicosia', ['chipre', 'cyprus', 'cy']],
  [ru, ['rusia', 'russia', 'russianfederation', 'ru']],
  // África y Medio Oriente
  ['Africa/Casablanca', ['marruecos', 'morocco', 'ma']],
  ['Africa/Tunis', ['tunez', 'tunisia', 'tn']],
  ['Africa/Cairo', ['egipto', 'egypt', 'eg']],
  ['Africa/Johannesburg', ['sudafrica', 'southafrica', 'za']],
  ['Africa/Nairobi', ['kenia', 'kenya', 'ke']],
  ['Africa/Dar_es_Salaam', ['tanzania', 'tz']],
  ['Indian/Mauritius', ['mauricio', 'mauritius', 'mu']],
  ['Asia/Dubai', ['emiratosarabesunidos', 'emiratosarabes', 'unitedarabemirates', 'emiratos', 'uae', 'ae']],
  ['Asia/Qatar', ['qatar', 'catar', 'qa']],
  ['Asia/Riyadh', ['arabiasaudita', 'arabiasaudi', 'saudiarabia', 'sa']],
  ['Asia/Jerusalem', ['israel', 'il']],
  ['Asia/Amman', ['jordania', 'jordan', 'jo']],
  // Asia y Oceanía
  ['Asia/Kolkata', ['india', 'in']],
  ['Indian/Maldives', ['maldivas', 'maldives', 'mv']],
  ['Asia/Colombo', ['srilanka', 'lk']],
  ['Asia/Kathmandu', ['nepal', 'np']],
  ['Asia/Bangkok', ['tailandia', 'thailand', 'th']],
  ['Asia/Ho_Chi_Minh', ['vietnam', 'vn']],
  ['Asia/Phnom_Penh', ['camboya', 'cambodia', 'kh']],
  [id, ['indonesia', 'id']],
  ['Asia/Kuala_Lumpur', ['malasia', 'malaysia', 'my']],
  ['Asia/Singapore', ['singapur', 'singapore', 'sg']],
  ['Asia/Manila', ['filipinas', 'philippines', 'ph']],
  ['Asia/Tokyo', ['japon', 'japan', 'jp']],
  ['Asia/Shanghai', ['china', 'cn']],
  ['Asia/Hong_Kong', ['hongkong', 'hk']],
  ['Asia/Taipei', ['taiwan', 'tw']],
  ['Asia/Seoul', ['coreadelsur', 'corea', 'southkorea', 'korea', 'kr']],
  [au, ['australia', 'au']],
  ['Pacific/Auckland', ['nuevazelanda', 'newzealand', 'nz']],
  ['Pacific/Fiji', ['fiyi', 'fiji', 'fj']],
  ['Pacific/Tahiti', ['polinesiafrancesa', 'frenchpolynesia', 'tahiti', 'pf']],
];

const BY_KEY = new Map<string, Resolver>();
for (const [zone, keys] of ZONES) for (const k of keys) BY_KEY.set(k, zone);

/** Zonas fijas del mapa (para el test que verifica que Intl las conoce). */
export function countryZones(): string[] {
  return ZONES.map(([r]) => r).filter((r): r is string => typeof r === 'string');
}

/** "Estados Unidos", "EE.UU.", "españa" → "estadosunidos", "eeuu", "espana". */
export function countryKey(country: string): string {
  return country
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Zona del celu (o UTC si el motor no la informa). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Zona IANA del tramo ("America/Montevideo"). País desconocido o sin datos: la del celu. */
export function legTimeZone(leg: { country?: string | null; lat?: number | null; lng?: number | null }): string {
  const r = leg.country ? BY_KEY.get(countryKey(leg.country)) : undefined;
  if (!r) return deviceTimeZone();
  const zone = typeof r === 'string' ? r : r({ lat: leg.lat ?? null, lng: leg.lng ?? null });
  return isValidTimeZone(zone) ? zone : deviceTimeZone();
}

// ───────────────────────── Partes locales con Intl

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Fecha local ("2026-10-18"), minutos desde 00:00 y segundos de un instante en la zona dada (zona inválida: la del celu). */
export function zonedParts(utcMs: number, timeZone: string): { date: string; minutes: number; seconds: number } {
  let f: Intl.DateTimeFormat;
  try {
    f = formatter(timeZone);
  } catch {
    f = formatter(deviceTimeZone());
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  // Algunos motores devuelven "24" a la medianoche.
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute), seconds: Number(p.second) };
}

/** Desfase (ms) de la zona respecto de UTC en ese instante (hora local − UTC). */
function offsetMs(utcMs: number, timeZone: string): number {
  const t = Math.floor(utcMs / 1000) * 1000;
  const { date, minutes, seconds } = zonedParts(t, timeZone);
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + minutes * 60_000 + seconds * 1000;
  return wall - t;
}

/**
 * Instante UTC de una fecha+hora local ("2026-10-18T10:30") en la zona dada. null si no parsea.
 * Hora que no existe (salto de DST): se corre hacia adelante. Hora repetida: la primera (horario de verano).
 */
export function zonedUtc(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Dos candidatos: con el desfase de un rato antes y de un rato después (cubre los cambios de hora).
  const before = wall - offsetMs(wall - 86_400_000 / 2, timeZone);
  const after = wall - offsetMs(wall + 86_400_000 / 2, timeZone);
  const fits = (t: number) => t + offsetMs(t, timeZone) === wall;
  const a = fits(before);
  const b = fits(after);
  if (a && b) return Math.min(before, after);
  if (a) return before;
  if (b) return after;
  // Salto (la hora no existe): con el desfase de antes cae después del salto.
  return Math.max(before, after);
}
