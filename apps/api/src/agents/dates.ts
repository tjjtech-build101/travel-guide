// Fechas YYYY-MM-DD sin zona (aritmética en UTC para no correr el día).

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Todas las fechas de start a end inclusive. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fecha de hoy en Montevideo (la app es rioplatense). */
export function todayIso(now = new Date(), timeZone = 'America/Montevideo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Próximo sábado (si hoy es sábado, el de la semana que viene). */
export function nextSaturday(today: string): string {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  const delta = (6 - wd + 7) % 7 || 7;
  return addDays(today, delta);
}

const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function weekdayLong(date: string): string {
  return WEEKDAYS_LONG[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** '2026-10-17','2026-10-19' → '17–19/10'; meses distintos → '30/10–2/11' */
export function shortRange(start: string, end: string): string {
  const [, m1, d1] = start.split('-').map(Number);
  const [, m2, d2] = end.split('-').map(Number);
  if (start === end) return `${d1}/${m1}`;
  return m1 === m2 ? `${d1}–${d2}/${m1}` : `${d1}/${m1}–${d2}/${m2}`;
}
