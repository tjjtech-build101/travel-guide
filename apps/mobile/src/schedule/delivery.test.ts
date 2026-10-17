// Tests de la entrega del vigilante de horarios: `pnpm --filter mobile test:schedule` (tsx, sin React Native).
import { evaluateSchedule, formatVoiceEvent, type ScheduleAlert } from '@build101/shared';

import { createDelivery, type DeliveryDeps } from './delivery';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}
function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} esperado ${b}, vino ${a}`);
}

// Un aviso real del vigilante: Teatro Solís 16:00, desde el Mercado del Puerto a las 15:33 (ETA 14).
const alert: ScheduleAlert = evaluateSchedule({
  nowMin: 15 * 60 + 33,
  here: { lat: -34.9067, lng: -56.2128 },
  blocks: [{ id: 'solis', title: 'Visita guiada al Teatro Solís', start_time: '16:00', time_flex: 'fixed', lat: -34.90722, lng: -56.20056 }],
  etas: { solis: 14 },
  sent: [],
}).alerts[0];

function fake(over: Partial<{ live: boolean; speaking: boolean; lastSpeech: number; injectOk: boolean }> = {}) {
  const st = { live: true, speaking: false, lastSpeech: -1e9, injectOk: true, t: 100_000, ...over };
  const injected: { type: string; payload: unknown; text: string }[] = [];
  const notified: ScheduleAlert[] = [];
  const deps: DeliveryDeps = {
    isLive: () => st.live,
    userSpeaking: () => st.speaking,
    lastUserSpeechAt: () => st.lastSpeech,
    injectEvent: (type, payload) => {
      injected.push({ type, payload, text: formatVoiceEvent(type, payload) });
      return st.injectOk;
    },
    notify: (a) => {
      notified.push(a);
    },
    now: () => st.t,
  };
  return { st, deps, injected, notified, d: createDelivery(deps) };
}

console.log('vigilante de horarios · entrega');

test('hay aviso de leave_now con los números exactos', () => {
  eq(alert.payload, {
    block_id: 'solis',
    title: 'Visita guiada al Teatro Solís',
    start_time: '16:00',
    kind: 'leave_now',
    eta_min: 14,
    leave_in_min: 8,
    late_by_min: null,
  });
});

test('con llamada activa → voice.injectEvent("schedule_alert", payload), sin notificación', () => {
  const f = fake();
  eq(f.d.deliver(alert), 'voice');
  eq(f.injected.length, 1);
  eq(f.injected[0].type, 'schedule_alert');
  eq(f.injected[0].payload, alert.payload);
  eq(f.injected[0].text.startsWith('[EVENTO:schedule_alert] {"block_id":"solis"'), true);
  eq(f.notified.length, 0);
});

test('sin llamada → notificación local, sin inyectar', () => {
  const f = fake({ live: false });
  eq(f.d.deliver(alert), 'notification');
  eq(f.injected.length, 0);
  eq(f.notified.length, 1);
});

test('la persona habla → espera 3 s de silencio y después inyecta', () => {
  const f = fake({ speaking: true });
  eq(f.d.deliver(alert), 'queued');
  f.d.flush();
  eq(f.injected.length, 0, 'mientras habla');
  f.st.speaking = false;
  f.st.lastSpeech = f.st.t;
  f.st.t += 2000;
  f.d.flush();
  eq(f.injected.length, 0, 'a los 2 s');
  f.st.t += 1000;
  f.d.flush();
  eq(f.injected.length, 1, 'a los 3 s');
  eq(f.d.queueSize(), 0);
});

test('se cortó la llamada con el aviso en cola → notificación', () => {
  const f = fake({ speaking: true });
  f.d.deliver(alert);
  f.st.live = false;
  f.d.flush();
  eq(f.injected.length, 0);
  eq(f.notified.length, 1);
});

test('si inyectar falla → notificación', () => {
  const f = fake({ injectOk: false });
  eq(f.d.deliver(alert), 'notification');
  eq(f.notified.length, 1);
});

if (failures) {
  console.log(`\n${failures} test(s) fallaron`);
  process.exit(1);
}
console.log('\nTodo OK');
