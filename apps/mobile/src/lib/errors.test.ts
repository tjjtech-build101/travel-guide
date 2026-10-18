// Tests de lib/errors (texto de errores para la persona). `npx tsx src/lib/errors.test.ts` desde apps/mobile.
import { describeError, errorLine, isReadable, toAppError } from './errors';

// Sin node:assert (la app no tiene tipos de Node): asserts mínimos como los otros tests.
const assert = {
  equal(a: unknown, b: unknown) {
    if (a !== b) throw new Error(`esperado ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`);
  },
  deepEqual(a: unknown, b: unknown) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`esperado ${JSON.stringify(b)}, vino ${JSON.stringify(a)}`);
  },
  match(s: string, re: RegExp) {
    if (!re.test(s)) throw new Error(`${JSON.stringify(s)} no matchea ${re}`);
  },
  ok(c: unknown, msg = 'falso') {
    if (!c) throw new Error(msg);
  },
};

let n = 0;
let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    n++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

test('sin créditos de Claude (ToolError clasificado)', () => {
  const v = describeError({ code: 'provider_no_credits', message: 'x', provider: 'anthropic' }, { doing: 'armar el viaje' });
  assert.equal(v.title, 'Me quedé sin nafta');
  assert.match(v.body, /Claude \(Anthropic\) se quedó sin créditos/);
  assert.match(v.body, /No pude armar el viaje/);
  assert.equal(v.retryable, false);
  assert.match(v.hint ?? '', /console\.anthropic\.com/);
});

test('fila de agent_jobs con error_code', () => {
  const row = { status: 'failed', error: 'OpenAI se quedó sin créditos', error_code: 'provider_no_credits', error_provider: 'openai' };
  assert.deepEqual(toAppError(row), { code: 'provider_no_credits', message: row.error, provider: 'openai' });
});

test('job viejo con el error crudo de Anthropic (sin error_code)', () => {
  const row = {
    status: 'failed',
    error: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}',
    error_code: null,
  };
  const v = describeError(row);
  assert.equal(v.code, 'provider_no_credits');
  assert.equal(v.tag, 'Claude (Anthropic)');
});

test('error de red de fetch', () => {
  const v = describeError(new TypeError('Network request failed'));
  assert.equal(v.code, 'network_error');
  assert.equal(v.title, 'Sin conexión');
  assert.equal(v.retryable, true);
});

test('sesión vencida → volver a entrar', () => {
  const v = describeError({ code: 'unauthorized', message: 'Tu sesión venció.' });
  assert.equal(v.action, 'login');
});

test('conflicto con mensaje del servidor legible se muestra tal cual', () => {
  const v = describeError({ code: 'proposal_decided', message: 'Esa propuesta ya la decidió otra persona.' });
  assert.equal(v.body, 'Esa propuesta ya la decidió otra persona.');
});

test('nunca muestra JSON / inglés crudo', () => {
  const v = describeError({ code: 'weird_code', message: 'TypeError: Cannot read properties of undefined' });
  assert.ok(!/undefined/.test(v.body));
  assert.equal(isReadable('500 {"error":"x"}'), false);
  assert.equal(isReadable('No encontré ese bloque.'), true);
});

test('upstream_error viejo con texto de rate limit', () => {
  assert.equal(toAppError({ code: 'upstream_error', message: 'OpenAI 429: Rate limit reached' }).code, 'provider_rate_limited');
});

test('errorLine', () => {
  assert.match(errorLine({ code: 'network_error', message: '' }), /^Sin conexión\. Revisá/);
});

test('errores de Postgrest (consultas directas a Supabase) no salen en inglés', () => {
  const denied = describeError({ code: '42501', message: 'permission denied for table blocks', details: null, hint: null });
  assert.equal(denied.code, 'forbidden');
  assert.ok(!/permission/.test(denied.body), denied.body);
  assert.equal(describeError({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null }).action, 'login');
  const other = describeError({ code: '23505', message: 'duplicate key value violates unique constraint', details: 'x', hint: null });
  assert.equal(other.code, 'db_error');
  assert.match(other.detail ?? '', /duplicate key/);
});

console.log(failures ? `${failures} fallaron` : `${n} tests ok`);
if (failures) throw new Error(`${failures} tests fallaron`);
