// Lógica pura del calendario de "Nuevo viaje" (PRD 31): grilla del mes (lunes primero), navegación de meses/años,
// días pasados, rango llegada → salida y el formato que va en las respuestas. Sin React: se testea con tsx (calendarModel.test.ts).

export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** Encabezado de la grilla: la semana arranca el lunes. */
export const WEEKDAY_SHORT = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
export const WEEKDAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Cuántos años para adelante se puede elegir (además del actual). */
export const YEARS_AHEAD = 3;
export const MIN_DAYS = 1;
export const MAX_DAYS = 60;

export type MonthView = { y: number; m: number };
/** Rango elegido: llegada y (opcional) salida, YYYY-MM-DD. */
export type DateRange = { start: string | null; end: string | null };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const r = ISO.exec(iso);
  return r ? { y: Number(r[1]), m: Number(r[2]) - 1, d: Number(r[3]) } : null;
}

export function isIso(v: unknown): v is string {
  return typeof v === 'string' && ISO.test(v);
}

/** Hoy en hora local del celu. */
export function todayIso(now = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(iso: string, n: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.y, p.m, p.d + n));
  return toIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** 0 = lunes … 6 = domingo. */
export function weekdayMon(iso: string): number {
  const p = parseIso(iso);
  if (!p) return 0;
  return (new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() + 6) % 7;
}

/** Semanas del mes (lunes a domingo); null = casillero vacío antes del 1 o después del último día. */
export function monthGrid(y: number, m: number): (string | null)[][] {
  const first = weekdayMon(toIso(y, m, 1));
  const total = daysInMonth(y, m);
  const cells: (string | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: total }, (_, i) => toIso(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "octubre 2027". */
export function monthTitle(v: MonthView): string {
  return `${MONTH_NAMES[v.m]} ${v.y}`;
}

export function shiftMonth(v: MonthView, delta: number): MonthView {
  const t = v.y * 12 + v.m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

/** Años elegibles: el actual hasta +3. */
export function yearOptions(today: string): number[] {
  const y = parseIso(today)?.y ?? new Date().getFullYear();
  return Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => y + i);
}

/** Mes entero en el pasado (no se puede elegir). */
export function isMonthPast(v: MonthView, today: string): boolean {
  const t = parseIso(today);
  if (!t) return false;
  return v.y * 12 + v.m < t.y * 12 + t.m;
}

/** Límites de navegación: no antes del mes actual ni después de diciembre de +3 años. */
export function canShift(v: MonthView, delta: number, today: string): boolean {
  const next = shiftMonth(v, delta);
  const years = yearOptions(today);
  return !isMonthPast(next, today) && next.y <= years[years.length - 1]!;
}

/** Mes que se abre: el de la llegada elegida o el actual. */
export function initialView(range: DateRange, today: string): MonthView {
  const p = parseIso(range.start ?? '') ?? parseIso(today);
  return p ? { y: p.y, m: p.m } : { y: new Date().getFullYear(), m: new Date().getMonth() };
}

/** Elegir un año: mismo mes si no queda en el pasado; si no, el mes actual. */
export function pickYear(v: MonthView, year: number, today: string): MonthView {
  const next = { y: year, m: v.m };
  return isMonthPast(next, today) ? (initialView({ start: null, end: null }, today)) : next;
}

export function isPast(iso: string, today: string): boolean {
  return iso < today;
}

/** Días contando llegada y salida (24 → 29 = 6 días). */
export function daysInclusive(start: string, end: string): number {
  const a = parseIso(start);
  const b = parseIso(end);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86_400_000) + 1;
}

export function clampDays(n: number): number {
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(n)));
}

/**
 * Toque en un día: el primero marca la llegada; el segundo, la salida. Tocar antes de la llegada (o con el rango
 * completo) arranca de nuevo; tocar la misma llegada saca la salida. Una salida a más de 60 días arranca de nuevo.
 */
export function tapDay(sel: DateRange, iso: string): DateRange {
  if (!sel.start || sel.end) return { start: iso, end: null };
  if (iso <= sel.start) return { start: iso, end: null };
  if (daysInclusive(sel.start, iso) > MAX_DAYS) return { start: iso, end: null };
  return { start: sel.start, end: iso };
}

export function inRange(iso: string, sel: DateRange): boolean {
  return !!sel.start && !!sel.end && iso > sel.start && iso < sel.end;
}

export function daysLabel(n: number): string {
  return n === 1 ? '1 día' : `${n} días`;
}

/** "sáb 24 oct" (con año si no es el actual). */
export function shortDay(iso: string, today?: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const wd = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  const year = today && parseIso(today)?.y !== p.y ? ` ${p.y}` : '';
  return `${wd} ${p.d} ${MONTH_SHORT[p.m]}${year}`;
}

/** Para lectores de pantalla: "sábado 24 de octubre de 2027". */
export function spokenDay(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return `${WEEKDAY_LONG[weekdayMon(iso)]} ${p.d} de ${MONTH_NAMES[p.m]} de ${p.y}`;
}

/** Lo que dice el pie del calendario. */
export function rangeSummary(sel: DateRange, today?: string): string {
  if (!sel.start) return 'Tocá el día de llegada';
  if (!sel.end) return `Llegada: ${shortDay(sel.start, today)} · tocá la salida (opcional)`;
  return `${shortDay(sel.start, today)} → ${shortDay(sel.end, today)} · ${daysLabel(daysInclusive(sel.start, sel.end))}`;
}

// ───────────────────────── Rango como respuesta de una pregunta de fecha

/** "2027-10-24" o "2027-10-24/2027-10-29". */
export function encodeRange(sel: DateRange): string {
  if (!sel.start) return '';
  return sel.end ? `${sel.start}/${sel.end}` : sel.start;
}

/** Al revés: null si el valor no es una fecha (una opción o texto libre). */
export function decodeRange(v: string | null | undefined): DateRange | null {
  if (!v) return null;
  const [a, b] = v.split('/');
  if (!isIso(a)) return null;
  return { start: a, end: isIso(b) && b > a ? b : null };
}
