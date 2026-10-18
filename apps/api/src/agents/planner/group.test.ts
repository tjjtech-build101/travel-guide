import { describe, expect, it } from 'vitest';
import type { TripUnderstanding } from '@build101/shared';
import { buildPlannerGroup, type GroupMemberInput } from './group';

const mem = (over: Partial<GroupMemberInput> = {}): GroupMemberInput => ({
  user_id: 'u1',
  display_name: 'Sofía Pérez',
  interests: null,
  avoid: [],
  dietary: [],
  pace: null,
  chronotype: null,
  budget_level: null,
  mobility: null,
  trip_prefs: null,
  ...over,
});

const und = (over: Partial<TripUnderstanding> = {}): TripUnderstanding => ({
  destinations: [{ city: 'Buenos Aires', country: 'Argentina' }],
  start_date: null,
  end_date: null,
  days: null,
  travelers: null,
  party: null,
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
  ...over,
});

describe('buildPlannerGroup', () => {
  it('combina intereses de perfiles, trip_prefs y conversación', () => {
    const g = buildPlannerGroup({
      members: [
        mem({ interests: { arte: 5, comida: 3 }, trip_prefs: { interests: { comida: 5 } } }),
        mem({ user_id: 'u2', display_name: 'Juan', interests: { arte: 3, deporte: 4, inventado: 5 } }),
      ],
      understanding: und({ interests: { historia: 4, arte: 2 } }),
    });
    expect(g.weights.arte).toBe(4); // promedio 5 y 3; la conversación (2) no lo baja
    expect(g.weights.comida).toBe(5); // trip_prefs pisa al perfil
    expect(g.weights.historia).toBe(4);
    expect(g.weights.inventado).toBeUndefined();
    expect(g.members[0].name).toBe('Sofía');
  });

  it('el más lento manda salvo que la conversación diga otro', () => {
    const members = [mem({ pace: 'intense' }), mem({ user_id: 'u2', pace: 'relaxed' })];
    expect(buildPlannerGroup({ members }).pace).toBe('relaxed');
    expect(buildPlannerGroup({ members, understanding: und({ pace: 'balanced' }) }).pace).toBe('balanced');
    expect(buildPlannerGroup({ members: [mem()] }).pace).toBe('balanced');
  });

  it('trip_prefs defensivo: must/avoid como lista o texto, basura ignorada', () => {
    const g = buildPlannerGroup({
      members: [
        mem({ avoid: ['museos'], trip_prefs: { must: ['La Bombonera'], avoid: 'boliches, multitudes', interests: 'nope' } }),
        mem({ user_id: 'u2', trip_prefs: 'cualquier cosa' }),
        mem({ user_id: 'u3', trip_prefs: { must: [1, null, 'Caminito'] } }),
      ],
      understanding: und({ must: ['Teatro Colón'], avoid: ['Museos'] }),
    });
    expect(g.must).toEqual(['La Bombonera', 'Caminito', 'Teatro Colón']);
    expect(g.avoid.map((a) => a.toLowerCase()).sort()).toEqual(['boliches', 'multitudes', 'museos']);
  });

  it('chicos, primera vez, movilidad y presupuesto', () => {
    const base = [mem({ budget_level: 'high', mobility: { step_free: true, max_walk_km: 2 } }), mem({ user_id: 'u2', budget_level: 'mid' })];
    const g = buildPlannerGroup({ members: base });
    expect(g.hasKids).toBe(false);
    expect(g.firstTime).toBe(true);
    expect(g.stepFree).toBe(true);
    expect(g.members[0].max_walk_km).toBe(2);
    expect(g.budget).toBe('mid');
    expect(buildPlannerGroup({ members: base, understanding: und({ kids_ages: ['6'], first_time: false, budget: 'low' }) })).toMatchObject({
      hasKids: true,
      firstTime: false,
      budget: 'low',
    });
    expect(buildPlannerGroup({ members: [mem({ trip_prefs: { companions: 'con mis hijos' } })] }).hasKids).toBe(true);
    expect(buildPlannerGroup({ members: base, understanding: und({ party: 'family', notes: ['vamos con los chicos'] }) }).hasKids).toBe(true);
  });

  it('cronotipo: el que más se repite, empate = normal', () => {
    expect(buildPlannerGroup({ members: [mem({ chronotype: 'early' }), mem({ user_id: 'u2', chronotype: 'early' }), mem({ user_id: 'u3', chronotype: 'night' })] }).chronotype).toBe('early');
    expect(buildPlannerGroup({ members: [mem({ chronotype: 'early' }), mem({ user_id: 'u2', chronotype: 'night' })] }).chronotype).toBe('normal');
  });
});
