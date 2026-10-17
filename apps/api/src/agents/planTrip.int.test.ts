// Integración del job plan_trip contra Supabase local (seed de demo) con Claude MOCKEADO (no gasta tokens).
// Se saltea solo si no hay Supabase local corriendo / apps/api/.env.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TRIP_ID, DEMO_USERS, type PlanTripResult, type ToolInput } from '@build101/shared';
import type { ToolCtx } from '../tools/types';
import type { PlannerConfig, PlannerLLM, RunnerTool } from './llm';
import type { TripSkeleton } from './schemas';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(envPath) && !process.env.SUPABASE_URL) process.loadEnvFile(envPath);

async function supabaseUp(): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_ANON_KEY ?? '' }, signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}
const up = await supabaseUp();

const { juan } = DEMO_USERS;
const config: PlannerConfig = {
  effort: 'medium',
  webSearch: false,
  maxTokens: 1000,
  maxIterations: 5,
  legTimeoutMs: 5000,
  fallbacks: false,
  concurrency: 3,
};

const SKELETON: TripSkeleton = {
  title: 'Montevideo + Buenos Aires (test)',
  start_date: '2026-10-17',
  end_date: '2026-10-20',
  legs: [
    { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-17', end_date: '2026-10-18', includes_organizer: true, participant_names: ['Leo'], parallel_with: [], why: '' },
    { key: 'bsas', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-19', end_date: '2026-10-20', includes_organizer: true, participant_names: ['Leo', 'Pancho'], parallel_with: [], why: '' },
  ],
  transfers: [{ from_key: 'mvd', to_key: 'bsas', date: '2026-10-19', mode: 'ferry', duration_min: 180, participant_names: [] }],
  assumptions: ['Asumí 2 noches en cada ciudad.'],
};

type Calls = { skeleton: number; legs: string[] };

/** Claude falso: el esqueleto fijo y, por tramo, 3 add_block por día usando las herramientas reales. */
function mockLLM(calls: Calls, opts: { failCity?: string; delayMs?: number } = {}): PlannerLLM {
  return {
    async skeleton() {
      calls.skeleton++;
      return { skeleton: SKELETON, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 } };
    },
    async fillLeg({ system, tools }) {
      const ctxText = system.map((s) => s.text).join('\n');
      const city = /Tramo: ([^,]+),/.exec(ctxText)![1];
      calls.legs.push(city);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (city === opts.failCity) throw new Error('Google respondió 500');
      const trip_id = /trip_id: (\S+)/.exec(ctxText)![1];
      const leg_id = /leg_id: (\S+)/.exec(ctxText)![1];
      const dayIds = [...ctxText.matchAll(/day_id ([0-9a-f-]{36})/g)].map((m) => m[1]);
      const add = tools.find((t) => t.name === 'add_block') as RunnerTool & { parse: (x: unknown) => unknown; run: (x: unknown) => Promise<string> };
      for (const [i, day_id] of dayIds.entries()) {
        const blocks: Partial<ToolInput<'add_block'>>[] = [
          ...(i === 0 ? [{ type: 'lodging' as const, title: `Hotel en ${city}`, status: 'idea' as const, time_flex: 'evening' as const }] : []),
          { type: 'activity', title: `Paseo ${i}`, google_place_id: `gp-${i}`, place_name: 'Plaza', lat: -34.9, lng: -56.2, time_flex: 'morning' },
          { type: 'meal', title: `Almuerzo ${i}`, time_flex: 'afternoon' },
          { type: 'meal', title: `Cena ${i}`, time_flex: 'evening' },
        ];
        for (const b of blocks) {
          const out = JSON.parse(await add.run(add.parse({ trip_id, leg_id, day_id, ...b })));
          expect(out).toMatchObject({ ok: true, mode: 'applied' });
        }
      }
      // escribir en otro tramo está prohibido dentro del runner
      const other = JSON.parse(await add.run(add.parse({ trip_id, leg_id: '00000000-0000-0000-0000-00000000dead', day_id: null, type: 'free', title: 'x' })));
      expect(other.ok).toBe(false);
      return { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, web_search_requests: 0 }, iterations: 3, text: 'Listo.' };
    },
  };
}

