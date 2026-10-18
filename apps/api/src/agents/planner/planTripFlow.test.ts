// plan_trip con el planificador colaborativo (PRD 31): Supabase en memoria + Claude y módulos del planificador falsos.
import { describe, expect, it } from 'vitest';
import type { PlanTripResult, ToolInput } from '@build101/shared';
import { runTool } from '../../tools/registry';
import type { PlannerConfig, PlannerLLM, RunnerTool } from '../llm';
import { startPlanTrip, type PlanDeps } from '../planTrip';
import { emptyUsage, type TripSkeleton } from '../schemas';
import { ctxFor, FakeDb, fakeModules, seedTrip, U } from './orchestrationTestKit';

const config: PlannerConfig = { effort: 'medium', webSearch: false, maxTokens: 1000, maxIterations: 5, legTimeoutMs: 5000, fallbacks: false, concurrency: 3 };

const SKELETON: TripSkeleton = {
  title: 'Montevideo + Buenos Aires',
  start_date: '2026-10-24',
  end_date: '2026-10-27',
  legs: [
    { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-24', end_date: '2026-10-25', includes_organizer: true, participant_names: ['Sofi'], parallel_with: [], why: '' },
    { key: 'bsas', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-26', end_date: '2026-10-27', includes_organizer: true, participant_names: [], parallel_with: [], why: '' },
  ],
  transfers: [{ from_key: 'mvd', to_key: 'bsas', date: '2026-10-26', mode: 'ferry', duration_min: 180, participant_names: [] }],
  assumptions: ['Asumí 2 noches en cada ciudad.'],
};

type Calls = { skeleton: number; fill: string[] };

/** Claude falso: esqueleto fijo y, por tramo, 2 add_block por día con las herramientas reales. */
function fakeLlm(calls: Calls): PlannerLLM {
  return {
    async skeleton() {
      calls.skeleton++;
      return { skeleton: SKELETON, usage: emptyUsage() };
    },
    async fillLeg({ system, tools }) {
      const text = system.map((s) => s.text).join('\n');
      calls.fill.push(/Tramo: ([^,]+),/.exec(text)![1]);
      const trip_id = /trip_id: (\S+)/.exec(text)![1];
      const leg_id = /leg_id: (\S+)/.exec(text)![1];
      const add = tools.find((t) => t.name === 'add_block') as RunnerTool & { parse: (x: unknown) => unknown; run: (x: unknown) => Promise<string> };
      for (const [, day_id] of text.matchAll(/day_id ([0-9a-f-]{36})/g)) {
        for (const title of ['Paseo', 'Cena']) {
          const out = JSON.parse(await add.run(add.parse({ trip_id, leg_id, day_id, type: title === 'Cena' ? 'meal' : 'activity', title })));
          expect(out).toMatchObject({ ok: true, mode: 'applied' });
        }
      }
      return { stop_reason: 'end_turn', usage: emptyUsage(), iterations: 1, text: 'Listo.' };
    },
  };
}

const shape = {
  title: 'Montevideo + Buenos Aires',
  start_date: '2026-10-24',
  end_date: '2026-10-27',
  legs: SKELETON.legs.map(({ key, city, country, start_date, end_date, includes_organizer, participant_names, parallel_with, why }) => ({
    key,
    city,
    country,
    start_date,
    end_date,
    includes_organizer,
    participant_names,
    parallel_with,
    why,
  })),
  transfers: SKELETON.transfers.map(({ from_key, to_key, date, mode, duration_min, participant_names }) => ({ from_key, to_key, date, mode, duration_min, participant_names })),
  assumptions: ['Forma elegida.'],
};

async function plan(over: Partial<ToolInput<'plan_trip'>>, modOpts: Parameters<typeof fakeModules>[0] = {}) {
  const fake = new FakeDb();
  const tripId = seedTrip(fake);
  const calls: Calls = { skeleton: 0, fill: [] };
  const { m, calls: mcalls } = fakeModules(modOpts);
  const deps: Partial<PlanDeps> = {
    llm: fakeLlm(calls),
    config,
    today: () => '2026-10-17',
    resolveCity: async (city) => ({ google_place_id: `city-${city}`, lat: -34.9, lng: -56.2 }),
    driveMinutes: async () => null,
    planner: async () => m,
    composeDeps: () => ({ searchPlaces: async () => [] }),
    forecast: async () => ({ available: false, from: '2026-11-02' }),
    heartbeatMs: 60_000,
  };
  const ctx = ctxFor(fake, U.juan);
  const start = await startPlanTrip(
    { trip_id: tripId, conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires con Sofi' }], ...over },
    ctx,
    deps,
  );
  await start.run();
  const job = fake.rows('agent_jobs').find((j) => j.id === start.job_id)!;
  return { fake, tripId, calls, mcalls, job, result: job.result as PlanTripResult, ctx };
}

describe('plan_trip · planificador colaborativo', () => {
  it('con skeleton no llama al LLM del esqueleto; mode menu crea opciones y no bloques (salvo traslados)', async () => {
    const { fake, calls, mcalls, job, result, ctx } = await plan({ skeleton: shape, mode: 'menu' });
    expect(calls.skeleton).toBe(0);
    expect(calls.fill).toEqual([]);
    expect(mcalls.getCatalog.sort()).toEqual(['Buenos Aires', 'Montevideo']);
    expect(mcalls.compose).toEqual([]);
    expect(job.status).toBe('done');
    expect(result).toMatchObject({ stage: 'menu', legs: 2, days: 4, options: 24, blocks: 1, assumptions: ['Forma elegida.'] });
    expect(fake.rows('leg_options')).toHaveLength(24);
    expect(fake.rows('blocks').map((b) => b.type)).toEqual(['transfer']);
    const texts = (job.progress as { text: string }[]).map((p) => p.text);
    expect(texts).toContain('Uso la forma del viaje que eligieron…');
    expect(texts).toContain('Investigando qué no te podés perder en Montevideo…');
    expect(texts).toContain('Armé el menú de Montevideo: 3 imperdibles, 9 para ustedes');
    expect(texts.at(-1)).toBe('¡Listo el menú! 2 tramos, 4 días, 24 opciones para elegir');
    // Deshacer: borra tramos (opciones en cascada)
    const undo = await runTool('undo', { undo_token: result.undo_token }, ctx);
    expect(undo.body.ok).toBe(true);
    expect([fake.rows('legs').length, fake.rows('leg_options').length, fake.rows('blocks').length]).toEqual([0, 0, 0]);
  });

  it('mode auto: compone desde el menú, choice_group compartido por lugar y cobertura en el resultado', async () => {
    const { fake, calls, mcalls, job, result } = await plan({ conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires, sí o sí Lugar mon 7' }] });
    expect(calls.skeleton).toBe(1);
    expect(calls.fill).toEqual([]);
    expect(job.status).toBe('done');
    // preseleccionadas (3 must + 2 primeras) + la que nombró en la conversación
    const mvd = mcalls.compose.find((c) => c.leg === 'Montevideo')!;
    expect(mvd.picks).toHaveLength(6);
    expect(mvd.picks).toContain('mon-lugar-7');
    expect(result.stage).toBe('planned');
    expect(result.coverage?.map((c) => [c.city, c.must_covered, c.must_total, c.choices])).toEqual(
      expect.arrayContaining([
        ['Montevideo', 3, 3, 2],
        ['Buenos Aires', 3, 3, 2],
      ]),
    );
    expect(result.choices).toBe(4);
    const blocks = fake.rows('blocks');
    // Montevideo 6 picks + Buenos Aires 5 + 2 tramos × 2 días × 2 cenas + 1 traslado
    expect(blocks).toHaveLength(6 + 5 + 8 + 1);
    expect(result.blocks).toBe(blocks.length);
    const cenas = blocks.filter((b) => b.type === 'meal');
    const groups = new Map<string, unknown[]>();
    for (const c of cenas) groups.set(c.choice_group as string, [...(groups.get(c.choice_group as string) ?? []), c]);
    expect(groups.size).toBe(4);
    expect([...groups.keys()].every(Boolean)).toBe(true);
    expect([...groups.values()].every((g) => g.length === 2)).toBe(true);
    expect(cenas.every((c) => c.status === 'proposed')).toBe(true);
    expect(blocks.filter((b) => b.type === 'activity').every((b) => b.choice_group === null)).toBe(true);
    // Sin feed por bloque: una sola trip_planned
    expect(fake.rows('activity_feed').map((f) => f.kind)).toEqual(['trip_planned']);
  });

  it('fallback: si el catálogo de un tramo falla o queda chico, ese tramo usa el relleno por LLM', async () => {
    const { fake, calls, mcalls, job, result } = await plan({ skeleton: shape }, { failCity: 'Buenos Aires' });
    expect(job.status).toBe('done');
    expect(calls.fill).toEqual(['Buenos Aires']);
    expect(mcalls.compose.map((c) => c.leg)).toEqual(['Montevideo']);
    expect(result.coverage?.map((c) => c.city)).toEqual(['Montevideo']);
    const bsas = fake.rows('legs').find((l) => l.city === 'Buenos Aires')!;
    expect(fake.rows('blocks').filter((b) => b.leg_id === bsas.id && b.type !== 'transfer')).toHaveLength(4);

    const small = await plan({ skeleton: shape, mode: 'menu' }, { smallCity: 'Montevideo' });
    expect(small.calls.fill).toEqual(['Montevideo']);
    expect(small.result.options).toBe(12); // solo Buenos Aires tiene menú
  });

  it('anclas: se guardan en request.understanding, cada tramo recibe las suyas y la llegada larga aliviana el primer día', async () => {
    const clasico = {
      id: 'clasico',
      name: 'Boca vs River',
      kind: 'sports' as const,
      city: 'Buenos Aires',
      country: 'Argentina',
      date: '2026-10-27',
      time: '17:00',
      venue: 'La Bombonera',
      tickets: 'want' as const,
      researched: true,
      sources: [{ url: 'https://example.com/fixture', title: null }],
      note: null,
    };
    const recital = { ...clasico, id: 'recital', name: 'Recital en el Solís', kind: 'concert' as const, city: 'Montevideo', date: null, time: null, venue: null, researched: false, sources: [] };
    const { mcalls, result } = await plan({
      skeleton: { ...shape, anchors: [clasico] },
      understanding: { origin: 'Madrid', anchors: [recital], interests: { arte: 4 } },
    });
    expect(result.request?.understanding?.anchors?.map((a) => a.id).sort()).toEqual(['clasico', 'recital']);
    expect(result.request?.understanding?.origin).toBe('Madrid');
    const mvd = mcalls.compose.find((c) => c.leg === 'Montevideo')!;
    const bsas = mcalls.compose.find((c) => c.leg === 'Buenos Aires')!;
    expect(mvd.anchors).toEqual(['recital']);
    expect(bsas.anchors).toEqual(['clasico']);
    // Madrid → Montevideo: vuelo largo, el primer día del primer tramo rinde ~35 %.
    expect(mvd.dayWindows?.['2026-10-24']).toMatchObject({ cap_factor: 0.35 });
    expect(bsas.dayWindows?.['2026-10-26']?.cap_factor).toBeUndefined();
  });

  it('relleno por LLM: el contexto del tramo lleva sus anclas', async () => {
    const clasico = { id: 'clasico', name: 'Boca vs River', kind: 'sports' as const, city: 'Buenos Aires', date: '2026-10-27', time: '17:00', tickets: 'have' as const, researched: true, sources: [] };
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    const systems: string[] = [];
    const llm = fakeLlm({ skeleton: 0, fill: [] });
    const start = await startPlanTrip(
      { trip_id: tripId, conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires' }], skeleton: { ...shape, anchors: [clasico] } },
      ctxFor(fake, U.juan),
      {
        llm: { ...llm, fillLeg: (a) => (systems.push(a.system.map((x) => x.text).join('\n')), llm.fillLeg(a)) },
        config,
        today: () => '2026-10-17',
        resolveCity: async () => null,
        driveMinutes: async () => null,
        planner: async () => {
          throw new Error('sin módulos');
        },
        heartbeatMs: 60_000,
      },
    );
    await start.run();
    const bsas = systems.find((t) => /Tramo: Buenos Aires/.test(t))!;
    expect(bsas).toMatch(/Anclas de este tramo \(agendalas tal cual, no inventes otras fechas\)/);
    expect(bsas).toMatch(/Boca vs River \(sports\) · 2026-10-27 17:00 → day_id/);
    expect(systems.find((t) => /Tramo: Montevideo/.test(t))).not.toMatch(/Boca vs River/);
  });

  it('si los módulos del planificador no cargan, todo el viaje se arma como antes', async () => {
    const fake = new FakeDb();
    const tripId = seedTrip(fake);
    const calls: Calls = { skeleton: 0, fill: [] };
    const start = await startPlanTrip({ trip_id: tripId, conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires' }] }, ctxFor(fake, U.juan), {
      llm: fakeLlm(calls),
      config,
      today: () => '2026-10-17',
      resolveCity: async () => null,
      driveMinutes: async () => null,
      planner: async () => {
        throw new Error('Cannot find module ./catalog');
      },
      heartbeatMs: 60_000,
    });
    await start.run();
    const job = fake.rows('agent_jobs')[0];
    expect(job.status).toBe('done');
    expect(calls.fill.sort()).toEqual(['Buenos Aires', 'Montevideo']);
    expect((job.result as PlanTripResult).blocks).toBe(9);
  });
});
