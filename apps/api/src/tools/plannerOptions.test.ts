// react_option / choose_option (PRD 31) contra el Supabase en memoria del kit del planificador.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ctxFor, FakeDb, seedLeg, seedOptions, seedTrip, U } from '../agents/planner/orchestrationTestKit';
import { runTool } from './registry';

describe('react_option', () => {
  function setup() {
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    const { legId } = seedLeg(fake, tripId, { members: [U.juan, U.sofi] });
    const [opt] = seedOptions(fake, tripId, legId);
    return { fake, tripId, opt };
  }

  it('viajero del tramo: reacciona, cambia y saca su reacción (upsert/delete)', async () => {
    const { fake, tripId, opt } = setup();
    const sofi = ctxFor(fake, U.sofi);
    const r1 = await runTool('react_option', { option_id: opt.id, reaction: 'love' }, sofi);
    expect(r1.body).toEqual({ ok: true, data: { option_id: opt.id, reaction: 'love' } });
    await runTool('react_option', { option_id: opt.id, reaction: 'must' }, sofi);
    expect(fake.rows('leg_option_reactions')).toMatchObject([{ option_id: opt.id, trip_id: tripId, user_id: U.sofi, reaction: 'must' }]);
    await runTool('react_option', { option_id: opt.id, reaction: 'no' }, ctxFor(fake, U.juan)); // organizador
    expect(fake.rows('leg_option_reactions')).toHaveLength(2);
    const r3 = await runTool('react_option', { option_id: opt.id, reaction: null }, sofi);
    expect(r3.body.ok).toBe(true);
    expect(fake.rows('leg_option_reactions').map((r) => r.user_id)).toEqual([U.juan]);
    expect(fake.rows('activity_feed')).toHaveLength(0); // sin feed: va por Realtime
  });

  it('permisos: seguidor 403, viajero fuera del tramo 403, opción inexistente 404', async () => {
    const { fake, opt } = setup();
    expect((await runTool('react_option', { option_id: opt.id, reaction: 'love' }, ctxFor(fake, U.tito))).status).toBe(403);
    expect((await runTool('react_option', { option_id: opt.id, reaction: 'love' }, ctxFor(fake, U.leo))).status).toBe(403);
    expect((await runTool('react_option', { option_id: randomUUID(), reaction: 'love' }, ctxFor(fake, U.juan))).status).toBe(404);
    expect((await runTool('react_option', { option_id: opt.id, reaction: 'meh' }, ctxFor(fake, U.juan))).status).toBe(400);
    expect(fake.rows('leg_option_reactions')).toHaveLength(0);
  });
});

describe('choose_option', () => {
  function setup() {
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    const { legId, dayIds } = seedLeg(fake, tripId, { members: [U.juan, U.sofi] });
    const group = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    fake.seed(
      'blocks',
      ids.map((id, i) => ({
        id,
        trip_id: tripId,
        leg_id: legId,
        day_id: dayIds[0],
        type: 'meal',
        title: `Cena ${i + 1}`,
        status: 'proposed',
        choice_group: group,
        time_flex: 'evening',
        sort_order: 5,
        created_by: U.juan,
        created_by_agent: true,
      })),
    );
    fake.seed('block_participants', ids.flatMap((block_id) => [U.juan, U.sofi].map((user_id) => ({ block_id, user_id }))));
    const solo = randomUUID();
    fake.seed('blocks', [{ id: solo, trip_id: tripId, leg_id: legId, day_id: dayIds[0], type: 'activity', title: 'Solo', status: 'confirmed' }]);
    return { fake, tripId, dayIds, ids, group, solo };
  }
  const byId = (fake: FakeDb, id: string) => fake.rows('blocks').find((b) => b.id === id)!;

  it('confirma la elegida, manda las otras al banco de ideas y el undo restaura todo', async () => {
    const { fake, dayIds, ids, group } = setup();
    const ctx = ctxFor(fake, U.sofi);
    const r = await runTool('choose_option', { block_id: ids[1] }, ctx);
    expect(r.body.ok).toBe(true);
    if (!r.body.ok) return;
    expect(r.body.data).toMatchObject({ mode: 'applied', block_id: ids[1], discarded_block_ids: [ids[0], ids[2]] });
    expect(byId(fake, ids[1])).toMatchObject({ status: 'confirmed', choice_group: null, day_id: dayIds[0] });
    for (const id of [ids[0], ids[2]]) expect(byId(fake, id)).toMatchObject({ status: 'idea', choice_group: null, day_id: null });
    const feed = fake.rows('activity_feed');
    expect(feed.map((f) => f.kind)).toEqual(['option_chosen']);
    expect((feed[0].payload as { summary: string }).summary).toBe('Sofía eligió «Cena 2»; las otras 2 quedaron en el banco de ideas');

    const undo = await runTool('undo', { undo_token: (r.body as { undo_token: string }).undo_token }, ctx);
    expect(undo.body.ok).toBe(true);
    for (const id of ids) expect(byId(fake, id)).toMatchObject({ status: 'proposed', choice_group: group, day_id: dayIds[0] });
  });

  it('alojamiento elegido queda como idea', async () => {
    const { fake, ids } = setup();
    for (const id of ids) Object.assign(byId(fake, id), { type: 'lodging', status: 'idea' });
    await runTool('choose_option', { block_id: ids[0] }, ctxFor(fake, U.juan));
    expect(byId(fake, ids[0])).toMatchObject({ status: 'idea', choice_group: null });
  });

  it('sin choice_group → 409; seguidor o fuera del tramo → 403; el asistente lo deja propuesto', async () => {
    const { fake, ids, solo, group } = setup();
    expect((await runTool('choose_option', { block_id: solo }, ctxFor(fake, U.juan))).status).toBe(409);
    expect((await runTool('choose_option', { block_id: ids[0] }, ctxFor(fake, U.tito))).status).toBe(403);
    expect((await runTool('choose_option', { block_id: ids[0] }, ctxFor(fake, U.leo))).status).toBe(403);
    const r = await runTool('choose_option', { block_id: ids[0] }, ctxFor(fake, U.juan, 'agent'));
    expect(r.body).toMatchObject({ ok: true, data: { mode: 'proposed', block_id: ids[0] } });
    expect(fake.rows('agent_proposals')).toHaveLength(1);
    expect(byId(fake, ids[0]).choice_group).toBe(group); // nada aplicado todavía
  });
});
