import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDayLLM, PlanDayPlanT } from '../agents/planDay';
import { sanitizePlan } from '../agents/planDay';
import { fakeDb } from './fakeDb';
import { gapEnd, plan_day, planDayImpl } from './plan_day';
import type { ToolCtx } from './types';

const TRIP = 'trip';
function setup() {
  const db = fakeDb({
    trip_members: [{ trip_id: TRIP, user_id: 'juan', role: 'traveler' }],
    leg_members: [
      { leg_id: 'leg', user_id: 'juan' },
      { leg_id: 'leg', user_id: 'ana' },
    ],
    profiles: [{ id: 'juan', display_name: 'Juan' }],
    legs: [{ id: 'leg', trip_id: TRIP, city: 'Montevideo', lat: -34.9, lng: -56.2 }],
    days: [{ id: 'd1', leg_id: 'leg', date: '2026-10-18' }],
    blocks: [
      { id: 'b-cena', trip_id: TRIP, leg_id: 'leg', day_id: 'd1', title: 'Cena', start_time: '20:00', end_time: '21:30', is_private: false, sort_order: 0 },
      { id: 'idea1', trip_id: TRIP, leg_id: 'leg', day_id: null, title: 'Mercado del Puerto', type: 'meal', lat: -34.905, lng: -56.21, is_private: false },
    ],
    agent_proposals: [],
    activity_feed: [],
  });
  // Pedido de la persona (x-actor: user): igual tiene que quedar como propuesta.
  const ctx = { userId: 'juan', actor: 'user', db, admin: db } as unknown as ToolCtx;
  return { db, ctx };
}
const input = { trip_id: TRIP, day_id: 'd1', from_time: '15:00' };
const llmOf = (plan: PlanDayPlanT): PlanDayLLM => ({ plan: vi.fn(async () => plan) });

describe('plan_day', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('crea UNA propuesta (move para ideas del banco, add para lo nuevo) aunque lo pida la persona', async () => {
    const { db, ctx } = setup();
    const llm = llmOf({
      summary: 'Mercado y rambla',
      blocks: [
        { title: 'Mercado del Puerto', type: 'meal', start_time: '15:00', end_time: '16:00', idea_id: 'idea1', place_ref: null, description: null },
        { title: 'Paseo por la rambla', type: 'activity', start_time: '16:30', end_time: '18:00', idea_id: null, place_ref: null, description: 'Caminar' },
        { title: 'Pisa la cena', type: 'meal', start_time: '19:30', end_time: '20:30', idea_id: null, place_ref: null, description: null },
      ],
    });
    const r = await planDayImpl(input, ctx, llm);
    expect(r.data).toMatchObject({ mode: 'proposed', count: 2 });
    expect((r.data as { summary: string }).summary).toBe('Scout propone 2 planes para 15:00–20:00: Mercado y rambla');
    expect(r.undo_token).toBeTruthy();
    expect(db.tables.agent_proposals).toHaveLength(1);
    const p = db.tables.agent_proposals[0] as { ops: { op: string; block_id?: string; block?: Record<string, unknown> }[]; status: string; by_agent: boolean };
    expect(p.status).toBe('pending');
    expect(p.by_agent).toBe(true);
    expect(p.ops.map((o) => o.op)).toEqual(['move', 'add']);
    expect(p.ops[0].block_id).toBe('idea1');
    expect(p.ops[1].block).toMatchObject({ day_id: 'd1', start_time: '16:30:00', end_time: '18:00:00', created_by_agent: true, participant_ids: ['juan', 'ana'] });
    // Nada aplicado: los bloques siguen igual.
    expect(db.tables.blocks).toHaveLength(2);
    expect(db.tables.activity_feed[0]).toMatchObject({ kind: 'proposal_created', actor_agent: true });
  });

  it('no le pasa a Claude ideas ni bloques privados (la propuesta la ve todo el viaje)', async () => {
    const { db, ctx } = setup();
    db.tables.blocks.push(
      { id: 'idea-priv', trip_id: TRIP, leg_id: 'leg', day_id: null, title: 'Regalo sorpresa', type: 'activity', is_private: true, created_by: 'juan' },
      { id: 'b-priv', trip_id: TRIP, leg_id: 'leg', day_id: 'd1', title: 'Médico', start_time: '17:00', end_time: '17:30', is_private: true, created_by: 'juan', sort_order: 1 },
    );
    const plan = vi.fn(async () => ({
      summary: 'Regalo',
      blocks: [{ title: 'Regalo sorpresa', type: 'activity', start_time: '15:00', end_time: '16:00', idea_id: 'idea-priv', place_ref: null, description: null }],
    }));
    await planDayImpl(input, ctx, { plan } as PlanDayLLM).catch(() => null);
    const user = (plan.mock.calls[0] as unknown as [{ user: string }])[0].user;
    expect(user).not.toContain('Regalo sorpresa');
    expect(user).not.toContain('Médico');
    // Aunque el modelo invente el id, no entra en la propuesta.
    const ops = (db.tables.agent_proposals[0] as { ops: { block_id?: string }[] } | undefined)?.ops ?? [];
    expect(ops.some((o) => o.block_id === 'idea-priv')).toBe(false);
  });

  it('el hueco por defecto termina en el próximo bloque', () => {
    expect(gapEnd(15 * 60, [{ start_time: '20:00' }, { start_time: '10:00' }])).toBe(20 * 60);
    expect(gapEnd(15 * 60, [])).toBe(22 * 60);
    expect(gapEnd(15 * 60, [], '18:00')).toBe(18 * 60);
  });

  it('si Claude falla → 503 "Scout no está disponible ahora"', async () => {
    const { ctx } = setup();
    const llm: PlanDayLLM = { plan: async () => { throw new Error('credit balance too low'); } };
    await expect(planDayImpl(input, ctx, llm)).rejects.toMatchObject({ status: 503, code: 'scout_unavailable', message: 'Scout no está disponible ahora.' });
  });

  it('sin ANTHROPIC_API_KEY ni intenta', async () => {
    const { ctx } = setup();
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(plan_day(input, ctx)).rejects.toMatchObject({ code: 'scout_unavailable' });
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe('sanitizePlan', () => {
  const a = { from: 900, to: 1200, busy: [], ideaIds: new Set(['i1']), placeRefs: new Set(['p1']) };
  const item = { type: 'activity' as const, idea_id: null, place_ref: null, description: null };
  it('saca ideas inventadas o repetidas, refs desconocidas y superposiciones', () => {
    const out = sanitizePlan(
      {
        summary: '',
        blocks: [
          { ...item, title: 'A', start_time: '15:00', end_time: '16:00', idea_id: 'i1' },
          { ...item, title: 'A otra vez', start_time: '16:00', end_time: '16:30', idea_id: 'i1' },
          { ...item, title: 'Inventada', start_time: '17:00', end_time: '17:30', idea_id: 'zzz' },
          { ...item, title: 'Pisa A', start_time: '15:30', end_time: '16:15' },
          { ...item, title: 'Lugar raro', start_time: '18:00', end_time: '19:00', place_ref: 'p9' },
          { ...item, title: 'Tarde', start_time: '19:30', end_time: '20:30' },
        ],
      },
      a,
    );
    expect(out.map((o) => o.title)).toEqual(['A', 'Lugar raro']);
    expect(out[1].place_ref).toBeNull();
  });
});
