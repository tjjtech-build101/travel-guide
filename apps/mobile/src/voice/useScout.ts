// ─────────────────────────────────────────────────────────────────────────────────────────────
// useScout(): interfaz única de la app para hablar con el Scout (voz 1 a 1, PRD 05).
// La usan la vista Ahora (PRD 19), el Plan ("Hablar de esto") y el Mapa (PRD 03). Firmas estables.
//
// Implementación: delega en el store de la llamada (voice/store.ts: OpenAI Realtime por WebRTC) y
// traduce su estado a ScoutState para el avatar:
//   connecting/reconnecting → 'connecting' · el scout suena → 'speaking'
//   herramienta corriendo o respuesta en curso → 'thinking' · resto de la llamada → 'listening'
//  - startScoutCall({ focus, tripId, mode, tourId, context }): pide el micrófono si hace falta,
//    POST /voice/session { mode, trip_id, tour_id, focus, location }, conecta y, si viene `context`,
//    lo manda como mensaje de sistema antes del saludo (la primera frase ya habla de eso).
//  - endScoutCall(): corta, POST /voice/session/:id/end { transcript } y muestra el resumen.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand';

import { env } from '../lib/env';
import { errorLine } from '../lib/errors';
import { useVoiceStore, type VoiceStore } from './store';

/** Estado de la llamada con el Scout. ScoutAvatar dibuja 'listening' | 'speaking' | 'thinking'. */
export type ScoutState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

/** = body.focus de POST /voice/session (Contratos v1.1): de qué querés hablar. */
export type ScoutFocus = {
  block_id?: string;
  google_place_id?: string;
  lat?: number;
  lng?: number;
  /** Texto corto legible ("Almuerzo en el Mercado del Puerto"). */
  label?: string;
};

export type StartScoutCallOptions = {
  focus?: ScoutFocus;
  tripId?: string;
  /** 'chat' (default) o 'tour'. */
  mode?: 'chat' | 'tour';
  tourId?: string;
  /** Contexto extra que se inyecta como primer mensaje de sistema (p. ej. el bloque completo). */
  context?: Record<string, unknown>;
};

export type UseScout = {
  /** false mientras la voz (PRD 05) no esté implementada/configurada. */
  available: boolean;
  state: ScoutState;
  /** Hay una llamada abierta (connecting, listening, thinking o speaking). */
  inCall: boolean;
  error: string | null;
  /** Último focus con el que se abrió la llamada (para mostrar "Hablando de …"). */
  focus: ScoutFocus | null;
  startScoutCall: (opts?: StartScoutCallOptions) => Promise<void>;
  endScoutCall: () => Promise<void>;
};

type ScoutStore = {
  available: boolean;
  state: ScoutState;
  error: string | null;
  focus: ScoutFocus | null;
};

export const useScoutStore = create<ScoutStore>(() => ({
  available: !!env.apiUrl,
  state: 'idle',
  error: null,
  focus: null,
}));

/** Solo para previsualizar estados del avatar (menú dev / deep link `?scout=speaking`). */
export function previewScoutState(state: ScoutState) {
  useScoutStore.setState({ state });
}

/** Estado de la llamada (voice/store) → estado del avatar. */
export function scoutStateOf(v: Pick<VoiceStore, 'status' | 'speaking' | 'responding' | 'toolsRunning'>): ScoutState {
  switch (v.status) {
    case 'connecting':
    case 'reconnecting':
      return 'connecting';
    case 'error':
      return 'error';
    case 'live':
      if (v.speaking === 'assistant') return 'speaking';
      if (v.toolsRunning.length || (v.responding && v.speaking !== 'user')) return 'thinking';
      return 'listening';
    default:
      return 'idle';
  }
}

// Sincroniza useScoutStore con la llamada (lo leen el avatar de Ahora y el menú dev).
useVoiceStore.subscribe((v) => {
  const next = {
    state: scoutStateOf(v),
    error: v.status === 'error' ? errorLine(v.error, { doing: 'conectar la llamada' }) : null,
    focus: v.status === 'idle' ? null : ((v.args?.focus as ScoutFocus | undefined) ?? null),
  };
  const cur = useScoutStore.getState();
  if (cur.state !== next.state || cur.error !== next.error || cur.focus !== next.focus) useScoutStore.setState(next);
});

async function startScoutCall(opts: StartScoutCallOptions = {}): Promise<void> {
  await useVoiceStore.getState().requestCall({
    mode: opts.mode ?? 'chat',
    tripId: opts.tripId ?? null,
    tourId: opts.tourId ?? null,
    focus: opts.focus,
    context: opts.context,
  });
}

async function endScoutCall(): Promise<void> {
  await useVoiceStore.getState().endCall();
}

export function useScout(): UseScout {
  const available = useScoutStore((s) => s.available);
  const state = useScoutStore((s) => s.state);
  const error = useScoutStore((s) => s.error);
  const focus = useScoutStore((s) => s.focus);
  return {
    available,
    state,
    error,
    focus,
    inCall: state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking',
    startScoutCall,
    endScoutCall,
  };
}
