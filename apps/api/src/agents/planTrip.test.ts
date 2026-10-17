import { describe, expect, it } from 'vitest';
import { toolDefs } from '@build101/shared';
import { addDays, eachDate, isIsoDate, nextSaturday, shortRange, todayIso } from './dates';
import { plannerConfig } from './llm';
import { compactForPlanner, describeLegs, matchNames, normalizeSkeleton, titleFromConversation } from './planTrip';
import { legContext, renderSkeletonRequest } from './prompts';
import { addUsage, emptyUsage, estimateCostUsd, type TripSkeleton } from './schemas';

const sk = (over: Partial<TripSkeleton> = {}): TripSkeleton => ({
  title: 'Montevideo + Buenos Aires',
  start_date: '2026-10-17',
  end_date: '2026-10-24',
  legs: [
    { key: 'bsas', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-20', end_date: '2026-10-24', includes_organizer: true, participant_names: [], parallel_with: [], why: '' },
    { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-17', end_date: '2026-10-19', includes_organizer: true, participant_names: [], parallel_with: [], why: '' },
  ],
  transfers: [{ from_key: 'mvd', to_key: 'bsas', date: '2026-10-20', mode: 'ferry', duration_min: 180, participant_names: [] }],
  assumptions: ['Asumí 3 noches en Montevideo.'],
  ...over,
});

let n = 0;
const ids = () => `id-${++n}`;

describe('fechas', () => {
  it('helpers', () => {
    expect(isIsoDate('2026-10-17')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(eachDate('2026-10-17', '2026-10-19')).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(nextSaturday('2026-10-17')).toBe('2026-10-24'); // 17/10/2026 es sábado
    expect(nextSaturday('2026-10-15')).toBe('2026-10-17');
    expect(shortRange('2026-10-17', '2026-10-19')).toBe('17–19/10');
    expect(shortRange('2026-10-30', '2026-11-02')).toBe('30/10–2/11');
    expect(todayIso(new Date('2026-10-17T02:00:00Z'))).toBe('2026-10-16'); // UTC-3
  });
});

describe('normalizeSkeleton', () => {
  it('ordena por fecha, arma días contiguos y traslados válidos', () => {
    const p = normalizeSkeleton(sk(), ids);
    expect(p.legs.map((l) => l.city)).toEqual(['Montevideo', 'Buenos Aires']);
    expect(p.legs.map((l) => l.sort_order)).toEqual([0, 1]);
    expect(p.legs[0].dates).toHaveLength(3);
    expect(p.legs[1].dates).toHaveLength(5);
    const all = new Set(p.legs.flatMap((l) => l.dates));
    expect(all.size).toBe(8);
    expect(p.start_date).toBe('2026-10-17');
    expect(p.end_date).toBe('2026-10-24');
    expect(p.transfers).toEqual([{ from_key: 'mvd', to_key: 'bsas', date: '2026-10-20', mode: 'ferry', duration_min: 180 }]);
  });

  it('tramos paralelos: comparten fechas', () => {
    const p = normalizeSkeleton(
      sk({
        legs: [
          { key: 'mvd', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-17', end_date: '2026-10-19', includes_organizer: true, participant_names: ['Sofi'], parallel_with: [], why: '' },
          { key: 'col', city: 'Colonia del Sacramento', country: 'Uruguay', start_date: '2026-10-20', end_date: '2026-10-21', includes_organizer: true, participant_names: [], parallel_with: ['bsas-sofi'], why: '' },
          { key: 'bsas-sofi', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-20', end_date: '2026-10-21', includes_organizer: false, participant_names: ['Sofi'], parallel_with: ['col'], why: '' },
          { key: 'bsas', city: 'Buenos Aires', country: 'Argentina', start_date: '2026-10-22', end_date: '2026-10-24', includes_organizer: true, participant_names: ['Sofi'], parallel_with: [], why: '' },
        ],
        transfers: [
          { from_key: 'mvd', to_key: 'col', date: '2026-10-20', mode: 'bus', duration_min: 150, participant_names: [] },
          { from_key: 'mvd', to_key: 'bsas-sofi', date: '2026-10-20', mode: 'ferry', duration_min: 180, participant_names: ['Sofi'] },
          { from_key: 'col', to_key: 'bsas', date: '2026-13-01', mode: 'ferry', duration_min: 75, participant_names: [] },
          { from_key: 'nope', to_key: 'bsas', date: '2026-10-22', mode: 'ferry', duration_min: 75, participant_names: [] },
        ],
      }),
      ids,
    );
    expect(p.legs).toHaveLength(4);
    expect(p.legs[1].dates).toEqual(p.legs[2].dates);
    expect(p.legs.find((l) => l.key === 'bsas-sofi')!.includes_organizer).toBe(false);
    expect(p.transfers).toHaveLength(3); // el de key inexistente se descarta
    expect(p.transfers[2].date).toBe('2026-10-22'); // fecha inválida → primer día del destino
    expect(describeLegs(p.legs)).toBe(
      'Armé 4 tramos: Montevideo (17–19/10), Colonia del Sacramento y Buenos Aires en paralelo (20–21/10), Buenos Aires (22–24/10)',
    );
  });

  it('errores legibles', () => {
    expect(() => normalizeSkeleton(sk({ legs: [] }), ids)).toThrow(/sin tramos/);
    expect(() =>
      normalizeSkeleton(sk({ legs: [{ ...sk().legs[0], start_date: '17/10' }] }), ids),
    ).toThrow(/Fechas inválidas/);
    expect(() =>
      normalizeSkeleton(sk({ legs: [{ ...sk().legs[0], start_date: '2026-01-01', end_date: '2026-03-01' }] }), ids),
    ).toThrow(/más de 30 días/);
  });
});

describe('nombres → miembros / participants_hint', () => {
  const members = [
    { user_id: 'u-juan', display_name: 'Juan Pérez' },
    { user_id: 'u-sofi', display_name: 'Sofía Gómez' },
    { user_id: 'u-ana', display_name: 'Ana' },
  ];
  it('matchea por primer nombre sin tildes y deja el resto como hint', () => {
    expect(matchNames(['ana', 'Sofi', 'Juan', 'Leo'], members, 'u-juan')).toEqual({
      memberIds: ['u-ana'],
      unmatched: ['Sofi', 'Leo'],
    });
    expect(matchNames(['Sofía'], members, 'u-juan').memberIds).toEqual(['u-sofi']);
  });
});

describe('herramienta plan_trip', () => {
  it('input: conversación obligatoria, trip_id opcional', () => {
    const I = toolDefs.plan_trip.input;
    expect(I.safeParse({ conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires' }] }).success).toBe(true);
    expect(I.safeParse({ conversation: [] }).success).toBe(false);
    expect(I.safeParse({ conversation: [{ role: 'user', text: 'x' }], start_date: '17/10' }).success).toBe(false);
  });

  it('título desde la conversación', () => {
    expect(titleFromConversation({ conversation: [{ role: 'assistant', text: '¿A dónde?' }, { role: 'user', text: 'montevideo y buenos aires.' }] })).toBe(
      'Montevideo y buenos aires',
    );
  });

  it('respuestas compactas para el modelo', () => {
    const add = JSON.parse(
      compactForPlanner('add_block', { ok: true, data: { mode: 'applied', block: { id: 'b1', title: 'Mercado', day_id: 'd1', lat: 1, lng: 2 } } }),
    );
    expect(add).toEqual({ ok: true, mode: 'applied', block_id: 'b1', title: 'Mercado', day_id: 'd1' });
    const det = JSON.parse(compactForPlanner('place_details', { ok: true, data: { name: 'X', phone: '1', website: 'w', weekday_hours: ['a'] } }));
    expect(det.data).toEqual({ name: 'X', weekday_hours: ['a'] });
    expect(JSON.parse(compactForPlanner('add_block', { ok: false, error: { code: 'x', message: 'y' } }))).toMatchObject({ ok: false });
  });
});

describe('prompts', () => {
  it('el esqueleto lleva hoy, próximo sábado y la conversación', () => {
    const t = renderSkeletonRequest({
      input: { conversation: [{ role: 'user', text: 'Montevideo y Buenos Aires, 8 días' }] },
      today: '2026-10-15',
      organizerId: 'u1',
      profiles: [{ user_id: 'u1', display_name: 'Juan Pérez', pace: 'balanced' }],
    });
    expect(t).toContain('2026-10-15');
    expect(t).toContain('Próximo sábado: 2026-10-17');
    expect(t).toContain('Organizador: Montevideo y Buenos Aires, 8 días');
    expect(t).toContain('Juan: organizador; ritmo equilibrado (balanced)');
  });

  it('el contexto del tramo lleva ids de viaje, tramo y días', () => {
    const t = legContext({
      trip_id: 'T1',
      leg: { id: 'L1', city: 'Montevideo', country: 'Uruguay', start_date: '2026-10-17', end_date: '2026-10-18', lat: -34.9, lng: -56.2 },
      days: [
        { id: 'D1', date: '2026-10-17' },
        { id: 'D2', date: '2026-10-18' },
      ],
      conversation: [{ role: 'user', text: 'ni loco boliche' }],
      organizerId: 'u1',
      profiles: [],
      participantNames: ['Sofi'],
      arrivals: [],
      savedPlaces: [],
      webSearch: false,
    });
    expect(t).toContain('trip_id: T1');
    expect(t).toContain('leg_id: L1');
    expect(t).toContain('sáb 17/10 (sábado 2026-10-17): day_id D1');
    expect(t).toContain('Sofi');
    expect(t).toContain('ni loco boliche');
  });
});

describe('config y costos', () => {
  it('defaults del PRD y overrides por env', () => {
    expect(plannerConfig({})).toMatchObject({ effort: 'high', webSearch: true, maxTokens: 16000, concurrency: 3 });
    expect(plannerConfig({ PLANNER_EFFORT: 'medium', PLANNER_WEB_SEARCH: 'false', PLANNER_MAX_TOKENS: '8000' })).toMatchObject({
      effort: 'medium',
      webSearch: false,
      maxTokens: 8000,
    });
    expect(plannerConfig({ PLANNER_EFFORT: 'turbo' }).effort).toBe('high');
  });

  it('suma usage y estima costo (Opus 5.5)', () => {
    const u = addUsage(emptyUsage(), { input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 2 } });
    expect(u.web_search_requests).toBe(2);
    expect(estimateCostUsd(u)).toBeCloseTo(4 + 2 + 0.02, 4);
  });
});
