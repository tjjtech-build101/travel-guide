// Contexto para las instrucciones de voz: perfil, viaje (resumen + lo que sigue hoy), memoria y foco.
// Todo en paralelo y tolerante a fallas: si algo no carga, el scout atiende igual con menos contexto.
import { PROPOSAL_TTL_MS, type BlockVisibleRow } from '@build101/shared';
import { todayIso } from '../agents/dates';
import { dbError, notFound } from '../errors';
import { get_day_plan } from '../tools/get_day_plan';
import { get_trip_overview } from '../tools/get_trip_overview';
import type { ToolCtx } from '../tools/types';
import { nowHHMM, type InstructionsInput } from './instructions';

export const TRIP_TZ = 'America/Montevideo';
const MEMORY_LIMIT = 20;
const UPCOMING_LIMIT = 3;

type Profile = {
  display_name: string | null;
  locale: string | null;
  interests: Record<string, number> | null;
  avoid: string[] | null;
  dietary: string[] | null;
  pace: string | null;
};

export type VoiceContext = Omit<InstructionsInput, 'mode' | 'nowText' | 'extraRules'> & {
  personaId: string | null;
};

type Focus = { block_id?: string; google_place_id?: string; lat?: number; lng?: number; label?: string };

const firstName = (n: string | null | undefined) => n?.trim().split(/\s+/)[0] ?? null;

