import type { BlockVisibleRow, DayRow, LegRow, ToolInput } from '@build101/shared';
import { participantsByBlock } from '../blocks';
import { badInput, dbError, notFound } from '../errors';
import type { ToolCtx, ToolOk } from './types';

export async function get_day_plan(input: ToolInput<'get_day_plan'>, ctx: ToolCtx): Promise<ToolOk> {
  const { db } = ctx; // RLS: días/tramos/bloques visibles para el usuario
  let day: DayRow | null = null;
  let leg: LegRow | null = null;

  if (input.day_id) {
    const { data, error } = await db.from('days').select('*').eq('id', input.day_id).maybeSingle();
    if (error) throw dbError(error, 'days');
    if (!data) throw notFound('No encontré ese día (o no sos miembro del viaje).');
    day = data as DayRow;
    const { data: l, error: e2 } = await db.from('legs').select('*').eq('id', day.leg_id).maybeSingle();
    if (e2) throw dbError(e2, 'legs');
    if (!l) throw notFound('No encontré el tramo de ese día.');
    leg = l as LegRow;
    // Validación cruzada: si además vienen trip_id / date / leg_id, tienen que coincidir.
    if (input.trip_id && leg.trip_id !== input.trip_id) throw badInput('El day_id no es de ese trip_id.');
    if (input.date && day.date !== input.date) throw badInput('El day_id no corresponde a esa fecha.');
    if (input.leg_id && leg.id !== input.leg_id) throw badInput('El day_id no es de ese leg_id.');
  } else {
    if (!input.trip_id || !input.date) throw badInput('Mandá day_id, o trip_id + date.');
    let lq = db.from('legs').select('*').eq('trip_id', input.trip_id);
    if (input.leg_id) lq = lq.eq('id', input.leg_id);
    const { data: legs, error } = await lq;
    if (error) throw dbError(error, 'legs');
    const legRows = (legs ?? []) as LegRow[];
    if (!legRows.length) throw notFound('No encontré ese viaje/tramo (o no sos miembro).');
    const { data: days, error: e2 } = await db
      .from('days')
      .select('*')
      .eq('date', input.date)
      .in('leg_id', legRows.map((l) => l.id));
    if (e2) throw dbError(e2, 'days');
    const dayRows = (days ?? []) as DayRow[];
    if (!dayRows.length) throw notFound(`No hay un día ${input.date} en ese viaje.`);
    if (dayRows.length > 1) {
      // Tramos en paralelo: el del usuario.
      const { data: mine, error: e3 } = await db
        .from('leg_members')
        .select('leg_id')
        .eq('user_id', ctx.userId)
        .in('leg_id', dayRows.map((d) => d.leg_id));
      if (e3) throw dbError(e3, 'leg_members');
      const myLegs = new Set((mine ?? []).map((r) => r.leg_id as string));
      day = dayRows.find((d) => myLegs.has(d.leg_id)) ?? dayRows[0];
    } else {
      day = dayRows[0];
    }
    leg = legRows.find((l) => l.id === day!.leg_id) ?? null;
  }

  const { data: blocks, error } = await db
    .from('blocks_visible')
    .select('*')
    .eq('day_id', day.id)
    .order('start_time', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true });
  if (error) throw dbError(error, 'blocks_visible');
  const rows = (blocks ?? []) as BlockVisibleRow[];
  // Participantes con service role, solo de bloques que el usuario ya ve (así "Ocupado" dice de quién es).
  const parts = await participantsByBlock(ctx.admin, rows.map((b) => b.id));
  return {
    ok: true,
    data: { day, leg, blocks: rows.map((b) => ({ ...b, participant_ids: parts.get(b.id) ?? [] })) },
  };
}
