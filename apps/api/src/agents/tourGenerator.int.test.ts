// Integración del tour director contra Supabase LOCAL (seed de demo) con Claude y APIs externas FALSAS.
// Solo corre contra la instancia local de `supabase start` (nunca contra la remota de apps/api/.env).
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_TRIP_ID, DEMO_USERS, type GenerateTourResult, type TourBriefResult } from '@build101/shared';
import type { Db } from '../supabase';
import type { ToolCtx } from '../tools/types';
import { tour_brief } from '../tools/tour_brief';
import { startGenerateTour } from './tourGenerator';
import { fakeDeps, fakeLlm, input } from './tourTestKit';

function localSupabase(): { url: string; service: string } | null {
  try {
    const out = execSync('npx supabase status -o env', { cwd: new URL('../../../../', import.meta.url).pathname, timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const get = (k: string) => new RegExp(`^${k}="?([^"\\n]+)"?`, 'm').exec(out)?.[1];
    const url = get('API_URL');
    const service = get('SERVICE_ROLE_KEY');
    return url && service && /127\.0\.0\.1|localhost/.test(url) ? { url, service } : null;
  } catch {
    return null;
  }
}
const local = localSupabase();

describe.skipIf(!local)('tour director (integración, Supabase local + fakes)', () => {
  const admin = createClient(local?.url ?? 'http://127.0.0.1:0', local?.service ?? 'anon', { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Db;
  const ctx: ToolCtx = { userId: DEMO_USERS.juan, actor: 'user', db: admin, admin };
  const created = { tours: [] as string[], places: [] as string[], jobs: [] as string[] };

  afterAll(async () => {
    if (created.tours.length) await admin.from('tours').delete().in('id', created.tours);
    if (created.places.length) await admin.from('place_library').delete().in('id', created.places).neq('tier', 'curated');
    if (created.jobs.length) await admin.from('agent_jobs').delete().in('id', created.jobs);
  });

  it('tour_brief: resumen con el grupo del viaje y preguntas con defaults', async () => {
    const res = await tour_brief({ mode: 'spontaneous', trip_id: DEMO_TRIP_ID, start_lat: -34.9066, start_lng: -56.199, duration_min: 90 }, ctx);
    const data = res.data as TourBriefResult;
    expect(data.summary).toMatch(/Tour de 90 min/);
    expect(data.questions.length).toBeGreaterThanOrEqual(1);
    expect(data.questions.filter((q) => !q.optional).length).toBeLessThanOrEqual(3);
    expect(data.questions[data.questions.length - 1].id).toBe('must_include');
  }, 30_000);

  it('generate_tour: escribe tours (título, tesis, brief), tour_stops (dwell, geofence, fuentes) y place_library', async () => {
    const deps = fakeDeps(fakeLlm());
    const start = await startGenerateTour(input({ trip_id: DEMO_TRIP_ID, food_stop: false }), ctx, deps);
    created.tours.push(start.tour_id);
    created.jobs.push(start.job_id);
    await start.run();

    const { data: job } = await admin.from('agent_jobs').select('status,error,result,progress').eq('id', start.job_id).single();
    expect(job?.error).toBeNull();
    expect(job?.status).toBe('done');
    const result = job!.result as GenerateTourResult;
    expect(result.title).toBe('La ciudad que miró al puerto');
    expect(result.stop_count).toBeGreaterThanOrEqual(3);
    expect((job!.progress as unknown[]).length).toBeGreaterThanOrEqual(5);

    const { data: tour } = await admin.from('tours').select('status,title,thesis,brief,route').eq('id', start.tour_id).single();
    expect(tour).toMatchObject({ status: 'ready', title: 'La ciudad que miró al puerto' });
    expect(tour!.thesis).toContain('puerto');
    expect((tour!.brief as { audience: string }).audience).toContain('Dónde');

    const { data: stops } = await admin.from('tour_stops').select('sort_order,place_id,dwell_min,geofence_radius_m,narration_short,sources,transition_to_next').eq('tour_id', start.tour_id).order('sort_order');
    expect(stops!.length).toBe(result.stop_count);
    expect(stops![0].sort_order).toBe(1);
    expect(stops![stops!.length - 1].transition_to_next).toBeNull();
    for (const s of stops!) {
      expect(s.narration_short).not.toMatch(/Napoleón|\[f\d+\]/);
      expect((s.sources as unknown[]).length).toBeGreaterThan(0);
      expect(s.dwell_min).toBeGreaterThan(0);
    }
    const placeIds = stops!.map((s) => s.place_id as string);
    const { data: places } = await admin.from('place_library').select('id,tier,facts,city').in('id', placeIds);
    created.places.push(...places!.filter((p) => p.tier !== 'curated').map((p) => p.id as string));
    for (const p of places!.filter((x) => x.tier === 'researched')) {
      const facts = p.facts as { verified: boolean; quote?: string }[];
      expect(facts.length).toBeGreaterThan(0);
      expect(facts.every((f) => f.verified && f.quote)).toBe(true);
    }
  }, 60_000);
});
