// Traslados dentro del día (plan_trip): entre dos bloques seguidos con ubicación, si a pie es más de WALK_MAX_MIN,
// se busca transporte público (Google Routes TRANSIT, con la hora real de salida) y se inserta un bloque `transfer`
// con las líneas, paradas, horario y un link a Google Maps. Determinístico (sin Claude): barato y predecible.
// Sin GOOGLE_MAPS_API_KEY no hay líneas: queda un traslado estimado por distancia.
import { distanceMeters, type BlockVisibleRow, type ToolInput, type TransferMode } from '@build101/shared';
import { estimateMinutes, mapsTransitUrl, computeRoute, transitPlan, type TransitPlan } from '../google/routes';
import { fromMin, toMin } from '../schedule';
import { add_block } from '../tools/add_block';
import type { ToolCtx } from '../tools/types';

/** Hasta acá se camina sin agregar nada. */
export const WALK_MAX_MIN = 20;
/** Más cerca que esto, ni se calcula. */
const MIN_DISTANCE_M = 400;
/** El transporte tiene que ganarle a caminar por al menos esto. */
const TRANSIT_GAIN_MIN = 5;
/** A pie hasta esto (si no hay transporte mejor) se agrega como caminata; más, como traslado estimado. */
const LONG_WALK_MAX_MIN = 45;
/** Con un hueco más largo que esto, el traslado se planifica para llegar justo (no al terminar el bloque anterior). */
const BIG_GAP_MIN = 60;
/** Margen para llegar antes del bloque siguiente cuando hay hueco. */
const ARRIVE_EARLY_MIN = 10;
/** Zona de Montevideo / Buenos Aires (sin horario de verano): para la hora de salida de Google. */
const TZ_OFFSET = '-03:00';

type Pt = { lat: number; lng: number };
export type DayBlock = Pick<
  BlockVisibleRow,
  'id' | 'day_id' | 'type' | 'title' | 'place_name' | 'lat' | 'lng' | 'start_time' | 'end_time' | 'duration_min' | 'status' | 'plan_variant'
>;

export type TransferDeps = {
  walk: (a: Pt, b: Pt) => Promise<number>;
  /** Salir a las (departure) o llegar a las (arrival), ISO con zona. */
  transit: (a: Pt, b: Pt, when: { departure?: string; arrival?: string }) => Promise<TransitPlan | null>;
};

export const defaultTransferDeps: TransferDeps = {
  walk: async (a, b) => {
    try {
      return (await computeRoute([a, b], 'walk')).total_min;
    } catch {
      return estimateMinutes(a, b, 'walk').duration_min;
    }
  },
  transit: async (a, b, when) => {
    try {
      return await transitPlan(a, b, when);
    } catch (e) {
      console.warn('[transfers] transit:', (e as Error).message);
      return null;
    }
  },
};

export type PlannedTransfer = {
  after_block_id: string;
  before_block_id: string;
  input: Omit<ToolInput<'add_block'>, 'trip_id' | 'leg_id' | 'day_id'>;
};

const hasPt = (b: DayBlock): b is DayBlock & Pt => typeof b.lat === 'number' && typeof b.lng === 'number';

/** Fin del bloque en minutos (end_time, o start + duración, o start). */
function endMin(b: DayBlock): number | null {
  const e = toMin(b.end_time);
  if (e != null) return e;
  const s = toMin(b.start_time);
  return s == null ? null : s + (b.duration_min ?? 0);
}

const VEHICLE_WORD: Record<string, string> = { bus: 'Bus', subway: 'Subte', train: 'Tren', tram: 'Tranvía', ferry: 'Ferry', other: 'Línea' };

