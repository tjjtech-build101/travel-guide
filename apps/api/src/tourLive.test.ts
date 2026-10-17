import { describe, expect, it } from 'vitest';
import { TOUR_STARTED_RULE } from '@build101/shared';
import { TOUR_RULES, makeTourModeRules } from './voice/tourRules';
import { advance, initialProgress, layerText, pendingStops, remainingMin, skip, stopSources, stopView, type StopRow } from './tourLive';

const stop = (id: string, sort_order: number, extra: Partial<StopRow> = {}): StopRow => ({
  id,
  tour_id: 't',
  place_id: `p${id}`,
  sort_order,
  geofence_radius_m: 35,
  dwell_min: 4,
  look_at: 'la puerta',
  narration_short: `corta ${id}`,
  narration_more: null,
  narration_secret: '  ',
  myth_vs_fact: null,
  photo_spot: null,
  kid_mission: null,
  transition_to_next: `de ${id} a la siguiente`,
  nav_to_next: 'derecho',
  sources: [{ url: 'https://a', title: 'A' }, 'https://b', { source_url: 'https://c' }, { nope: 1 }],
  place_library: { name: `Lugar ${id}`, lat: -34.9 + sort_order * 0.001, lng: -56.2 },
  ...extra,
});

const S = [stop('a', 1), stop('b', 2), stop('c', 3)];
const T0 = new Date('2026-10-17T15:00:00Z');

describe('tours.progress (puros)', () => {
  it('initialProgress: actual = primera parada, ends_at = inicio + duración', () => {
    const p = initialProgress(S, 60, T0);
    expect(p.current_stop_id).toBe('a');
    expect(p.visited).toEqual([]);
    expect(new Date(p.ends_at).getTime() - T0.getTime()).toBe(60 * 60_000);
    expect(remainingMin(p, new Date(T0.getTime() + 20 * 60_000))).toBe(40);
    expect(remainingMin(p, new Date(T0.getTime() + 90 * 60_000))).toBe(0);
  });

  it('advance: marca la actual visitada y pasa a la primera pendiente; al final, next null', () => {
    let p = initialProgress(S, 60, T0);
    let r = advance(S, p, { now: T0 });
    expect(r.previousId).toBe('a');
    expect(r.next?.id).toBe('b');
    expect(r.progress.visited.map((v) => v.stop_id)).toEqual(['a']);
    p = r.progress;
    r = advance(S, p, { now: T0 });
    r = advance(S, r.progress, { now: T0 });
    expect(r.next).toBeNull();
    expect(r.progress.current_stop_id).toBeNull();
    expect(pendingStops(S, r.progress)).toEqual([]);
  });

  it('advance conserva arrived_at y completa left_at si ya había llegado', () => {
    const p = { ...initialProgress(S, 60, T0), visited: [{ stop_id: 'a', arrived_at: 'x', left_at: null }] };
    const r = advance(S, p, { now: T0 });
    expect(r.progress.visited).toEqual([{ stop_id: 'a', arrived_at: 'x', left_at: T0.toISOString() }]);
  });

  it('advance en explorador: la pendiente más cercana', () => {
    const p = { ...initialProgress(S, 60, T0), current_stop_id: null };
    const r = advance(S, p, { near: { lat: -34.9 + 0.003, lng: -56.2 } });
    expect(r.next?.id).toBe('c');
  });

  it('skip: saltea; si era la actual, pasa a la siguiente pendiente; parada ajena → error', () => {
    const p = initialProgress(S, 60, T0);
    const q = skip(S, p, 'a');
    expect(q.skipped).toEqual(['a']);
    expect(q.current_stop_id).toBe('b');
    expect(skip(S, q, 'a').skipped).toEqual(['a']);
    const r = skip(S, q, 'c');
    expect(r.current_stop_id).toBe('b');
    expect(() => skip(S, p, 'zzz')).toThrow();
  });

  it('capas, fuentes y vista de parada', () => {
    expect(layerText(S[0], 'short')).toBe('corta a');
    expect(layerText(S[0], 'secret')).toBeNull();
    expect(layerText(S[0], 'transition')).toBe('de a a la siguiente');
    expect(stopSources(S[0])).toEqual([{ url: 'https://a', title: 'A' }, { url: 'https://b' }, { url: 'https://c' }]);
    const v = stopView(S[0], ['short']);
    expect(v).toMatchObject({ stop_id: 'a', name: 'Lugar a', geofence_radius_m: 35, dwell_min: 4, layers_told: ['short'] });
    expect(v.layers_available).toEqual(['short', 'transition']);
  });
});

describe('reglas del modo tour (voz)', () => {
  it('chat: solo tour_started; tour: reglas + ids del tour', async () => {
    const rules = makeTourModeRules(async () => ({ title: 'Ciudad Vieja', stops: S }));
    expect(await rules('chat', 'x')).toEqual([TOUR_STARTED_RULE]);
    const r = await rules('tour', 'tour-1');
    expect(r.slice(0, TOUR_RULES.length)).toEqual(TOUR_RULES);
    expect(r.at(-1)).toContain('tour_id=tour-1');
    expect(r.at(-1)).toContain('stop_id=b');
    expect(r.join('\n')).toContain('get_stop_content');
    expect(r.join('\n')).toContain('left_route');
    expect(r.join('\n')).toContain('time_warning');
  });

  it('si falla la carga, quedan las reglas fijas', async () => {
    const rules = makeTourModeRules(async () => {
      throw new Error('db caída');
    });
    expect(await rules('tour', 't')).toEqual(TOUR_RULES);
  });
});
