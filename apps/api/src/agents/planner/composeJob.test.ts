// compose_days (PRD 31): Supabase en memoria + módulos del planificador falsos.
import { describe, expect, it } from 'vitest';
import type { ComposeDaysResult } from '@build101/shared';
import { runTool } from '../../tools/registry';
import { startComposeDays } from './composeJob';
import { picksFromReactions } from './runtime';
import { catalogItems, ctxFor, FakeDb, fakeModules, seedLeg, seedOptions, seedTrip, U } from './orchestrationTestKit';

function setup() {
  const fake = new FakeDb();
  const tripId = seedTrip(fake);
  const mvd = seedLeg(fake, tripId, { city: 'Montevideo', members: [U.juan, U.sofi] });
  const options = seedOptions(fake, tripId, mvd.legId);
  const { m, calls } = fakeModules();
  const deps = { planner: async () => m, composeDeps: () => ({ searchPlaces: async () => [] }), forecast: async () => ({ available: false as const, from: '2026-11-02' }), heartbeatMs: 60_000 };
  return { fake, tripId, mvd, options, calls, deps };
}

describe('compose_days', () => {
  it('arma con lo que eligió el grupo: no saca, must suma, choice_group compartido y undo', async () => {
    const { fake, tripId, mvd, options, calls, deps } = setup();
    // Traslado de llegada (no cuenta como "armado")
    fake.seed('blocks', [{ trip_id: tripId, leg_id: mvd.legId, day_id: mvd.dayIds[0], type: 'transfer', title: 'Ferry', duration_min: 180, start_time: null }]);
    const [mercado, solis] = options;
    const lugar3 = options[6];
    fake.seed('leg_option_reactions', [
      { option_id: solis.id, trip_id: tripId, user_id: U.sofi, reaction: 'no' }, // imperdible que el grupo saca
      { option_id: lugar3.id, trip_id: tripId, user_id: U.sofi, reaction: 'must' }, // no preseleccionada, sí o sí
      { option_id: mercado.id, trip_id: tripId, user_id: U.juan, reaction: 'love' },
    ]);
    const ctx = ctxFor(fake, U.sofi);
    const start = await startComposeDays({ trip_id: tripId, instruction: 'más tranqui' }, ctx, deps);
    expect(start.leg_ids).toEqual([mvd.legId]);
    await start.run();

    const job = fake.rows('agent_jobs').find((j) => j.id === start.job_id)!;
    expect(job).toMatchObject({ kind: 'compose_days', status: 'done' });
    expect(calls.compose).toHaveLength(1);
    expect(calls.compose[0].instruction).toBe('más tranqui');
    expect(calls.compose[0].picks.sort()).toEqual([mercado.item.id, options[2].item.id, lugar3.item.id].sort());

    const result = job.result as ComposeDaysResult;
    expect(result).toMatchObject({ blocks: 3 + 4, choices: 2 });
    expect(result.coverage[0]).toMatchObject({ city: 'Montevideo', must_total: 3, must_covered: 2 });
    const created = fake.rows('blocks').filter((b) => b.type !== 'transfer');
    expect(created).toHaveLength(7);
    expect(created.every((b) => b.created_by === U.sofi && b.created_by_agent === true)).toBe(true);
    const cenas = created.filter((b) => b.type === 'meal');
    expect(new Set(cenas.map((c) => c.choice_group)).size).toBe(2);
    expect(cenas.every((c) => c.choice_group && c.status === 'proposed')).toBe(true);

    // Sin propuestas ni feed por bloque: una fila days_composed deshacible
    expect(fake.rows('agent_proposals')).toHaveLength(0);
    const feed = fake.rows('activity_feed');
    expect(feed.map((f) => f.kind)).toEqual(['days_composed']);
    expect(feed[0].undo_token).toBe(result.undo_token);

    // Ya armado → 409
    await expect(startComposeDays({ trip_id: tripId }, ctx, deps)).rejects.toMatchObject({ status: 409, code: 'trip_not_empty' });

    // Deshacer: vuelve a quedar solo el traslado
    const undo = await runTool('undo', { undo_token: result.undo_token }, ctx);
    expect(undo.body.ok).toBe(true);
    expect(fake.rows('blocks').map((b) => b.type)).toEqual(['transfer']);
  });

  it('409 trip_not_empty si no hay tramos con menú', async () => {
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    seedLeg(fake, tripId);
    await expect(startComposeDays({ trip_id: tripId }, ctxFor(fake, U.juan))).rejects.toMatchObject({ status: 409, code: 'trip_not_empty' });
  });

  it('permisos: seguidor 403, viajero fuera del tramo 403, organizador sí', async () => {
    const { fake, tripId, mvd, deps } = setup();
    await expect(startComposeDays({ trip_id: tripId }, ctxFor(fake, U.tito), deps)).rejects.toMatchObject({ status: 403 });
    await expect(startComposeDays({ trip_id: tripId, leg_ids: [mvd.legId] }, ctxFor(fake, U.leo), deps)).rejects.toMatchObject({ status: 403 });
    // Leo sin leg_ids: no tiene tramos propios con menú → 409
    await expect(startComposeDays({ trip_id: tripId }, ctxFor(fake, U.leo), deps)).rejects.toMatchObject({ status: 409 });
    const ok = await startComposeDays({ trip_id: tripId }, ctxFor(fake, U.juan), deps);
    expect(ok.leg_ids).toEqual([mvd.legId]);
  });

  it('picks: optionIncluded + afinidad por reacciones', () => {
    const fake = new FakeDb();
    const opts = seedOptions(fake, 't', 'l', catalogItems().slice(0, 4));
    const picks = picksFromReactions(opts, [
      { option_id: opts[0].id, user_id: 'a', reaction: 'no' },
      { option_id: opts[0].id, user_id: 'b', reaction: 'must' },
      { option_id: opts[3].id, user_id: 'a', reaction: 'love' },
    ]);
    expect(picks.map((p) => p.item.id)).toEqual([opts[0], opts[1], opts[2], opts[3]].map((o) => o.item.id));
    expect(picks[0]).toMatchObject({ must: true, for_user_ids: ['b'] });
    expect(picks[0].score).toBeCloseTo(0.7);
    expect(picks[3].score).toBeCloseTo(0.6);
  });
});
