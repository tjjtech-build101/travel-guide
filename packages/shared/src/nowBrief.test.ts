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

  it('free: con hueco, sin hueco, con sugerencia y con lluvia', () => {
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 75 })).toBe('Tenés 1 h 15 libres. ¿Te armo algo cerca?');
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: null })).toBe('Tenés el resto del día libre. ¿Te armo algo cerca?');
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 45, suggestions: [{ title: 'Café Brasilero', walk_min: 4 }] })).toBe(
      'Tenés 45 min libres. Café Brasilero queda a 4 min.',
    );
    expect(nowBriefRules({ ...base, hero: 'free', gap_min: 45, weather: { rain_soon: true } })).toContain('bajo techo');
  });

  it('current: avisa la salida si es dentro de la hora', () => {
    expect(nowBriefRules({ ...base, hero: 'current', next, leave_in_min: 40 })).toBe('Disfrutá. En 40 min salís para Almuerzo.');
    expect(nowBriefRules({ ...base, hero: 'current', next, leave_in_min: 200 })).toBe('Disfrutá. Después sigue Almuerzo.');
    expect(nowBriefRules({ ...base, hero: 'current' })).toBe('Disfrutá, no hay apuro.');
  });

  it('tour nombra el tour', () => {
    expect(nowBriefRules({ ...base, hero: 'tour', current: { title: 'Tour Ciudad Vieja' } })).toBe(
      'Tour Ciudad Vieja está listo. Cuando quieras arrancamos.',
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