export function transitSummary(plan: TransitPlan): string {
  const parts = plan.lines.map((l) => {
    const stop = l.from_stop ? ` en ${l.from_stop}` : '';
    const at = l.departure ? ` (sale ${l.departure})` : '';
    return `${VEHICLE_WORD[l.vehicle] ?? 'Línea'} ${l.name}${stop}${at}`;
  });
  const walk = plan.walk_min ? ` · ${plan.walk_min} min a pie` : '';
  return `${parts.join(' → ')}${walk}`;
}

function transferMode(plan: TransitPlan): TransferMode {
  const v = plan.lines[0]?.vehicle;
  return v === 'bus' ? 'bus' : v === 'ferry' ? 'ferry' : 'transit';
}

const destName = (b: DayBlock) => b.place_name || b.title;

/**
 * Traslados para un día. `blocks`: los del día (cualquier orden). Ignora ideas, variantes (lluvia/cerrado), bloques sin
 * hora o sin ubicación, y pares que ya tienen un traslado entre medio.
 */
export async function planDayTransfers(blocks: DayBlock[], date: string, deps: TransferDeps = defaultTransferDeps): Promise<PlannedTransfer[]> {
  const day = blocks
    .filter((b) => b.status !== 'idea' && b.plan_variant === 'main' && toMin(b.start_time) != null)
    .sort((a, b) => toMin(a.start_time)! - toMin(b.start_time)!);
  const out: PlannedTransfer[] = [];
  for (let i = 0; i < day.length - 1; i++) {
    const a = day[i];
    const b = day[i + 1];
    if (a.type === 'transfer' || b.type === 'transfer') continue; // ya hay traslado (o lo es)
    if (!hasPt(a) || !hasPt(b)) continue;
    if (distanceMeters(a, b) < MIN_DISTANCE_M) continue;
    const depart = endMin(a);
    const arriveBy = toMin(b.start_time);
    if (depart == null || arriveBy == null) continue;

    const walkMin = await deps.walk(a, b);
    if (walkMin <= WALK_MAX_MIN) continue;

    // Hueco grande (p. ej. almuerzo en el medio): "llegar a las" (10 min antes del bloque siguiente); si no, "salir al
    // terminar el bloque anterior". Así el horario del bus es el de ese momento.
    const gap = arriveBy - depart;
    const iso = (min: number) => `${date}T${fromMin(min).slice(0, 5)}:00${TZ_OFFSET}`;
    const bigGap = gap > BIG_GAP_MIN;
    const plan = await deps.transit(a, b, bigGap ? { arrival: iso(arriveBy - ARRIVE_EARLY_MIN) } : { departure: iso(depart) });
    let timed: { start: number; end: number } | null = null;
    let mode: TransferMode;
    let duration: number;
    let title: string;
    const transfer: NonNullable<ToolInput<'add_block'>['transfer']> = { mode: 'walk', from: destName(a), to: destName(b) };

    if (plan && plan.duration_min + TRANSIT_GAIN_MIN <= walkMin) {
      mode = transferMode(plan);
      duration = plan.duration_min;
      const names = plan.lines.map((l) => l.name).join(' + ');
      title = `${VEHICLE_WORD[plan.lines[0].vehicle] ?? 'Transporte'} ${names} a ${destName(b)}`;
      Object.assign(transfer, { lines: plan.lines, walk_min: plan.walk_min, summary: transitSummary(plan), maps_url: mapsTransitUrl(a, b, 'transit') });
      // El bloque sigue el horario real: sale caminando hacia el primer bus y llega caminando desde el último.
      const dep = toMin(plan.lines[0].departure);
      const arr = toMin(plan.lines.at(-1)!.arrival);
      if (dep != null && arr != null && arr >= dep) {
        timed = { start: dep - (plan.walk_before_min ?? 0), end: arr + (plan.walk_after_min ?? 0) };
      }
    } else if (walkMin <= LONG_WALK_MAX_MIN) {
      mode = 'walk';
      duration = walkMin;
      title = `Caminata a ${destName(b)}`;
      Object.assign(transfer, { summary: `${walkMin} min a pie`, maps_url: mapsTransitUrl(a, b, 'walking') });
    } else {
      // Lejos y sin datos de transporte (p. ej. sin GOOGLE_MAPS_API_KEY): estimado, sin líneas.
      const est = estimateMinutes(a, b, 'transit');
      mode = 'transit';
      duration = est.duration_min;
      title = `Traslado a ${destName(b)}`;
      Object.assign(transfer, { summary: `~${est.duration_min} min en ómnibus o taxi (estimado)`, maps_url: mapsTransitUrl(a, b, 'transit'), estimated: true });
    }
    transfer.mode = mode;
    transfer.duration_min = Math.max(1, duration);

    // Horario: el real del transporte si lo hay; si no, con hueco grande se llega 10 min antes, o se sale al terminar.
    const start = Math.max(depart, timed?.start ?? (bigGap ? arriveBy - duration - ARRIVE_EARLY_MIN : depart));
    const end = Math.min(timed ? Math.max(timed.end, start + 1) : start + duration, 24 * 60 - 1);
    const late = end - arriveBy;
    out.push({
      after_block_id: a.id,
      before_block_id: b.id,
      input: {
        type: 'transfer',
        title: title.slice(0, 200),
        start_time: fromMin(start),
        end_time: fromMin(end),
        duration_min: Math.max(1, end - start),
        time_flex: 'fixed',
        lat: a.lat,
        lng: a.lng,
        transfer,
        ...(late > 5 ? { alerts: [{ kind: 'late' as const, text: `Con el traslado llegás ~${late} min tarde a «${b.title}»` }] } : {}),
      },
    });
  }
  return out;
}

