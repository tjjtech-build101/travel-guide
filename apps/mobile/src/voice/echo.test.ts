// Tests de las partes puras de la voz. Sin dependencias: `pnpm --filter mobile test:voice` (tsx).
let failures = 0;
const assert = {
  ok(v: unknown, msg = 'esperaba true') {
    if (!v) {
      failures++;
      console.error('✗', msg, new Error().stack?.split('\n')[2]?.trim());
    }
  },
  equal(a: unknown, b: unknown) {
    assert.ok(a === b, `${String(a)} !== ${String(b)}`);
  },
  deepEqual(a: unknown, b: unknown) {
    assert.ok(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  },
};

import { echoScore, looksLikeEcho } from './echo';
import { actionText, parseArgs } from './toolText';

// Casos reales del simulador (el scout se escuchó a sí mismo).
assert.ok(looksLikeEcho('Todo bien por aquí.', '¡Todo bien por acá! ¿Qué necesitás organizar ahora?'));
assert.ok(looksLikeEcho('Buenísimo.', 'Buenísimo, me alegro. ¿Qué andás necesitando ahora para el plan?') === false); // 1 palabra: no alcanza
assert.ok(looksLikeEcho('¿En qué te doy una mano ahora?', '¡Hola, Sofi! ¿En qué te doy una mano ahora?'));
assert.ok(looksLikeEcho('me alegro que andás necesitando para el plan', 'Buenísimo, me alegro. ¿Qué andás necesitando ahora para el plan?'));
// Preguntas genuinas no son eco.
assert.ok(!looksLikeEcho('Agendame un café a las 17', 'Mirá, a las 18:30 tienen la rambla al atardecer.'));
assert.ok(!looksLikeEcho('¿Y eso en qué año fue?', 'Ciudad Vieja fue el núcleo original de Montevideo.'));
assert.equal(echoScore('', 'hola'), 0);

assert.deepEqual(parseArgs(''), {});
assert.equal(parseArgs('[1]'), null);
assert.equal(parseArgs('{mal'), null);

const ok = (data: unknown) => ({ ok: true as const, data, undo_token: 'tok' });
assert.deepEqual(actionText('add_block', ok({ mode: 'applied', block: { title: 'Café', start_time: '17:00:00' } })), {
  text: 'Agregué «Café» · 17:00',
  proposed: false,
});
assert.deepEqual(actionText('add_block', ok({ mode: 'proposed' })), { text: 'Propuesta enviada al grupo', proposed: true });
assert.equal(actionText('search_places', { ok: true, data: [] }), null);

if (failures) throw new Error(`${failures} fallas`);
console.log('voice: ok');
