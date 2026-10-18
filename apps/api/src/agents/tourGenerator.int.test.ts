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
import { enrichStop, type DeepDeps } from './tourDeepResearch';
import { get_stop_content } from '../tools/tour_live';
import { emptyUsage } from './schemas';

// La fase 2 real (Claude/Wikipedia) no corre en tests: acá se prueba enrichStop con dependencias falsas.
process.env.TOUR_DEEP_RESEARCH = 'false';

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

  it('enrichStop: suma el dossier a place_library, alarga las capas y get_stop_content devuelve los facts', async () => {
    const start = await startGenerateTour(input({ trip_id: DEMO_TRIP_ID }), ctx, fakeDeps(fakeLlm()));
    created.tours.push(start.tour_id);
    created.jobs.push(start.job_id);
    await start.run();
    const { data: stops } = await admin.from('tour_stops').select('id,place_id,narration_more').eq('tour_id', start.tour_id).order('sort_order');
    const stop = stops![0];
    created.places.push(...stops!.map((s) => s.place_id as string));
    const u = emptyUsage();
    const many = Array.from({ length: 12 }, (_, i) => `Dato profundo número ${i + 1} sobre la historia del lugar en el siglo XIX`);
    const deep: DeepDeps = {
      llm: {
        ...fakeLlm(),
        async extractFacts() {
          return { usage: u, facts: many.map((t, i) => ({ text: t, quote: `Frase ${i + 1} del artículo con datos verificables.`, kind: 'story' as const })) };
        },
        async research() {
          return { usage: u, facts: [], web_search_calls: 0 };
        },
        async writeStop() {
          const long = (n: number, tag: string) => Array.from({ length: n }, () => `Miren con calma este rincón que guarda historias ${tag}.`).join(' ');
          return {
            usage: u,
            stop: { look_at: 'La fachada.', narration_short: long(14, 'cortas'), narration_more: long(40, 'largas'), narration_secret: long(20, 'secretas'), myth_vs_fact: null, photo_spot: null, kid_mission: null, transition_to_next: null, nav_to_next: null },
          };
        },
      },
      config: { effort: 'low', maxTokens: 1000, maxIterations: 2, fallbacks: false, writerEffort: 'low' },
      wikipediaArticle: async (title, lang) => ({ title, lang, url: `https://${lang}.wikipedia.org/wiki/x`, text: many.map((_, i) => `Frase ${i + 1} del artículo con datos verificables.`).join('\n') + '\n' + 'Relleno. '.repeat(60) }),
      findWikiTitles: async () => ({ es: 'Lugar', en: null }),
      fetchPageText: async () => null,
      now: () => Date.now(),
    };
    const r = await enrichStop(admin, stop.id as string, deep);
    expect(r.facts_added).toBeGreaterThanOrEqual(12);
    expect(r.rewritten).toBe(true);
    expect(r.words_after).toBeGreaterThan(r.words_before);
    const { data: after } = await admin.from('tour_stops').select('narration_more').eq('id', stop.id).single();
    expect((after!.narration_more as string).split(/\s+/).length).toBeGreaterThan((stop.narration_more as string).split(/\s+/).length);

    const content = await get_stop_content({ stop_id: stop.id as string, layer: 'short' }, ctx);
    const data = content.data as { facts?: string[]; layers_left?: string[] };
    expect(data.facts!.length).toBeGreaterThanOrEqual(12);
    expect(data.layers_left).toContain('more');
  }, 60_000);
});
