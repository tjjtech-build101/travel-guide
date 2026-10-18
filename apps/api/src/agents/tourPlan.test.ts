// Tour listo → bloque `tour` en el plan del día, con la regla de escritura de add_block.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { todayIso } from './dates';
import { ctxFor, FakeDb, seedLeg, seedTrip, U } from './planner/orchestrationTestKit';
import { attachTourToPlan, localStartHHMM } from './tourPlan';

const now = new Date('2026-10-18T18:42:00Z'); // 15:42 en Montevideo

function setup(dates = [todayIso(now)]) {
  const fake = new FakeDb();
  const tripId = seedTrip(fake);
  const { legId, dayIds } = seedLeg(fake, tripId, { members: [U.juan, U.sofi], dates });
  const base = { tourId: randomUUID(), tripId, blockId: null, title: 'Fantasmas de la Ciudad Vieja', durationMin: 75, start: now, lat: -34.9, lng: -56.2 };
  return { fake, tripId, legId, dayIds, base };
}

describe('attachTourToPlan', () => {
  it('redondea el inicio a los 5 min en la zona del viaje', () => {
    expect(localStartHHMM(now)).toBe('15:45');
  });

  it('tour solo para mí: se aplica como bloque tour de hoy con tour_id', async () => {
    const { fake, dayIds, base } = setup();
    const link = await attachTourToPlan(ctxFor(fake, U.juan, 'agent'), { ...base, participantIds: [U.juan] });
    expect(link).toMatchObject({ mode: 'applied', start_time: '15:45' });
    const b = fake.rows('blocks')[0];
    expect(b).toMatchObject({ type: 'tour', tour_id: base.tourId, day_id: dayIds[0], start_time: '15:45', end_time: '17:00:00' });
    expect(fake.rows('activity_feed').map((f) => f.kind)).toContain('block_added');
  });

  it('tour del grupo pedido al Scout: queda propuesta con tour_id adentro', async () => {
    const { fake, base } = setup();
    const link = await attachTourToPlan(ctxFor(fake, U.juan, 'agent'), { ...base, participantIds: [U.juan, U.sofi] });
    expect(link.mode).toBe('proposed');
    expect(fake.rows('blocks')).toHaveLength(0);
    const p = fake.rows('agent_proposals')[0] as { ops: { op: string; block: Record<string, unknown> }[] };
    expect(p.ops[0].block).toMatchObject({ type: 'tour', tour_id: base.tourId });
  });

  it('pedido desde un bloque: enlaza ese bloque; hoy fuera del viaje: no agrega nada', async () => {
    const { fake, tripId, legId, dayIds, base } = setup();
    const blockId = randomUUID();
    fake.seed('blocks', [{ id: blockId, trip_id: tripId, leg_id: legId, day_id: dayIds[0], type: 'tour', title: 'Tour', sort_order: 0 }]);
    expect(await attachTourToPlan(ctxFor(fake, U.juan), { ...base, blockId, participantIds: [U.juan] })).toMatchObject({ mode: 'linked', block_id: blockId });
    expect(fake.rows('blocks')[0].tour_id).toBe(base.tourId);

    const other = setup(['2026-12-01']);
    expect(await attachTourToPlan(ctxFor(other.fake, U.juan), { ...other.base, participantIds: [U.juan] })).toMatchObject({ mode: 'none' });
    expect(other.fake.rows('blocks')).toHaveLength(0);
  });
});
