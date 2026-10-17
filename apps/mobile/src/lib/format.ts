const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function parseDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/** "17–24 oct 2026", "28 sep – 3 oct 2026" o "Sin fechas". */
export function formatDateRange(start: string | null, end: string | null): string {
  const a = start ? parseDate(start) : null;
  const b = end ? parseDate(end) : null;
  if (!a && !b) return 'Sin fechas';
  if (a && !b) return `Desde el ${a.d} ${MONTHS[a.m]} ${a.y}`;
  if (!a && b) return `Hasta el ${b.d} ${MONTHS[b.m]} ${b.y}`;
  if (a && b) {
    if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m]} ${a.y}`;
    if (a.y === b.y) return `${a.d} ${MONTHS[a.m]} – ${b.d} ${MONTHS[b.m]} ${a.y}`;
    return `${a.d} ${MONTHS[a.m]} ${a.y} – ${b.d} ${MONTHS[b.m]} ${b.y}`;
  }
  return '';
}

/** "sáb 17 oct". */
export function formatDay(iso: string): string {
  const p = parseDate(iso);
  if (!p) return iso;
  const wd = new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${p.d} ${MONTHS[p.m]}`;
}

/** "18:00" a partir de "18:00:00". */
export function formatTime(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

/** "hace 3 min". */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
