import { describe, expect, it } from 'vitest';
import type { Db } from '../supabase';
import { ensurePlace, mergeFacts, pickSearchResult } from './library';

const r = (name: string, lat: number, lng: number, id = `g:${name}`) => ({ google_place_id: id, name, address: null, lat, lng, rating: null, price_level: null, open_now: null, types: [] });

describe('place_library', () => {
  it('mergeFacts no duplica (mayúsculas, tildes, puntuación) y conserva lo existente', () => {
    const m = mergeFacts([{ text: 'La Ciudadela es de 1746.', source_url: 'x', verified: true, origin: 'tour' }], [
      { text: 'la ciudadela es de 1746', source_url: 'y', verified: true },
      { text: 'Otro dato', source_url: 'z', verified: true, origin: 'research' },
    ]);
    expect(m.added).toBe(1);
    expect(m.facts.map((f) => f.origin)).toEqual(['tour', 'research']);
  });

  it('pickSearchResult: el que tiene todas las palabras del nombre y está cerca', () => {
    const near = { lat: -34.95, lng: -56.16 };
    const res = [r('Hotel Faro', -34.951, -56.161), r('Faro de Punta Carretas', -34.9566, -56.1588), r('Faro de Punta Carretas', -30, -50)];
    expect(pickSearchResult(res, 'Faro de Punta Carretas', near)?.lat).toBe(-34.9566);
    expect(pickSearchResult([r('Faro de Punta Carretas', -30, -50)], 'Faro de Punta Carretas', near)).toBeNull();
  });

  it('ensurePlace: crea el lugar (osm → osm_id) y no crea si no lo encuentra', async () => {
    const inserted: Record<string, unknown>[] = [];
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
      for (const m of ['eq', 'select', 'maybeSingle', 'single', 'ilike', 'limit']) c[m] = () => c;
      return c;
    };
    const admin = {
      from: () => ({
        select: (cols: string) => chain({ data: cols.includes('name') ? [] : null, error: null }),
        insert: (v: Record<string, unknown>) => (inserted.push(v), chain({ data: { id: 'p-nuevo' }, error: null })),
      }),
    } as unknown as Db;
    const out = await ensurePlace(admin, { name: 'Faro de Punta Carretas', near: { lat: -34.95, lng: -56.16 } }, {
      search: async () => [r('Faro de Punta Carretas', -34.9566, -56.1588, 'osm:N123')],
    });
    expect(out).toEqual({ id: 'p-nuevo', created: true });
    expect(inserted[0]).toMatchObject({ name: 'Faro de Punta Carretas', osm_id: 'N123', google_place_id: null, tier: 'researched' });
    expect(await ensurePlace(admin, { name: 'Lugar inexistente' }, { search: async () => [] })).toBeNull();
  });
});
