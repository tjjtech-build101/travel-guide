import { describe, expect, it } from 'vitest';
import { DEMO_USERS } from '@build101/shared';
import { decideWriteMode, type PolicyFacts } from './writeMode';

const { juan, ana, leo, sofi } = DEMO_USERS;
const group = { participant_ids: [juan, ana, leo], is_private: false, created_by: juan };
const base = { actorId: ana, role: 'traveler' as const, isLegMember: true };

const decide = (f: Partial<PolicyFacts> & Pick<PolicyFacts, 'actor' | 'after'>) => decideWriteMode({ ...base, ...f });

describe('regla de escritura (PRD 00)', () => {
  it('1. humano + compartido → aplica', () => {
    expect(decide({ actor: 'user', after: group }).mode).toBe('apply');
    expect(decide({ actor: 'user', before: group, after: group }).mode).toBe('apply');
  });

  it('2. agente + personal → aplica', () => {
    const mine = { participant_ids: [ana], is_private: false, created_by: ana };
    const d = decide({ actor: 'agent', after: mine });
    expect(d).toMatchObject({ mode: 'apply', personal: true });
    expect(decide({ actor: 'agent', before: mine, after: { ...mine, is_private: true } }).mode).toBe('apply');
  });

  it('3. agente + compartido → propone (no aplica)', () => {
    expect(decide({ actor: 'agent', after: group }).mode).toBe('propose');
    expect(decide({ actor: 'agent', before: group, after: group }).mode).toBe('propose');
  });

  it('4. seguidor → forbidden (403)', () => {
    expect(decide({ actor: 'user', role: 'follower', after: group }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', role: 'follower', after: { participant_ids: [ana], is_private: false } }).mode).toBe(
      'forbidden',
    );
  });

  it('5. agente sobre bloque personal de otro → forbidden (403)', () => {
    const juans = { participant_ids: [juan], is_private: false, created_by: juan };
    expect(decide({ actor: 'agent', before: juans, after: juans }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', after: { participant_ids: [sofi], is_private: false } }).mode).toBe('forbidden');
  });

  it('no miembro → forbidden; viajero fuera del tramo → forbidden; organizer fuera del tramo → aplica', () => {
    expect(decide({ actor: 'user', role: null, after: group }).mode).toBe('forbidden');
    expect(decide({ actor: 'user', isLegMember: false, after: group }).mode).toBe('forbidden');
    expect(decide({ actor: 'user', actorId: juan, role: 'organizer', isLegMember: false, after: group }).mode).toBe('apply');
  });

  it('bloque privado ajeno: nadie lo edita (ni humano ni agente)', () => {
    const priv = { participant_ids: [juan], is_private: true, created_by: juan };
    expect(decide({ actor: 'user', before: priv, after: priv }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', before: priv, after: priv }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', actorId: juan, role: 'organizer', before: priv, after: priv }).mode).toBe('apply');
  });

  it('agente que achica un compartido a [actor] no aplica directo: propone', () => {
    expect(decide({ actor: 'agent', before: group, after: { ...group, participant_ids: [ana] } }).mode).toBe('propose');
  });
});

describe('excepción de plan_trip (Contratos v1.1)', () => {
  it('agente + compartido en tramo vacío dentro del job → aplica', () => {
    expect(decide({ actor: 'agent', after: group, planEmptyLeg: true }).mode).toBe('apply');
    // sin la excepción, la regla normal
    expect(decide({ actor: 'agent', after: group, planEmptyLeg: false }).mode).toBe('propose');
  });

  it('la excepción no saltea los permisos básicos', () => {
    expect(decide({ actor: 'agent', role: 'follower', after: group, planEmptyLeg: true }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', role: null, after: group, planEmptyLeg: true }).mode).toBe('forbidden');
    expect(decide({ actor: 'agent', isLegMember: false, after: group, planEmptyLeg: true }).mode).toBe('forbidden');
  });
});
