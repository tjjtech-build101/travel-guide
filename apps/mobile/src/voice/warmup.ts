// Despierta la función de Vercel antes de que la persona toque "Hablar": la primera llamada en frío tarda ~0,7 s más
// (medido: /voice/session 1,6 s en frío contra 0,9 s caliente). Un GET /health liviano, como mucho cada 2 min.
import { AppState } from 'react-native';

import { env } from '../lib/env';

const EVERY_MS = 2 * 60_000;
let last = 0;

export function warmVoiceApi() {
  if (!env.apiUrl || Date.now() - last < EVERY_MS) return;
  last = Date.now();
  fetch(`${env.apiUrl}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

/** Al volver la app a primer plano también (Vercel apaga la función tras unos minutos sin uso). */
export function startVoiceWarmup(): () => void {
  warmVoiceApi();
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') warmVoiceApi();
  });
  return () => sub.remove();
}
