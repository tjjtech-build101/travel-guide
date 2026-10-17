import type { DayRow, LegRow, ProfileRow, ToolInput, TripMemberRow, TripRow } from '@build101/shared';
import { dbError, notFound } from '../errors';
import type { ToolCtx, ToolOk } from './types';

const SUMMARY_MAX = 600;
const ROLE_LABEL: Record<string, string> = { organizer: 'organiza', traveler: '', follower: 'sigue de lejos' };

const ddmm = (d: string | null) => {
  if (!d) return '?';
  const [, m, day] = d.split('-').map(Number);
  return `${day}/${m}`;
};

/** Resumen en texto plano (≤ 600 caracteres) pensado para leerlo en voz. */
export function buildSummary(
  trip: Pick<TripRow, 'title' | 'start_date' | 'end_date' | 'status'>,
  members: { user_id: string; display_name: string | null; role: string }[],
  legs: { city: string; start_date: string; end_date: string; member_ids: string[] }[],
): string {
  const name = (id: string) => members.find((m) => m.user_id === id)?.display_name?.split(' ')[0] ?? 'alguien';
  const travelers = members.filter((m) => m.role !== 'follower');
  const people = travelers
    .map((m) => {
      const n = m.display_name?.split(' ')[0] ?? 'alguien';
      return ROLE_LABEL[m.role] ? `${n} (${ROLE_LABEL[m.role]})` : n;
    })
    .join(', ');
  const legText = legs
    .map((l) => {
      const all = travelers.length > 0 && travelers.every((t) => l.member_ids.includes(t.user_id));
      const who = all ? 'todos' : l.member_ids.map(name).join(', ') || 'nadie';
      return `${l.city} del ${ddmm(l.start_date)} al ${ddmm(l.end_date)} (${who})`;
    })
    .join('; ');
  const text =
    `${trip.title}, del ${ddmm(trip.start_date)} al ${ddmm(trip.end_date)}. ` +
    `${travelers.length} viajeros: ${people}. ` +
    (legs.length ? `Tramos: ${legText}.` : 'Todavía no hay tramos.');
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

export async function get_trip_overview(input: ToolInput<'get_trip_overview'>, ctx: ToolCtx): Promise<ToolOk> {
  const { db } = ctx; // RLS: solo miembros ven el viaje
  const { data: trip, error } = await db.from('trips').select('*').eq('id', input.trip_id).maybeSingle();
  if (error) throw dbError(error, 'trips');
  if (!trip) throw notFound('No encontré ese viaje (o no sos miembro).');

  const [{ data: members, error: e1 }, { data: legs, error: e2 }] = await Promise.all([
    db.from('trip_members').select('user_id,role').eq('trip_id', input.trip_id),
    db.from('legs').select('*').eq('trip_id', input.trip_id).order('sort_order').order('start_date'),
  ]);
  if (e1) throw dbError(e1, 'trip_members');
  if (e2) throw dbError(e2, 'legs');
  const memberRows = (members ?? []) as Pick<TripMemberRow, 'user_id' | 'role'>[];
  const legRows = (legs ?? []) as LegRow[];
  const legIds = legRows.map((l) => l.id);
  const userIds = memberRows.map((m) => m.user_id);

  const [{ data: profiles, error: e3 }, { data: legMembers, error: e4 }, { data: days, error: e5 }] = await Promise.all([
    userIds.length
      ? db.from('profiles').select('id,display_name,avatar_url').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    legIds.length
      ? db.from('leg_members').select('leg_id,user_id').in('leg_id', legIds)
      : Promise.resolve({ data: [], error: null }),
    legIds.length
      ? db.from('days').select('id,leg_id,date').in('leg_id', legIds).order('date')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (e3) throw dbError(e3, 'profiles');
  if (e4) throw dbError(e4, 'leg_members');
  if (e5) throw dbError(e5, 'days');

  const profileById = new Map(((profiles ?? []) as Pick<ProfileRow, 'id' | 'display_name' | 'avatar_url'>[]).map((p) => [p.id, p]));
  const membersOut = memberRows.map((m) => ({
    user_id: m.user_id,
    display_name: profileById.get(m.user_id)?.display_name ?? null,
    avatar_url: profileById.get(m.user_id)?.avatar_url ?? null,
    role: m.role,
  }));
  const lm = (legMembers ?? []) as { leg_id: string; user_id: string }[];
  const dayRows = (days ?? []) as Pick<DayRow, 'id' | 'leg_id' | 'date'>[];
  const legsOut = legRows.map((l) => ({
    ...l,
    member_ids: lm.filter((x) => x.leg_id === l.id).map((x) => x.user_id),
    days: dayRows.filter((d) => d.leg_id === l.id).map((d) => ({ id: d.id, date: d.date })),
  }));

  return {
    ok: true,
    data: { trip, members: membersOut, legs: legsOut, summary: buildSummary(trip as TripRow, membersOut, legsOut) },
  };
}