/** Intereses con puntaje ≥ 3, de mayor a menor. */
export function topInterests(interests: Record<string, number> | null | undefined): string[] {
  return Object.entries(interests ?? {})
    .filter(([, v]) => typeof v === 'number' && v >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** Bloques de hoy que todavía no terminaron (sin ideas ni variantes de lluvia/cerrado). */
export function upcomingBlocks(blocks: BlockVisibleRow[], now: string, limit = UPCOMING_LIMIT): BlockVisibleRow[] {
  return blocks
    .filter((b) => b.status !== 'idea' && b.plan_variant === 'main')
    .filter((b) => !b.end_time || hhmm(b.end_time)! >= now)
    .slice(0, limit);
}

/** "15:30 Café en el Solís (Teatro Solís)" para los bloques que siguen hoy. */
export function upcomingLines(blocks: BlockVisibleRow[], now: string, limit = UPCOMING_LIMIT): string[] {
  return upcomingBlocks(blocks, now, limit)
    .map((b) => {
      const time = hhmm(b.start_time) ?? 'sin hora';
      const where = b.place_name && b.place_name !== b.title ? ` (${b.place_name})` : '';
      return `${time} ${b.title}${where}${b.masked ? ' [privado de otra persona]' : ''}`;
    });
}

let companionPersonaId: string | null | undefined;

async function personaId(ctx: ToolCtx): Promise<string | null> {
  if (companionPersonaId !== undefined) return companionPersonaId;
  const { data } = await ctx.admin.from('personas').select('id').eq('kind', 'companion').limit(1).maybeSingle();
  companionPersonaId = (data?.id as string | undefined) ?? null;
  return companionPersonaId;
}

/** Propuestas pendientes (las más nuevas primero, ≤ 5) para que el Scout pueda contarlas y decidirlas con un sí explícito. */
export async function pendingProposalLines(ctx: ToolCtx, tripId: string, now: Date): Promise<string[]> {
  const { data } = await ctx.db
    .from('agent_proposals')
    .select('id,summary,created_at')
    .eq('trip_id', tripId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(5);
  return ((data ?? []) as { id: string; summary: string | null; created_at: string }[])
    .filter((p) => now.getTime() - Date.parse(p.created_at) <= PROPOSAL_TTL_MS)
    .map((p) => `propuesta pendiente «${p.summary ?? 'cambios en el plan'}»: proposal_id=${p.id}`);
}

async function loadTrip(ctx: ToolCtx, tripId: string, now: Date) {
  const overview = await get_trip_overview({ trip_id: tripId }, ctx); // tira notFound si no es miembro
  const ov = overview.data as {
    summary: string;
    members: { user_id: string; display_name: string | null }[];
    legs: { id: string; city: string; start_date: string; end_date: string; member_ids: string[]; days: { id: string; date: string }[] }[];
  };
  const today = todayIso(now, TRIP_TZ);
  let upcoming: string[] = [];
  let legId: string | null = null;
  let dayId: string | null = null;
  let todayBlocks: BlockVisibleRow[] = [];
  try {
    const plan = await get_day_plan({ trip_id: tripId, date: today }, ctx);
    const d = plan.data as { day: { id: string } | null; leg: { id: string } | null; blocks: BlockVisibleRow[] };
    const hm = nowHHMM(now, TRIP_TZ);
    upcoming = upcomingLines(d.blocks, hm);
    todayBlocks = upcomingBlocks(d.blocks, hm).filter((b) => !b.masked);
    legId = d.leg?.id ?? null;
    dayId = d.day?.id ?? null;
  } catch {
    // hoy no es un día del viaje: sin "lo que sigue"
  }
  const myLegs = ov.legs.filter((l) => l.member_ids.includes(ctx.userId));
  const pending = await pendingProposalLines(ctx, tripId, now);
  const toolData = [
    `trip_id=${tripId}`,
    dayId && legId ? `hoy ${today}: day_id=${dayId}, leg_id=${legId}` : `hoy ${today}: no es un día del viaje`,
    ...myLegs.map((l) => `tramo ${l.city} ${l.start_date}→${l.end_date}: leg_id=${l.id}`),
    ...todayBlocks.map((b) => `bloque «${b.title}» de hoy: block_id=${b.id}`),
    ...pending,
  ];
  const leg = ov.legs.find((l) => l.id === legId);
  const companions = (leg?.member_ids ?? [])
    .filter((id) => id !== ctx.userId)
    .map((id) => firstName(ov.members.find((m) => m.user_id === id)?.display_name))
    .filter((n): n is string => !!n);
  return { summary: ov.summary, upcoming, companions, toolData };
}

async function loadMemories(ctx: ToolCtx, tripId: string | undefined): Promise<string[]> {
  const filter = tripId
    ? `and(scope.eq.personal,user_id.eq.${ctx.userId}),and(scope.eq.trip,trip_id.eq.${tripId})`
    : `and(scope.eq.personal,user_id.eq.${ctx.userId})`;
  const { data, error } = await ctx.db
    .from('memories')
    .select('text,scope')
    .or(filter)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MEMORY_LIMIT);
  if (error) {
    console.warn('[voice] memories:', error.message);
    return [];
  }
  return (data ?? []).map((m) => (m.scope === 'trip' ? `(del grupo) ${m.text}` : String(m.text)));
}

/** Texto de apertura para "Hablar de esto". */
async function resolveFocus(ctx: ToolCtx, focus: Focus | undefined): Promise<string | null> {
  if (!focus) return null;
  if (focus.block_id) {
    const { data } = await ctx.db
      .from('blocks_visible')
      .select('title,place_name,start_time,masked')
      .eq('id', focus.block_id)
      .maybeSingle();
    if (data && !data.masked) {
      const at = data.start_time ? ` a las ${String(data.start_time).slice(0, 5)}` : '';
      const where = data.place_name && data.place_name !== data.title ? ` en ${data.place_name}` : '';
      return `el bloque «${data.title}»${where}${at} del plan`;
    }
  }
  if (focus.label) {
    const coords = focus.lat !== undefined && focus.lng !== undefined ? ` (${focus.lat.toFixed(5)}, ${focus.lng.toFixed(5)})` : '';
    return `el lugar «${focus.label}»${coords}`;
  }
  if (focus.lat !== undefined && focus.lng !== undefined) {
    return `un punto del mapa en ${focus.lat.toFixed(5)}, ${focus.lng.toFixed(5)} (si hace falta, mirá qué hay ahí con where_am_i pasándole esas coordenadas)`;
  }
  if (focus.google_place_id) return `el lugar con id ${focus.google_place_id} (pedí place_details para saber cuál es)`;
  return null;
}

export async function loadVoiceContext(
  ctx: ToolCtx,
  input: { trip_id?: string; lang?: string; focus?: Focus; location?: { lat: number; lng: number } },
  now = new Date(),
): Promise<VoiceContext> {
  const [profileRes, member, trip, memories, focus, persona] = await Promise.all([
    ctx.admin.from('profiles').select('display_name,locale,interests,avoid,dietary,pace').eq('id', ctx.userId).maybeSingle(),
    input.trip_id
      ? ctx.db.from('trip_members').select('language').eq('trip_id', input.trip_id).eq('user_id', ctx.userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    input.trip_id ? loadTrip(ctx, input.trip_id, now) : Promise.resolve(null),
    loadMemories(ctx, input.trip_id),
    resolveFocus(ctx, input.focus).catch(() => null),
    personaId(ctx).catch(() => null),
  ]);
  if (profileRes.error) console.warn('[voice] profiles:', profileRes.error.message); // sin perfil: atiende igual
  if (member.error) throw dbError(member.error, 'trip_members');
  if (input.trip_id && !member.data) throw notFound('No encontré ese viaje (o no sos miembro).');
  const p = (profileRes.data ?? {}) as Partial<Profile>;
  const lang = input.lang ?? (member.data?.language as string | null | undefined) ?? p.locale ?? 'es';
  return {
    lang: lang.slice(0, 2).toLowerCase(),
    user: {
      name: firstName(p.display_name),
      interests: topInterests(p.interests),
      avoid: p.avoid ?? [],
      dietary: p.dietary ?? [],
      pace: p.pace ?? null,
    },
    trip,
    memories,
    location: input.location ?? null,
    focus,
    userId: ctx.userId,
    personaId: persona,
  };
}
