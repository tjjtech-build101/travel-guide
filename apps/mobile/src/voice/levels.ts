// Volumen en vivo de la llamada para animar al Scout: cuánto suena él (out) y cuánto hablás vos (in).
// Mientras la llamada está 'live' lee getStats ~12 veces por segundo; si la plataforma no trae el dato queda en null
// y el avatar usa bocas alternadas. Fuera de llamada no corre nada.
import { levelsFromStats, type EnergyMemo } from '../scout/behavior';
import { callStats, useVoiceStore } from './store';

const SAMPLE_MS = 80;

export const voiceLevels: { out: number | null; in: number | null } = { out: null, in: null };

let timer: ReturnType<typeof setInterval> | null = null;
let memo: EnergyMemo = {};
let busy = false;

async function sample() {
  if (busy) return;
  busy = true;
  try {
    const stats = await callStats();
    if (!stats) return;
    const r = levelsFromStats(stats, memo);
    memo = r.memo;
    voiceLevels.out = r.out;
    voiceLevels.in = r.in;
  } catch {
    voiceLevels.out = null;
    voiceLevels.in = null;
  } finally {
    busy = false;
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  memo = {};
  voiceLevels.out = null;
  voiceLevels.in = null;
}

useVoiceStore.subscribe((s) => {
  if (s.status === 'live' && !timer) timer = setInterval(() => void sample(), SAMPLE_MS);
  else if (s.status !== 'live' && timer) stop();
});
