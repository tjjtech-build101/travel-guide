// Recalculo de horarios de un día (move_block con recompute_times). Puro salvo la función de traslado inyectada.
import type { BlockAlert, TimeFlex } from '@build101/shared';

export type SchedBlock = {
  id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  duration_min: number | null;
  time_flex: TimeFlex;
  lat: number | null;
  lng: number | null;
  alerts: BlockAlert[] | null;
};

export type SchedChange = { start_time?: string | null; end_time?: string | null; alerts?: BlockAlert[] | null };

const DAY_END = 23 * 60 + 59;
const DEFAULT_DURATION = 60;

export function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function fromMin(min: number): string {
  const m = Math.max(0, Math.min(DAY_END, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;

/** Ordena como get_day_plan: start_time (nulls al final) y después sort_order. */
export function compareBlocks(
  a: { start_time: string | null; sort_order: number | null },
  b: { start_time: string | null; sort_order: number | null },
): number {
  const sa = toMin(a.start_time);
  const sb = toMin(b.start_time);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  }
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** Posición donde insertar un bloque en un día ya ordenado. */
export function insertIndex(
  ordered: { start_time: string | null }[],
  opts: { position?: number; start_time?: string | null },
): number {
  if (opts.position !== undefined) return Math.max(0, Math.min(ordered.length, opts.position));
  const s = toMin(opts.start_time ?? null);
  if (s === null) return ordered.length;
  const idx = ordered.findIndex((b) => {
    const bs = toMin(b.start_time);
    return bs === null || bs > s;
  });
  return idx === -1 ? ordered.length : idx;
}

/**
 * Desde `fromIndex`, cada bloque no-`fixed` arranca como mínimo al fin del anterior + traslado (solo se corre
 * para adelante si se pisa o si no tenía hora). Un `fixed` pisado recibe alert `late`.
 * `anchorIndex`: bloque con hora explícita (no se recalcula).
 */
export async function recomputeTimes(
  ordered: SchedBlock[],
  fromIndex: number,
  travel: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Promise<number>,
  anchorIndex?: number,
): Promise<Map<string, SchedChange>> {
  const changes = new Map<string, SchedChange>();
  let prevEnd: number | null = null;
  let prevLoc: { lat: number; lng: number } | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const b = ordered[i];
    const loc = b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;
    let start = toMin(b.start_time);
    let end = toMin(b.end_time);
    const dur = b.duration_min ?? (start !== null && end !== null && end > start ? end - start : null);

    if (i >= fromIndex && i !== anchorIndex && prevEnd !== null) {
      const t = prevLoc && loc ? await travel(prevLoc, loc) : 0;
      const earliest = roundUp5(prevEnd + t);
      const oldLate = (b.alerts ?? []).filter((a) => a.kind === 'late');
      const otherAlerts = (b.alerts ?? []).filter((a) => a.kind !== 'late');

      if (b.time_flex !== 'fixed') {
        if (start === null || earliest > start) {
          start = earliest;
          end = start + (dur ?? DEFAULT_DURATION);
          changes.set(b.id, { start_time: fromMin(start), end_time: fromMin(end) });
        }
        if (oldLate.length) changes.set(b.id, { ...(changes.get(b.id) ?? {}), alerts: otherAlerts });
      } else if (start !== null && earliest > start) {
        const late = earliest - start;
        const alerts = [...otherAlerts, { kind: 'late', text: `Llegás ${late} min tarde a ${b.title}` }];
        changes.set(b.id, { alerts });
      } else if (oldLate.length) {
        changes.set(b.id, { alerts: otherAlerts });
      }
    }

    if (start !== null) prevEnd = end !== null && end > start ? end : start + (dur ?? DEFAULT_DURATION);
    if (loc) prevLoc = loc;
  }
  return changes;
}