// ───────── Escritura: traslados de un tramo o de un viaje (plan_trip y la herramienta plan_transfers)


export type TransfersResult = { days: number; added: number; skipped_existing: number; estimated: number };

/**
 * Calcula e inserta los traslados de los días pedidos. Con ctx.plan (dentro de plan_trip) los bloques se aplican
 * directo y entran en el undo del plan; fuera, rige la regla normal (personal aplica, compartido + agente propone).
 */
export async function addTransfers(
  ctx: ToolCtx,
  args: { trip_id: string; leg_id?: string; day_ids?: string[] },
  deps: TransferDeps = defaultTransferDeps,
): Promise<TransfersResult> {
  let dq = ctx.admin.from('days').select('id,leg_id,date,legs!inner(trip_id)').eq('legs.trip_id', args.trip_id);
  if (args.leg_id) dq = dq.eq('leg_id', args.leg_id);
  if (args.day_ids?.length) dq = dq.in('id', args.day_ids);
  const { data: days, error } = await dq;
  if (error) throw new Error(`days: ${error.message}`);
  const res: TransfersResult = { days: 0, added: 0, skipped_existing: 0, estimated: 0 };
  for (const d of (days ?? []) as { id: string; leg_id: string; date: string }[]) {
    // Lectura con el cliente del usuario (RLS / blocks_visible): no se calculan traslados hacia privados ajenos.
    const { data: blocks } = await ctx.db
      .from('blocks_visible')
      .select('id,day_id,type,title,place_name,lat,lng,start_time,end_time,duration_min,status,plan_variant,masked')
      .eq('day_id', d.id);
    const visible = ((blocks ?? []) as (DayBlock & { masked?: boolean })[]).filter((b) => !b.masked);
    if (visible.some((b) => b.type === 'transfer')) res.skipped_existing++;
    const planned = await planDayTransfers(visible, d.date, deps);
    res.days++;
    for (const p of planned) {
      try {
        await add_block({ ...p.input, trip_id: args.trip_id, leg_id: d.leg_id, day_id: d.id } as ToolInput<'add_block'>, ctx);
        res.added++;
        if (p.input.transfer?.estimated) res.estimated++;
      } catch (e) {
        console.warn('[transfers] add_block:', (e as Error).message);
      }
    }
  }
  return res;
}
