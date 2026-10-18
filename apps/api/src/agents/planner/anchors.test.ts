import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripAnchor, TripUnderstanding } from '@build101/shared';
import { emptyUsage } from '../schemas';
import { type AnchorLLM, type AnchorResearchOutputT, clearAnchorCache, hasAnchors, normalizeResearched, researchAnchors } from './anchors';

const userAnchor = (over: Partial<TripAnchor> = {}): TripAnchor => ({
  id: 'mundial-rugby-2027',
  name: 'Partidos de los Pumas en el Mundial de Rugby 2027',
  kind: 'sports',
  city: null,
  country: 'Australia',
  date: null,
  time: null,
  venue: null,
  tickets: 'want',
  researched: false,
  sources: [],
  note: 'desde grupos',
  ...over,
});

const u = (over: Partial<TripUnderstanding> = {}): TripUnderstanding => ({
  destinations: [{ city: 'Australia', country: 'Australia' }],
  start_date: null,
  end_date: null,
  days: null,
  travelers: 5,
  party: 'friends',
  names: [],
  interests: {},
  must: [],
  avoid: [],
  budget: null,
  pace: null,
  first_time: null,
  kids_ages: [],
  arrival: null,
  departure: null,
  lodging_booked: null,
  notes: [],
  trip_kind: 'event',
  anchors: [userAnchor()],
  origin: 'Buenos Aires',
  ...over,
});

const SRC = { url: 'https://www.rugbyworldcup.com/2027/fixtures', title: 'Fixture oficial' };
type RA = AnchorResearchOutputT['anchors'][number];
const ra = (over: Partial<RA> = {}): RA => ({
  id: 'arg-g1',
  name: 'Argentina vs Australia (grupos)',
  kind: 'sports',
  city: 'Perth',
  country: 'Australia',
  date: '2027-10-02',
  time: '19:00',
  venue: 'Perth Stadium',
  tickets: 'want',
  note: null,
  sources: [SRC],
  ...over,
});
const output = (anchors: RA[], over: Partial<AnchorResearchOutputT> = {}): AnchorResearchOutputT => ({ event: 'Rugby World Cup 2027', schedule_found: true, anchors, notes: [], ...over });

const fakeLlm = (fn: AnchorLLM['research']): AnchorLLM & { research: ReturnType<typeof vi.fn> } => ({ research: vi.fn(fn) });

beforeEach(() => clearAnchorCache());

describe('normalizeResearched', () => {
  it('sin fuente válida → researched:false, sin fecha/hora/sede inventadas; con fuente → researched:true', () => {
    const r = normalizeResearched(
      output([
        ra({ id: 'cuartos', name: 'Cuartos', date: '2027-10-23', time: 'tarde', sources: [SRC] }),
        ra({ id: 'sin-fuente', name: 'Semifinal', date: '2027-10-30', time: '20:00', venue: 'Accor', sources: [{ url: 'no es url', title: null }] }),
        ra({ id: 'dijo-usuario', name: 'Final', date: '2027-11-13', sources: [] }),
        ra({ id: '', name: '   ' }), // sin nombre → afuera
      ]),
      [userAnchor({ date: '2027-11-13' })],
    );
    expect(r.map((a) => a.id)).toEqual(['cuartos', 'dijo-usuario', 'sin-fuente']);
    expect(r[0]).toMatchObject({ researched: true, date: '2027-10-23', time: null, sources: [SRC] });
    // Semifinal: el modelo "sabía" la fecha pero sin fuente → null.
    expect(r[2]).toMatchObject({ researched: false, date: null, time: null, venue: null, sources: [] });
    expect(r[2].note).toContain('a confirmar');
    // Final: la fecha la dijo el usuario → se mantiene, igual no investigada.
    expect(r[1]).toMatchObject({ researched: false, date: '2027-11-13' });
  });

  it('hasAnchors: evento o anclas', () => {
    expect(hasAnchors(u())).toBe(true);
    expect(hasAnchors(u({ anchors: [], trip_kind: 'event' }))).toBe(true);
    expect(hasAnchors(u({ anchors: [], trip_kind: 'city' }))).toBe(false);
    expect(hasAnchors(null)).toBe(false);
  });
});

describe('researchAnchors', () => {
  it('viaje sin anclas: no llama al LLM', async () => {
    const llm = fakeLlm(async () => ({ value: null, usage: emptyUsage() }));
    const r = await researchAnchors(u({ anchors: [], trip_kind: 'city' }), { llm, today: '2026-10-17' });
    expect(r).toEqual({ anchors: [], researched: false, notes: [], event: null });
    expect(llm.research).not.toHaveBeenCalled();
  });

  it('caso Mundial: anclas investigadas con fuentes, cache por (evento, equipo, fase)', async () => {
    const llm = fakeLlm(async ({ user, config }) => {
      expect(user).toContain('Partidos de los Pumas');
      expect(config.effort).toBe('medium');
      return { value: output([ra(), ra({ id: 'arg-g2', name: 'Argentina vs Samoa', city: 'Sydney', date: '2027-10-09' })], { notes: ['El cruce de cuartos depende del grupo.'] }), usage: emptyUsage() };
    });
    const r = await researchAnchors(u(), { llm, today: '2026-10-17' });
    expect(llm.research.mock.calls[0][0].user).toContain('desde grupos');
    expect(r.researched).toBe(true);
    expect(r.event).toBe('Rugby World Cup 2027');
    expect(r.anchors.map((a) => [a.id, a.date, a.researched])).toEqual([
      ['arg-g1', '2027-10-02', true],
      ['arg-g2', '2027-10-09', true],
    ]);
    expect(r.notes).toEqual(['El cruce de cuartos depende del grupo.']);
    // Misma pregunta → cache. Otra fase → investiga de nuevo.
    await researchAnchors(u(), { llm, today: '2026-10-17' });
    expect(llm.research).toHaveBeenCalledTimes(1);
    await researchAnchors(u({ anchors: [userAnchor({ note: 'solo la final' })] }), { llm, today: '2026-10-17' });
    expect(llm.research).toHaveBeenCalledTimes(2);
  });

  it('el modelo no reporta nada → anclas del usuario, researched:false, sin fecha inventada; no queda en cache', async () => {
    const llm = fakeLlm(async () => ({ value: null, usage: emptyUsage() }));
    const r = await researchAnchors(u(), { llm, today: '2026-10-17' });
    expect(r.researched).toBe(false);
    expect(r.anchors).toEqual([expect.objectContaining({ id: 'mundial-rugby-2027', researched: false, date: null, sources: [] })]);
    expect(r.notes[0]).toContain('a confirmar');
    await new Promise((res) => setTimeout(res, 0));
    await researchAnchors(u(), { llm, today: '2026-10-17' });
    expect(llm.research).toHaveBeenCalledTimes(2);
  });

  it('error o timeout → nunca tira, sigue sin anclas investigadas', async () => {
    const boom = fakeLlm(async () => {
      throw new Error('web caída');
    });
    const r1 = await researchAnchors(u(), { llm: boom, today: '2026-10-17', cache: false });
    expect(r1.researched).toBe(false);
    expect(r1.anchors[0]).toMatchObject({ researched: false, date: null });

    const slow = fakeLlm(() => new Promise(() => {}));
    const t0 = Date.now();
    const r2 = await researchAnchors(u(), { llm: slow, today: '2026-10-17', timeoutMs: 20, cache: false });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r2.researched).toBe(false);
    expect(r2.notes[0]).toContain('tardó demasiado');
  });
});
