// Zona horaria del tramo (Ahora v2). Carril "núcleo": implementar legTimeZone (IANA por país + bandas de longitud
// para países con varias zonas) y zonedParts/zonedUtc con Intl. Firmas fijas: las usan los otros carriles.

/** Zona IANA del tramo ("America/Montevideo"). Sin datos: la del celu. */
export function legTimeZone(leg: { country?: string | null; lat?: number | null; lng?: number | null }): string {
  void leg;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Fecha local ("2026-10-18") y minutos desde 00:00 de un instante en la zona dada. */
export function zonedParts(utcMs: number, timeZone: string): { date: string; minutes: number; seconds: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), seconds: Number(p.second) };
}

/** Instante UTC de una fecha+hora local ("2026-10-18T10:30") en la zona dada. */
export function zonedUtc(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const { date, minutes } = zonedParts(guess, timeZone);
  const off = (Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + minutes * 60_000 - guess) / 60_000;
  return guess - off * 60_000;
}
