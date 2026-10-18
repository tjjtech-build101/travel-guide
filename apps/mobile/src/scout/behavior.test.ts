// Tests del comportamiento del Scout animado. Sin dependencias: `pnpm --filter mobile test:scout` (tsx).
import { baseFace, FRAMES, levelsFromStats, mouthForLevel, poseFor } from './behavior';

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
const near = (a: number | null, b: number, msg = '') => {
  if (a === null || Math.abs(a - b) > 1e-6) throw new Error(`${msg} esperado ${b}, vino ${a}`);
};

test('poseFor: saluda al conectar, piensa con la mano en el mentón, y la pose pedida gana', () => {
  eq(poseFor('connecting'), 'wave');
  eq(poseFor('thinking'), 'think');
  eq(poseFor('speaking'), 'idle');
  eq(poseFor('thinking', 'thumbs'), 'thumbs');
});

test('baseFace: pensando sin la pose think igual frunce las cejas', () => {
  const f = baseFace('thinking', 'idle');
  eq([f.mouth, f.brows], ['hmm', 'think']);
});

test('baseFace: escuchando mira a cámara', () => {
  eq(baseFace('listening', 'idle').look, 0);
});

test('mouthForLevel: silencio cierra la boca, fuerte la abre', () => {
  eq(mouthForLevel(0, 0.1), 'rest');
  eq(mouthForLevel(0.01, 0.9), 'rest');
  eq(['M', 'E'].includes(mouthForLevel(0.06, 0.3)), true);
  eq(['A', 'O'].includes(mouthForLevel(0.4, 0.2)), true);
});

test('levelsFromStats: audioLevel de inbound-rtp (Scout) y media-source (micrófono)', () => {
  const stats = new Map<string, unknown>([
    ['a', { type: 'inbound-rtp', kind: 'audio', audioLevel: 0.3 }],
    ['b', { type: 'media-source', kind: 'audio', audioLevel: 0.05 }],
    ['c', { type: 'inbound-rtp', kind: 'video', audioLevel: 0.9 }],
    ['d', { type: 'candidate-pair' }],
  ]);
  const r = levelsFromStats(stats, {});
  near(r.out, 0.3, 'out');
  near(r.in, 0.05, 'in');
});

test('levelsFromStats: con energía acumulada calcula el RMS del intervalo', () => {
  const first = levelsFromStats(new Map([['a', { type: 'inbound-rtp', kind: 'audio', totalAudioEnergy: 1, totalSamplesDuration: 10 }]]), {});
  eq(first.out, null, 'sin muestra anterior ni audioLevel');
  // ΔE = 0.04 en Δt = 1 s → RMS = sqrt(0.04) = 0.2
  const second = levelsFromStats(new Map([['a', { type: 'inbound-rtp', kind: 'audio', totalAudioEnergy: 1.04, totalSamplesDuration: 11 }]]), first.memo);
  near(second.out, 0.2);
});

test('levelsFromStats: reporte vacío → null', () => {
  const r = levelsFromStats(new Map(), {});
  eq([r.out, r.in], [null, null]);
});

test('FRAMES: el encuadre de busto deja el sombrero adentro', () => {
  eq(FRAMES.bust.y <= 15, true);
  eq(FRAMES.head.w, 234);
});

if (failures) throw new Error(`${failures} test(s) fallaron`);
console.log('ok');
