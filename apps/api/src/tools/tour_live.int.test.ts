// Integración de las herramientas del tour en vivo (PRD 07) contra Supabase LOCAL. Crea un tour y lugares
// temporales (no toca el tour del seed) y los borra al final. Se saltea si no hay Supabase local.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_TRIP_ID, DEMO_USERS } from '@build101/shared';
import type { ToolCtx } from './types';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(envPath) && !process.env.SUPABASE_URL) process.loadEnvFile(envPath);

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(process.env.SUPABASE_URL ?? '');
async function supabaseUp(): Promise<boolean> {
  // Nunca contra la nube: este test escribe.
  if (!isLocal || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, { headers: { apikey: process.env.SUPABASE_ANON_KEY ?? '' }, signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}
const up = await supabaseUp();

describe.skipIf(!up)('herramientas del tour en vivo (Supabase local)', async () => {
  const { serviceClient } = await import('../supabase');
  const { runTool } = await import('./registry');
  const admin = serviceClient();
  const ctx: ToolCtx = { userId: DEMO_USERS.juan, actor: 'agent', db: admin, admin };
  const tourId = randomUUID();
  const places = [randomUUID(), randomUUID(), randomUUID()];
  const stops = [randomUUID(), randomUUID(), randomUUID()];
  let sessionId: string | null = null;

  beforeAll(async () => {
    const pl = await admin.from('place_library').insert(
      places.map((id, i) => ({ id, name: `Test lugar ${i + 1}`, lat: -34.9 - i * 0.001, lng: -56.2, tier: 'researched', facts: [] })),
    );
    expect(pl.error).toBeNull();
    const t = await admin.from('tours').insert({
      id: tourId,
      trip_id: DEMO_TRIP_ID,
      owner_user_id: DEMO_USERS.juan,
      mode: 'spontaneous',
      title: 'Tour de test',
      duration_min: 45,
      start_lat: -34.9,
      start_lng: -56.2,
      status: 'ready',
    });
    expect(t.error).toBeNull();
    const s = await admin.from('tour_stops').insert(
      stops.map((id, i) => ({
        id,
        tour_id: tourId,
        place_id: places[i],
        sort_order: i + 1,
        narration_short: `Corta ${i + 1}`,
        narration_more: i === 0 ? 'Más de la 1' : null,
        transition_to_next: i < 2 ? `Vamos a la ${i + 2}` : null,
        nav_to_next: i < 2 ? 'Doblá a la derecha' : null,
        sources: [{ title: 'Fuente', url: 'https://example.org' }],
      })),
    );
    expect(s.error).toBeNull();
    // Llamada de tour abierta con Ana como participante: content_told se escribe para las dos.
    const v = await admin
      .from('voice_sessions')
      .insert({ tour_id: tourId, trip_id: DEMO_TRIP_ID, mode: 'tour', participants: [DEMO_USERS.juan, DEMO_USERS.ana] })
      .select('id')
      .single();
    expect(v.error).toBeNull();
    sessionId = v.data!.id as string;
  });

  afterAll(async () => {
    if (sessionId) await admin.from('voice_sessions').delete().eq('id', sessionId);
    await admin.from('tours').delete().eq('id', tourId);
    await admin.from('place_library').delete().in('id', places); // content_told cae en cascada
  });

  it('start_tour: active + progreso inicial + paradas; segunda vez no lo reinicia', async () => {
    const r = await runTool('start_tour', { tour_id: tourId }, ctx);
    expect(r.status).toBe(200);
    if (!r.body.ok) throw new Error(r.body.error.message);
    const d = r.body.data as { tour: { status: string; progress: { current_stop_id: string } }; stops: { stop_id: string; name: string }[]; persona: { name: string }; already_active: boolean };
    expect(d.tour.status).toBe('active');
    expect(d.tour.progress.current_stop_id).toBe(stops[0]);
    expect(d.stops.map((s) => s.stop_id)).toEqual(stops);
    expect(d.stops[0].name).toBe('Test lugar 1');
    expect(d.already_active).toBe(false);
    const again = await runTool('start_tour', { tour_id: tourId }, ctx);
    expect((again.body as { data: { already_active: boolean } }).data.already_active).toBe(true);
    const { data } = await admin.from('tours').select('status,progress').eq('id', tourId).single();
    expect(data?.status).toBe('active');
  });

  it('get_stop_content: texto + fuentes, escribe content_told para los participantes, already_told la 2da vez', async () => {
    const r1 = await runTool('get_stop_content', { stop_id: stops[0], layer: 'short' }, ctx);
    expect(r1.body).toMatchObject({ ok: true, data: { text: 'Corta 1', already_told: false, sources: [{ url: 'https://example.org' }] } });
    const { data: told } = await admin.from('content_told').select('user_id,layer').eq('place_id', places[0]);
    expect(new Set((told ?? []).map((t) => t.user_id))).toEqual(new Set([DEMO_USERS.juan, DEMO_USERS.ana]));
    const r2 = await runTool('get_stop_content', { stop_id: stops[0], layer: 'short' }, ctx);
    expect(r2.body).toMatchObject({ ok: true, data: { already_told: true } });
    // Capa sin contenido: text null y no escribe.
    const r3 = await runTool('get_stop_content', { stop_id: stops[1], layer: 'secret' }, ctx);
    expect(r3.body).toMatchObject({ ok: true, data: { text: null, already_told: false } });
    const { count } = await admin.from('content_told').select('*', { count: 'exact', head: true }).eq('place_id', places[1]);
    expect(count).toBe(0);
  });

  it('start_tour después de contar: layers_told por parada', async () => {
    const r = await runTool('start_tour', { tour_id: tourId }, ctx);
    const d = (r.body as { data: { stops: { layers_told: string[] }[] } }).data;
    expect(d.stops[0].layers_told).toEqual(['short']);
  });

  it('next_stop: visitada + transición de la actual; skip_stop; tour_status; al final done', async () => {
    const n = await runTool('next_stop', { tour_id: tourId }, ctx);
    expect(n.body).toMatchObject({
      ok: true,
      data: { done: false, previous: { stop_id: stops[0] }, transition_to_next: 'Vamos a la 2', nav_to_next: 'Doblá a la derecha', next: { stop_id: stops[1] } },
    });
    const sk = await runTool('skip_stop', { tour_id: tourId, stop_id: stops[1] }, ctx);
    expect(sk.body).toMatchObject({ ok: true, data: { skipped: [stops[1]], current_stop_id: stops[2], pending: 1 } });
    const st = await runTool('tour_status', { tour_id: tourId, lat: -34.9, lng: -56.2 }, ctx);
    expect(st.body).toMatchObject({ ok: true, data: { status: 'active', current: { stop_id: stops[2] }, visited: [stops[0]], skipped: [stops[1]], pending: 1 } });
    const last = await runTool('next_stop', { tour_id: tourId }, ctx);
    expect(last.body).toMatchObject({ ok: true, data: { done: true, next: null } });
    const { data } = await admin.from('tours').select('status').eq('id', tourId).single();
    expect(data?.status).toBe('done');
  });

  it('tour_status con progreso del celu lo guarda (ignora ids ajenos) y end:true lo termina', async () => {
    const progress = {
      current_stop_id: stops[1],
      visited: [{ stop_id: stops[0], arrived_at: '2026-10-17T15:00:00Z', left_at: null }, { stop_id: randomUUID(), arrived_at: 'x' }],
      skipped: [],
      started_at: '2026-10-17T15:00:00Z',
      ends_at: '2099-01-01T00:00:00Z',
    };
    const r = await runTool('tour_status', { tour_id: tourId, progress }, ctx);
    expect(r.body).toMatchObject({ ok: true, data: { current: { stop_id: stops[1] }, visited: [stops[0]] } });
    const e = await runTool('tour_status', { tour_id: tourId, end: true }, ctx);
    expect(e.body).toMatchObject({ ok: true, data: { status: 'done' } });
  });

  it('tour ajeno o inexistente → 404; parada inexistente → 404', async () => {
    const r = await runTool('start_tour', { tour_id: randomUUID() }, ctx);
    expect(r.status).toBe(404);
    const s = await runTool('get_stop_content', { stop_id: randomUUID(), layer: 'short' }, ctx);
    expect(s.status).toBe(404);
  });
});
