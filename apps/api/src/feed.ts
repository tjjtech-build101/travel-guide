// activity_feed: toda escritura deja exactamente 1 fila deshacible (+ busy_changed si tocó privados).
import { randomBytes } from 'node:crypto';
import { SCOUT, type FeedKind } from '@build101/shared';
import type { Db } from './supabase';
import type { ToolCtx } from './tools/types';
import type { Op, Touched } from './blocks';
import { dbError } from './errors';

/** 24 bytes random en base64url (32 caracteres). */
export function newUndoToken(): string {
  return randomBytes(24).toString('base64url');
}

export type FeedPayload = { summary: string; inverse?: Op[]; [k: string]: unknown };

export async function insertFeed(
  ctx: ToolCtx,
  row: { trip_id: string; kind: FeedKind; payload: FeedPayload; undoable: boolean; private?: boolean },
): Promise<{ feed_id: string; undo_token?: string }> {
  const undo_token = row.undoable ? newUndoToken() : undefined;
  const { data, error } = await ctx.admin
    .from('activity_feed')
    .insert({
      trip_id: row.trip_id,
      actor_user_id: ctx.userId,
      actor_agent: ctx.actor === 'agent',
      kind: row.kind,
      // private: true → la fila (con el detalle en inverse) solo la ve quien la hizo (RLS); el resto ve busy_changed.
      payload: row.private ? { ...row.payload, private: true } : row.payload,
      undo_token: undo_token ?? null,
    })
    .select('id')
    .single();
  if (error) throw dbError(error, 'activity_feed');
  return { feed_id: data.id as string, undo_token };
}

/**
 * Realtime no emite cambios de bloques privados ajenos (RLS). Avisamos con una fila sin detalles por día
 * afectado para que los demás refresquen blocks_visible.
 */
export async function emitBusyChanged(ctx: ToolCtx, tripId: string, touched: Touched[]): Promise<void> {
  const days = new Set<string>();
  for (const t of touched) if (t.is_private) for (const d of t.day_ids) if (d) days.add(d);
  if (!days.size) return;
  const { error } = await ctx.admin.from('activity_feed').insert(
    [...days].map((day_id) => ({
      trip_id: tripId,
      actor_user_id: ctx.userId,
      actor_agent: ctx.actor === 'agent',
      kind: 'busy_changed' satisfies FeedKind,
      payload: { summary: 'Cambió la agenda de alguien', day_id },
      undo_token: null,
    })),
  );
  if (error) throw dbError(error, 'activity_feed busy_changed');
}

// ---------- textos para el feed (rioplatense) ----------

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** '2026-10-18' → 'dom 18/10' */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return 'el banco de ideas';
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d}/${m}`;
}

export async function actorLabel(ctx: ToolCtx): Promise<string> {
  if (ctx.actor === 'agent') return SCOUT.name;
  const { data } = await ctx.admin.from('profiles').select('display_name').eq('id', ctx.userId).maybeSingle();
  return (data?.display_name as string | undefined)?.split(' ')[0] || 'Alguien';
}

export async function dayDate(admin: Db, dayId: string | null | undefined): Promise<string | null> {
  if (!dayId) return null;
  const { data } = await admin.from('days').select('date').eq('id', dayId).maybeSingle();
  return (data?.date as string | undefined) ?? null;
}

/** Título que se puede mostrar en el feed (que ven todos los miembros): los privados no se nombran. */
export function feedTitle(b: { title: string; is_private: boolean }): string {
  return b.is_private ? 'un bloque privado' : `«${b.title}»`;
}
