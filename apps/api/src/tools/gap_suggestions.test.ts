import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaceSummary } from '../google/places';
import { fakeDb } from './fakeDb';
import { gap_suggestions, maxWalkFor, rankSuggestions, type BankIdea } from './gap_suggestions';
import type { ToolCtx } from './types';

// Plaza Independencia, Montevideo. 0.001° de latitud ≈ 111 m.
const here = { lat: -34.90656, lng: -56.19903 };
const at = (dLat: number) => ({ lat: here.lat + dLat, lng: here.lng });

const idea = (over: Partial<BankIdea> = {}): BankIdea => ({
  id: 'i1',
  is_private: false,
  title: 'Mercado del Puerto',
  type: 'meal',
  place_name: 'Mercado del Puerto',
  google_place_id: 'g-mercado',
  ...at(0.002),
  duration_min: 60,
  ...over,
});
const place = (over: Partial<PlaceSummary> = {}): PlaceSummary => ({
  google_place_id: 'g-cafe',
  name: 'Café Brasilero',
  address: 'Ituzaingó 1447',
  ...at(0.001),
  rating: 4.6,
  price_level: 1,
  open_now: true,
  types: ['cafe'],
  ...over,
});

describe('rankSuggestions', () => {
  const base = { here, minutes: 90, localTime: '15:00', ideas: [], places: [], events: [], limit: 3 };

  it('mezcla fuentes y cada una trae why de una línea con la caminata', () => {
    const items = rankSuggestions({
      ...base,
      ideas: [idea()],
      places: [place(), place({ google_place_id: 'g2', name: 'Otro café', ...at(0.0015) })],
      events: [{ title: 'Candombe', date: '2026-10-18', start_time: '16:00', venue: 'Barrio Sur', address: null, price_text: null, url: 'https://e', source_url: 'https://e' }],
    });
    expect(items.map((i) => i.source).sort()).toEqual(['event', 'idea', 'place']);
    const i = items.find((x) => x.source === 'idea')!;
    expect(i.block_id).toBe('i1');
    expect(i.why).toMatch(/Tu idea · \d+ min a pie/);
    expect(items.find((x) => x.source === 'place')!.why).toMatch(/^Abierto ahora · /);
    expect(items.find((x) => x.source === 'event')!.why).toBe('Hoy a las 16:00 · Barrio Sur');
  });

  it('descarta lo lejos para el hueco, sin coords, o que no entra', () => {
    const items = rankSuggestions({
      ...base,
      minutes: 30, // caminata máx 10 min
      ideas: [idea({ id: 'lejos', ...at(0.02) }), idea({ id: 'sin', lat: null, lng: null }), idea({ id: 'larga', duration_min: 120 })],
    });
    expect(items).toEqual([]);
    expect(maxWalkFor(30)).toBe(10);
  });

  it('no repite como lugar algo que ya está en el banco, y respeta limit', () => {
    const items = rankSuggestions({
      ...base,
      limit: 2,
      ideas: [idea({ google_place_id: 'g-cafe' })],
      places: [place(), place({ google_place_id: 'g2' }), place({ google_place_id: 'g3' })],
    });
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.google_place_id === 'g-cafe')).toHaveLength(1);
  });

  it('eventos que ya empezaron o empiezan después del hueco no van', () => {
    const ev = { date: '2026-10-18', venue: 'X', address: null, price_text: null, url: 'u', source_url: 'u' };
    const items = rankSuggestions({
      ...base,
      events: [
        { ...ev, title: 'Antes', start_time: '14:00' },
        { ...ev, title: 'Después', start_time: '20:00' },
      ],
    });
    expect(items).toEqual([]);
  });
});

describe('gap_suggestions (handler)', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY; // sin Google: solo banco
  });

  it('sin Google devuelve el banco del tramo, sin privados ajenos', async () => {
    const me = 'u1';
    const db = fakeDb({
      legs: [{ id: 'leg', trip_id: 'trip', city: null, country: 'UY' }],
      blocks: [
        { id: 'b1', leg_id: 'leg', day_id: null, title: 'Mercado', type: 'meal', ...at(0.002), is_private: false, created_by: 'u2' },
        { id: 'b2', leg_id: 'leg', day_id: null, title: 'Secreto', type: 'activity', ...at(0.001), is_private: true, created_by: 'u2' },
        { id: 'b3', leg_id: 'leg', day_id: 'd1', title: 'Ya agendado', type: 'activity', ...at(0.001), is_private: false },
      ],
    });
    const ctx = { userId: me, actor: 'user', db, admin: db } as unknown as ToolCtx;
    const r = await gap_suggestions(
      { trip_id: 'trip', leg_id: 'leg', ...here, minutes: 60, date: '2026-10-18', local_time: '15:00', limit: 3 },
      ctx,
    );
    const items = (r.data as { items: { id: string }[] }).items;
    expect(items.map((i) => i.id)).toEqual(['b1']);
  });
});
