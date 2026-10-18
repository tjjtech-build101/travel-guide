// Un tour listo queda en el plan: así aparece en la pestaña Plan, en el mapa del día y en Ahora (que arranca el
// tour desde un bloque `tour` con tour_id). Misma regla de escritura que cualquier bloque (add_block):
// personal → se aplica; compartido y lo pidió el Scout → propuesta al grupo; lo pidió una persona → se aplica.
import type { TourPlanLink } from '@build101/shared';
import { dbError } from '../errors';
import { fromMin, toMin } from '../schedule';
import { addBlockImpl } from '../tools/add_block';
import type { ToolCtx } from '../tools/types';
import { todayIso } from './dates';

const TRIP_TZ = 'America/Montevideo';

export type TourPlanArgs = {
  tourId: string;
  tripId: string;
  /** Bloque desde el que se pidió el tour: se enlaza ese, no se agrega otro. */
  blockId: string | null;
  title: string;
  durationMin: number;
  start: Date;
  participantIds: string[];
  lat: number;
  lng: number;
};

/** "HH:MM" local redondeado a los 5 min siguientes. */
export function localStartHHMM(start: Date, timeZone = TRIP_TZ): string {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start);
  const min = Math.min(23 * 60 + 55, Math.ceil((toMin(hm) ?? 0) / 5) * 5);
  return fromMin(min).slice(0, 5);
}

/** Nunca tira: si algo falla el tour sale igual, solo que sin bloque en el plan. */
export async function attachTourToPlan(ctx: ToolCtx, a: TourPlanArgs): Promise<TourPlanLink> {
  try {
    return await attach(ctx, a);
  } catch (err) {
    console.error(`[tourPlan/${a.tourId}]`, err);
    return { mode: 'none', reason: 'No pude sumarlo al plan.' };
  }
}

async function attach(ctx: ToolCtx, a: TourPlanArgs): Promise<TourPlanLink> {
  const { admin } = ctx;
  if (a.blockId) {
    const { error } = await admin.from('blocks').update({ tour_id: a.tourId }).eq('id', a.blockId);
    if (error) throw dbError(error, 'blocks tour_id');
    return { mode: 'linked', block_id: a.blockId, start_time: null };
  }

  // El día de hoy (en la zona del viaje) en un tramo de este viaje donde está la persona.
  const date = todayIso(a.start, TRIP_TZ);
  const { data: lm, error: e1 } = await admin.from('leg_members').select('leg_id').eq('user_id', ctx.userId);
  if (e1) throw dbError(e1, 'leg_members');
  const myLegs = (lm ?? []).map((r) => r.leg_id as string);
  if (!myLegs.length) return { mode: 'none', reason: 'No estás en ningún tramo del viaje.' };
  const { data: legs, error: e2 } = await admin.from('legs').select('id').eq('trip_id', a.tripId).in('id', myLegs);
  if (e2) throw dbError(e2, 'legs');
  const legIds = (legs ?? []).map((l) => l.id as string);
  if (!legIds.length) return { mode: 'none', reason: 'No estás en ningún tramo del viaje.' };
  const { data: days, error: e3 } = await admin.from('days').select('id,leg_id').in('leg_id', legIds).eq('date', date).limit(1);
  if (e3) throw dbError(e3, 'days');
  const day = days?.[0] as { id: string; leg_id: string } | undefined;
  if (!day) return { mode: 'none', reason: 'Hoy no es un día del viaje.' };

  const start_time = localStartHHMM(a.start);
  const res = await addBlockImpl(
    {
      trip_id: a.tripId,
      leg_id: day.leg_id,
      day_id: day.id,
      type: 'tour',
      title: a.title,
      start_time,
      duration_min: a.durationMin,
      lat: a.lat,
      lng: a.lng,
      participant_ids: a.participantIds,
      reason: 'El Scout armó este tour para hacerlo ahora.',
    },
    ctx,
    { tour_id: a.tourId },
  );
  const data = res.data as { mode: 'applied' | 'proposed'; block?: { id: string }; proposal_id?: string };
  if (data.mode === 'proposed' && data.proposal_id) return { mode: 'proposed', proposal_id: data.proposal_id, start_time };
  if (data.block) return { mode: 'applied', block_id: data.block.id, start_time };
  return { mode: 'none', reason: 'No pude sumarlo al plan.' };
}
