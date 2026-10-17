import { describe, expect, it } from 'vitest';
import { clampBrief, NOW_BRIEF_MAX, nowBriefRules } from './nowBrief';
import type { NowBriefSnapshotT } from './tools/nowTools';

const base: NowBriefSnapshotT = { local_time: '14:00', hero: 'state' };
const next = { title: 'Almuerzo' };

describe('nowBriefRules', () => {
  it('leave: en X min, ya y tarde', () => {
    expect(nowBriefRules({ ...base, hero: 'leave', next, leave_in_min: 6, walk_min: 8 })).toBe(
      'Salí en 6 min para Almuerzo: son 8 min a pie.',
    );
    expect(nowBriefRules({ ...base, hero: 'leave', next, leave_in_min: 0 })).toBe('Salí ya para Almuerzo.');
    expect(nowBriefRules({ ...base, hero: 'leave', next, leave_in_min: -7 })).toBe('Vas 7 min tarde a Almuerzo. ¿Aviso al grupo?');
  });

  it('leave sin próximo ni minutos no dice "undefined" ni "null"', () => {
    const a = nowBriefRules({ ...base, hero: 'leave' });
    const b = nowBriefRules({ ...base, hero: 'leave', leave_in_min: 5 });
    for (const t of [a, b]) expect(t).not.toMatch(/undefined|null/);
  });

  it('free: no repite el tiempo libre (ya está en el protagonista)', () => {
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 75 })).toBe('¿Te armo algo cerca?');
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 45, suggestions: [{ title: 'Café Brasilero', walk_min: 4 }] })).toBe(
      'Café Brasilero queda a 4 min: ¿lo sumamos?',
    );
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 45, weather: { rain_soon: true } })).toContain('bajo techo');
  });

  it('current: no repite la fila "Después"; ofrece contar algo del lugar', () => {
    expect(nowBriefRules({ ...base, hero: 'current', current: { title: 'Teatro Solís', place_name: 'Teatro Solís' }, next, leave_in_min: 40 })).toBe(
      'Disfrutá. ¿Te cuento algo de Teatro Solís?',
    );
    expect(nowBriefRules({ ...base, hero: 'current' })).toBe('Disfrutá, no hay apuro.');
  });

  it('tour: "Tu tour por …" y, si es más tarde, a qué hora arranca', () => {
    expect(nowBriefRules({ ...base, hero: 'tour', current: { title: 'Tour por Ciudad Vieja', type: 'tour' } })).toBe(
      'Tu tour por Ciudad Vieja está listo. Cuando quieras arrancamos.',
    );
    expect(nowBriefRules({ ...base, hero: 'tour', next: { title: 'Ciudad Vieja', type: 'tour', start_time: '11:00' } })).toBe(
      'Tu tour por Ciudad Vieja está listo. Arranca a las 11:00.',
    );
  });

  it('nunca pasa de 110 caracteres', () => {
    const long = 'Un título larguísimo de un bloque que no entra de ninguna manera en una sola frase corta de Scout';
    const t = nowBriefRules({ ...base, hero: 'leave', next: { title: long }, leave_in_min: 12, walk_min: 9 });
    expect(t.length).toBeLessThanOrEqual(NOW_BRIEF_MAX);
    expect(t.endsWith('…')).toBe(true);
  });

  it('clampBrief deja pasar lo corto', () => {
    expect(clampBrief('  Hola   vos ')).toBe('Hola vos');
  });
});