describe.skipIf(!up)('plan_trip (integración, Supabase local + Claude mock)', async () => {
  const { serviceClient } = await import('../supabase');
  const { startPlanTrip } = await import('./planTrip');
  const { runTool } = await import('../tools/registry');
  const admin = serviceClient();
  const ctx: ToolCtx = { userId: juan, actor: 'user', db: admin, admin };
  const deps = (llm: PlannerLLM) => ({
    llm,
    config,
    today: () => '2026-10-15',
    resolveCity: async (city: string) => ({ google_place_id: `city-${city}`, lat: -34.9, lng: -56.2 }),
    driveMinutes: async () => null,
    heartbeatMs: 400,
  });
  const created: string[] = [];
  const input = (over: Partial<ToolInput<'plan_trip'>> = {}): ToolInput<'plan_trip'> => ({
    conversation: [
      { role: 'assistant', text: '¡Buenas! ¿A dónde quieren ir?' },
      { role: 'user', text: 'Montevideo y Buenos Aires, 4 días, con Leo y Pancho' },
    ],
    ...over,
  });

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = ''; // por las dudas: nada de llamadas reales
  });
  afterAll(async () => {
    if (created.length) await admin.from('trips').delete().in('id', created);
  });

  it('viaje nuevo: crea viaje, tramos, días, traslado y bloques; job done; trip_planned deshace todo', async () => {
    const calls: Calls = { skeleton: 0, legs: [] };
    const t0 = Date.now();
    const start = await startPlanTrip(input(), ctx, deps(mockLLM(calls, { delayMs: 900 })));
    expect(Date.now() - t0).toBeLessThan(1500);
    created.push(start.trip_id);

    // setup: viaje en planning con Juan organizer + job queued
    const { data: trip } = await admin.from('trips').select('*').eq('id', start.trip_id).single();
    expect(trip).toMatchObject({ status: 'planning', created_by: juan });
    const { data: tm } = await admin.from('trip_members').select('user_id,role').eq('trip_id', start.trip_id);
    expect(tm).toEqual([{ user_id: juan, role: 'organizer' }]);

    await start.run();
    expect(calls.skeleton).toBe(1);
    expect(calls.legs.sort()).toEqual(['Buenos Aires', 'Montevideo']);

    const { data: job } = await admin.from('agent_jobs').select('*').eq('id', start.job_id).single();
    expect(job.status).toBe('done');
    expect(job.error).toBeNull();
    const result = job.result as PlanTripResult;
    // 2 tramos × 2 días × 3 bloques + 2 lodging + 1 traslado
    expect(result).toMatchObject({ legs: 2, days: 4, blocks: 15, assumptions: ['Asumí 2 noches en cada ciudad.'] });
    expect(result.participants_hint.map((h) => h.names)).toEqual([['Leo'], ['Leo', 'Pancho']]);
    const texts = (job.progress as { text: string }[]).map((p) => p.text);
    expect(texts).toContain('Armé 2 tramos: Montevideo (17–18/10), Buenos Aires (19–20/10)');
    expect(texts.some((t) => t.startsWith('Agregué Ferry a Buenos Aires al lun 19/10'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Sigo armando'))).toBe(true); // heartbeat
    expect(texts.at(-1)).toBe('¡Listo! 2 tramos, 4 días, 15 bloques');

    const { data: trip2 } = await admin.from('trips').select('title,start_date,end_date').eq('id', start.trip_id).single();
    expect(trip2).toEqual({ title: SKELETON.title, start_date: '2026-10-17', end_date: '2026-10-20' });

    const { data: legs } = await admin.from('legs').select('id,city,sort_order,google_place_id').eq('trip_id', start.trip_id).order('sort_order');
    expect(legs!.map((l) => [l.city, l.sort_order, l.google_place_id])).toEqual([
      ['Montevideo', 0, 'city-Montevideo'],
      ['Buenos Aires', 1, 'city-Buenos Aires'],
    ]);
    const { data: lm } = await admin.from('leg_members').select('leg_id,user_id').in('leg_id', legs!.map((l) => l.id));
    expect(lm).toHaveLength(2); // solo Juan en cada tramo (Leo no es miembro de este viaje)

    const { data: blocks } = await admin.from('blocks').select('*').eq('trip_id', start.trip_id);
    expect(blocks).toHaveLength(15);
    expect(blocks!.every((b) => b.created_by_agent && b.created_by === juan)).toBe(true);
    const transfer = blocks!.find((b) => b.type === 'transfer')!;
    expect(transfer.transfer).toMatchObject({ from: 'Montevideo', to: 'Buenos Aires', mode: 'ferry', duration_min: 180 });
    expect(transfer.leg_id).toBe(legs![1].id);

    // sin propuestas ni filas de feed por bloque: una sola trip_planned
    const { data: props } = await admin.from('agent_proposals').select('id').eq('trip_id', start.trip_id);
    expect(props).toHaveLength(0);
    const { data: feed } = await admin.from('activity_feed').select('kind,undo_token,actor_agent').eq('trip_id', start.trip_id);
    expect(feed).toEqual([{ kind: 'trip_planned', undo_token: result.undo_token, actor_agent: true }]);

    // retry sobre un viaje con todos los tramos llenos → 409 trip_not_empty
    await expect(startPlanTrip(input({ trip_id: start.trip_id }), ctx, deps(mockLLM(calls)))).rejects.toMatchObject({
      status: 409,
      code: 'trip_not_empty',
    });

    // Deshacer: el viaje queda vacío
    const undo = await runTool('undo', { undo_token: result.undo_token }, ctx);
    expect(undo.body.ok).toBe(true);
    const [{ count: nLegs }, { count: nBlocks }] = await Promise.all([
      admin.from('legs').select('id', { count: 'exact', head: true }).eq('trip_id', start.trip_id),
      admin.from('blocks').select('id', { count: 'exact', head: true }).eq('trip_id', start.trip_id),
    ]);
    expect([nLegs, nBlocks]).toEqual([0, 0]);
  });

  it('falla en un tramo: job failed con error legible, lo escrito queda, Reintentar completa solo el vacío', async () => {
    const calls: Calls = { skeleton: 0, legs: [] };
    const start = await startPlanTrip(input(), ctx, deps(mockLLM(calls, { failCity: 'Buenos Aires' })));
    created.push(start.trip_id);
    await start.run();
    const { data: job } = await admin.from('agent_jobs').select('*').eq('id', start.job_id).single();
    expect(job.status).toBe('failed');
    expect(job.error).toContain('Google respondió 500');
    const r1 = job.result as PlanTripResult;
    expect(r1.failed_legs?.map((f) => f.city)).toEqual(['Buenos Aires']);
    expect(r1.undo_token).toBeTruthy();

    const { data: legs } = await admin.from('legs').select('id,city').eq('trip_id', start.trip_id);
    const bsas = legs!.find((l) => l.city === 'Buenos Aires')!;
    // solo el traslado quedó en Buenos Aires → borrarlo para simular tramo vacío
    await admin.from('blocks').delete().eq('leg_id', bsas.id);

    const calls2: Calls = { skeleton: 0, legs: [] };
    const retry = await startPlanTrip(input({ trip_id: start.trip_id }), ctx, deps(mockLLM(calls2)));
    expect(retry.trip_id).toBe(start.trip_id);
    await retry.run();
    expect(calls2).toEqual({ skeleton: 0, legs: ['Buenos Aires'] });
    const { data: job2 } = await admin.from('agent_jobs').select('status,result').eq('id', retry.job_id).single();
    expect(job2!.status).toBe('done');
    expect((job2!.result as PlanTripResult).participants_hint).toEqual(r1.participants_hint); // se conservan los del viaje
    const { count } = await admin.from('blocks').select('id', { count: 'exact', head: true }).eq('leg_id', bsas.id);
    expect(count).toBe(7);
  });

  it('permisos: un viajero no organizer no puede planificar el viaje de demo', async () => {
    const anaCtx: ToolCtx = { ...ctx, userId: DEMO_USERS.ana };
    await expect(startPlanTrip(input({ trip_id: DEMO_TRIP_ID }), anaCtx, deps(mockLLM({ skeleton: 0, legs: [] })))).rejects.toMatchObject({
      status: 403,
    });
  });
});
