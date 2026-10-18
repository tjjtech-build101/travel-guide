// decide_proposal (PRD 11) contra el Supabase en memoria: el Scout propone sobre lo compartido y una persona decide.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ctxFor, FakeDb, seedLeg, seedTrip, U } from '../agents/planner/orchestrationTestKit';
import { runTool } from './registry';

function setup() {
  const fake = new FakeDb();
  const tripId = seedTrip(fake);
  const { legId, dayIds } = seedLeg(fake, tripId, { members: [U.juan, U.sofi] });
  const blockId = randomUUID();
  fake.seed('blocks', [
    {
      id: blockId,
      trip_id: tripId,
      leg_id: legId,
      day_id: dayIds[0],
      type: 'meal',
      title: 'Almuerzo en el Mercado',
      start_time: '13:00:00',
      end_time: '14:00:00',
      duration_min: 60,
      status: 'confirmed',
      is_private: false,
      sort_order: 0,
    },
  ]);
  fake.seed('block_participants', [U.juan, U.sofi].map((user_id) => ({ block_id: blockId, user_id })));
  return { fake, tripId, legId, dayIds, blockId };
}

/** El Scout (actor agent, en nombre de Juan) agrega algo compartido → queda propuesta. */
async function scoutProposesAdd(fake: FakeDb, tripId: string, legId: string, dayId: string) {
  const res = await runTool(
    'add_block',
    { trip_id: tripId, leg_id: legId, day_id: dayId, type: 'tour', title: 'Tour por la Ciudad Vieja', start_time: '15:00', duration_min: 90 },
    ctxFor(fake, U.juan, 'agent'),
  );
  expect(res.body.ok).toBe(true);
  const data = (res.body as { data: { mode: string; proposal_id: string } }).data;
  expect(data.mode).toBe('proposed');
  return data.proposal_id;
}

const decide = (fake: FakeDb, user: string, input: Record<string, unknown>, actor: 'user' | 'agent' = 'user') =>
  runTool('decide_proposal', input, ctxFor(fake, user, actor));

