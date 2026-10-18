import { describe, expect, it } from 'vitest';
import { fakeDb } from './fakeDb';
import { report_late } from './report_late';
import type { ToolCtx } from './types';
import { undo } from './undo';

const TRIP = 'trip';
function setup(blockOver: Record<string, unknown> = {}) {
  const db = fakeDb({
    trip_members: [
      { trip_id: TRIP, user_id: 'juan', role: 'traveler' },
      { trip_id: TRIP, user_id: 'fan', role: 'follower' },
    ],
    profiles: [{ id: 'juan', display_name: 'Juan Pérez' }],
    blocks: [{ id: 'blk', trip_id: TRIP, leg_id: 'leg', day_id: 'd1', title: 'Almuerzo', is_private: false, created_by: 'ana', ...blockOver }],
    block_participants: [{ block_id: 'blk', user_id: 'juan' }],
    activity_feed: [],
  });
  const ctx = (userId = 'juan', actor: 'user' | 'agent' = 'user') => ({ userId, actor, db, admin: db }) as unknown as ToolCtx;
  return { db, ctx };
}
const input = { trip_id: TRIP, block_id: 'blk', late_by_min: 10 };

describe('report_late', () => {
  it('escribe running_late con resumen, payload y undo_token', async () => {
    const { db, ctx } = setup();
    const r = await report_late(input, ctx());
    expect(r.undo_token).toBeTruthy();
    expect(r.data).toMatchObject({ summary: 'Juan llega 10 min tarde a Almuerzo' });
    const row = db.tables.activity_feed[0];
    expect(row).toMatchObject({ kind: 'running_late', actor_user_id: 'juan', actor_agent: false });
    expect(row.payload).toMatchObject({ block_id: 'blk', late_by_min: 10, day_id: 'd1' });
    expect((row.payload as Record<string, unknown>).private).toBeUndefined();
  });

  it('por voz (agent) el aviso sigue siendo de la persona', async () => {
    const { db, ctx } = setup();
    await report_late(input, ctx('juan', 'agent'));
    expect(db.tables.activity_feed[0]).toMatchObject({ actor_agent: true, payload: { summary: 'Juan llega 10 min tarde a Almuerzo' } });
  });

  it('un aviso nuevo reemplaza al anterior del mismo bloque', async () => {
    const { db, ctx } = setup();
    await report_late(input, ctx());
    await report_late({ ...input, late_by_min: 20 }, ctx());
    expect(db.tables.activity_feed).toHaveLength(1);
    expect((db.tables.activity_feed[0].payload as { late_by_min: number }).late_by_min).toBe(20);
  });

  it('bloque privado propio → private:true; privado ajeno → 403; seguidor → 403', async () => {
    const mine = setup({ is_private: true, created_by: 'juan' });
    await report_late(input, mine.ctx());
    expect((mine.db.tables.activity_feed[0].payload as { private?: boolean }).private).toBe(true);

    const other = setup({ is_private: true, created_by: 'ana' });
    other.db.tables.block_participants = [];
    await expect(report_late(input, other.ctx())).rejects.toMatchObject({ status: 403 });

    const fan = setup();
    await expect(report_late(input, fan.ctx('fan'))).rejects.toMatchObject({ status: 403 });
  });

  it('deshacer borra el aviso', async () => {
    const { db, ctx } = setup();
    const r = await report_late(input, ctx());
    await undo({ undo_token: r.undo_token! }, ctx());
    expect(db.tables.activity_feed.filter((f) => f.kind === 'running_late')).toHaveLength(0);
    expect(db.tables.activity_feed.filter((f) => f.kind === 'undo')).toHaveLength(1);
  });
});
