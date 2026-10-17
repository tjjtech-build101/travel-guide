// Generador de .ics a mano (sin librería). Hora flotante: Contratos no guarda zona horaria.
import type { DayRow } from '@build101/shared';

import type { PlanBlock } from './selectors';
import { toMin } from './selectors';

/** Escapado RFC 5545 de TEXT: \ ; , y saltos de línea. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Corta líneas a 75 octetos UTF-8 (RFC 5545 §3.1) con CRLF + espacio, sin partir caracteres. */
function fold(line: string): string {
  const bytes = (ch: string) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  };
  const parts: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const b = bytes(ch);
    const limit = parts.length ? 74 : 75; // las continuaciones empiezan con un espacio
    if (size + b > limit) {
      parts.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateCompact(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

function floating(date: string, minutes: number): string {
  // Minutos ≥ 24 h pasan al día siguiente (p. ej. una cena que termina 00:30).
  const dayShift = Math.floor(minutes / (24 * 60));
  const m = minutes - dayShift * 24 * 60;
  const d = dayShift ? addDays(date, dayShift) : dateCompact(date);
  return `${d}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

function utcStamp(now: Date): string {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(
    now.getUTCMinutes(),
  )}${pad(now.getUTCSeconds())}Z`;
}

/**
 * 1 VEVENT por bloque con día. Con hora → DTSTART/DTEND flotantes; sin hora → evento de día completo.
 * Privados ajenos salen como "Ocupado" sin detalle.
 */
export function buildIcs(blocks: PlanBlock[], days: Pick<DayRow, 'id' | 'date'>[], calName: string, now = new Date()): string {
  const dateById = new Map(days.map((d) => [d.id, d.date]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//build101//ES', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(calName)}`];
  const stamp = utcStamp(now);
  for (const b of blocks) {
    if (!b.day_id || (b.plan_variant && b.plan_variant !== 'main')) continue;
    const date = dateById.get(b.day_id);
    if (!date) continue;
    lines.push('BEGIN:VEVENT', `UID:${b.id}@build101`, `DTSTAMP:${stamp}`);
    const start = toMin(b.start_time);
    if (start !== null) {
      let end = toMin(b.end_time);
      if (end === null) end = start + (b.duration_min ?? 60);
      if (end <= start) end += 24 * 60;
      lines.push(`DTSTART:${floating(date, start)}`, `DTEND:${floating(date, end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateCompact(date)}`, `DTEND;VALUE=DATE:${addDays(date, 1)}`);
    }
    lines.push(`SUMMARY:${icsEscape(b.masked ? 'Ocupado' : b.title)}`);
    if (!b.masked) {
      if (b.place_name) lines.push(`LOCATION:${icsEscape(b.place_name)}`);
      const desc = [b.description, b.notes, b.booking_url].filter(Boolean).join('\n');
      if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