describe('decide_proposal', () => {
  it('aceptar aplica el bloque propuesto (confirmado, del agente), deja feed deshacible y undo lo saca', async () => {
    const { fake, tripId, legId, dayIds } = setup();
    const proposalId = await scoutProposesAdd(fake, tripId, legId, dayIds[0]);
    expect(fake.rows('blocks')).toHaveLength(1); // proponer no toca blocks

    const res = await decide(fake, U.sofi, { proposal_id: proposalId, decision: 'accept' });
    expect(res.status).toBe(200);
    const body = res.body as { ok: true; data: { status: string; applied_block_ids: string[] }; undo_token: string };
    expect(body.data.status).toBe('accepted');
    expect(body.data.applied_block_ids).toHaveLength(1);
    expect(body.undo_token).toBeTruthy();

    const added = fake.rows('blocks').find((b) => b.id === body.data.applied_block_ids[0])!;
    expect(added).toMatchObject({ title: 'Tour por la Ciudad Vieja', type: 'tour', status: 'confirmed', created_by_agent: true, day_id: dayIds[0] });
    expect(fake.rows('block_participants').filter((r) => r.block_id === added.id).map((r) => r.user_id).sort()).toEqual([U.juan, U.sofi].sort());
    expect(fake.rows('agent_proposals')[0]).toMatchObject({ status: 'accepted', decided_by: U.sofi });
    const feed = fake.rows('activity_feed').find((f) => f.kind === 'proposal_accepted')!;
    expect(feed).toMatchObject({ actor_user_id: U.sofi });
    expect((feed.payload as { summary: string }).summary).toMatch(/^Sofía aceptó: /);

    const undone = await runTool('undo', { undo_token: body.undo_token }, ctxFor(fake, U.sofi));
    expect(undone.body.ok).toBe(true);
    expect(fake.rows('blocks').some((b) => b.id === added.id)).toBe(false);
  });

  it('aceptar un cambio (update) y un move: aplica con duración y deshace al valor previo', async () => {
    const { fake, tripId, dayIds, blockId } = setup();
    const scout = ctxFor(fake, U.juan, 'agent');
    const r1 = await runTool('update_block', { block_id: blockId, patch: { title: 'Almuerzo en Jacinto' } }, scout);
    const r2 = await runTool('move_block', { block_id: blockId, day_id: dayIds[1], start_time: '12:30' }, scout);
    const p1 = (r1.body as { data: { proposal_id: string } }).data.proposal_id;
    const p2 = (r2.body as { data: { proposal_id: string } }).data.proposal_id;
    // Relojes explícitos: p1 se armó antes de que alguien tocara el bloque; p2, después de todo lo previo.
    const at = (id: string, ms: number) => (fake.rows('agent_proposals').find((p) => p.id === id)!.created_at = new Date(Date.now() + ms).toISOString());
    at(p1, -60_000);
    at(p2, 1_000);
    fake.rows('blocks')[0].updated_at = new Date(Date.now() - 120_000).toISOString();

    const a = await decide(fake, U.juan, { proposal_id: p2, decision: 'accept' });
    expect((a.body as { data: { status: string } }).data.status).toBe('accepted');
    expect(fake.rows('blocks')[0]).toMatchObject({ day_id: dayIds[1], start_time: '12:30:00', end_time: '13:30:00' });

    // p1 se armó antes de que el bloque cambiara → venció.
    const b = await decide(fake, U.juan, { proposal_id: p1, decision: 'accept' });
    expect((b.body as { data: { status: string } }).data.status).toBe('expired');
    expect(fake.rows('agent_proposals').find((p) => p.id === p1)!.status).toBe('expired');
    expect(fake.rows('blocks')[0].title).toBe('Almuerzo en el Mercado');
    expect(fake.rows('activity_feed').some((f) => f.kind === 'proposal_expired')).toBe(true);

    await runTool('undo', { undo_token: (a.body as { undo_token: string }).undo_token }, ctxFor(fake, U.juan));
    expect(fake.rows('blocks')[0]).toMatchObject({ day_id: dayIds[0], start_time: '13:00:00', end_time: '14:00:00' });
  });

  it('rechazar no toca el plan; decidir de nuevo → 409', async () => {
    const { fake, tripId, legId, dayIds } = setup();
    const proposalId = await scoutProposesAdd(fake, tripId, legId, dayIds[0]);
    const r = await decide(fake, U.sofi, { proposal_id: proposalId, decision: 'reject', note: 'ya fuimos' });
    expect((r.body as { data: { status: string } }).data.status).toBe('rejected');
    expect(fake.rows('blocks')).toHaveLength(1);
    expect(fake.rows('activity_feed').some((f) => f.kind === 'proposal_rejected')).toBe(true);
    const again = await decide(fake, U.juan, { proposal_id: proposalId, decision: 'accept' });
    expect(again.status).toBe(409);
    expect(fake.rows('blocks')).toHaveLength(1);
  });

  it('por voz: sin proposal_id decide la pendiente más reciente del viaje', async () => {
    const { fake, tripId, legId, dayIds } = setup();
    const older = await scoutProposesAdd(fake, tripId, legId, dayIds[0]);
    fake.rows('agent_proposals').find((p) => p.id === older)!.created_at = new Date(Date.now() - 60_000).toISOString();
    const newer = await scoutProposesAdd(fake, tripId, legId, dayIds[1]);
    const r = await decide(fake, U.juan, { trip_id: tripId, decision: 'accept' }, 'agent');
    expect((r.body as { data: { proposal_id: string } }).data.proposal_id).toBe(newer);
    expect(fake.rows('agent_proposals').find((p) => p.id === older)!.status).toBe('pending');
    expect(await decide(fake, U.juan, { decision: 'accept' }).then((x) => x.status)).toBe(400);
  });

  it('permisos: seguidor 403, viajero fuera del tramo 403, inexistente 404', async () => {
    const { fake, tripId, legId, dayIds } = setup();
    const proposalId = await scoutProposesAdd(fake, tripId, legId, dayIds[0]);
    expect((await decide(fake, U.tito, { proposal_id: proposalId, decision: 'accept' })).status).toBe(403);
    expect((await decide(fake, U.leo, { proposal_id: proposalId, decision: 'accept' })).status).toBe(403);
    expect((await decide(fake, U.juan, { proposal_id: randomUUID(), decision: 'accept' })).status).toBe(404);
    expect(fake.rows('agent_proposals')[0].status).toBe('pending');
  });

  it('vence a las 24 h y si el bloque ya no está', async () => {
    const { fake, tripId, legId, dayIds, blockId } = setup();
    const old = await scoutProposesAdd(fake, tripId, legId, dayIds[0]);
    fake.rows('agent_proposals').find((p) => p.id === old)!.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
    expect((await decide(fake, U.juan, { proposal_id: old, decision: 'accept' })).body).toMatchObject({ data: { status: 'expired' } });

    const rm = await runTool('remove_block', { block_id: blockId }, ctxFor(fake, U.juan, 'agent'));
    const pid = (rm.body as { data: { proposal_id: string } }).data.proposal_id;
    await runTool('remove_block', { block_id: blockId }, ctxFor(fake, U.juan)); // Juan lo saca a mano
    expect((await decide(fake, U.juan, { proposal_id: pid, decision: 'accept' })).body).toMatchObject({ data: { status: 'expired' } });
  });

  it('todo o nada: si una op falla, deshace lo aplicado y la propuesta sigue pending', async () => {
    const { fake, tripId, legId, dayIds, blockId } = setup();
    const pid = randomUUID();
    fake.seed('agent_proposals', [
      {
        id: pid,
        trip_id: tripId,
        leg_id: legId,
        day_id: dayIds[0],
        created_by: U.juan,
        by_agent: true,
        summary: 'Scout propone 2 cambios',
        status: 'pending',
        created_at: new Date(Date.now() + 1000).toISOString(),
        ops: [
          { op: 'update', block_id: blockId, patch: { title: 'Cambiado' } },
          { op: 'add', block: { trip_id: tripId, leg_id: legId, day_id: dayIds[0], type: 'activity', title: 'Nuevo', participant_ids: [U.juan] } },
        ],
      },
    ]);
    const from = fake.from.bind(fake);
    fake.from = (table: string) => {
      const q = from(table);
      if (table === 'blocks') {
        (q as unknown as { insert: () => never }).insert = () => {
          throw new Error('insert roto');
        };
      }
      return q;
    };
    const r = await decide(fake, U.juan, { proposal_id: pid, decision: 'accept' });
    expect(r.status).toBe(409);
    expect((r.body as { error: { code: string } }).error.code).toBe('apply_failed');
    expect(fake.rows('blocks')[0].title).toBe('Almuerzo en el Mercado');
    expect(fake.rows('agent_proposals')[0].status).toBe('pending');
    expect(fake.rows('activity_feed').some((f) => f.kind === 'proposal_accepted')).toBe(false);
  });
});
