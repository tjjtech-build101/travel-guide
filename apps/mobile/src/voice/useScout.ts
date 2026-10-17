// ─────────────────────────────────────────────────────────────────────────────────────────────
// useScout(): interfaz única de la app para hablar con el Scout (voz 1 a 1, PRD 05).
//
// ESTADO: STUB. La implementación real (OpenAI Realtime por WebRTC) la hace el PRD 05 (Tomás).
// La vista Ahora (PRD 19), el Plan ("Hablar de esto") y el Mapa ya llaman a esta interfaz:
// para conectar la voz alcanza con reemplazar el cuerpo de `startScoutCall` / `endScoutCall` y
// mover `state` según los eventos de la sesión, SIN cambiar las firmas.
//
// Contrato esperado de la implementación real:
//  - startScoutCall({ focus, tripId, mode, tourId, context })
//      1. state = 'connecting'
//      2. POST /voice/session { mode, trip_id: tripId, tour_id: tourId, focus }  (Contratos v1.1)
//         → { client_secret, session_config, voice_session_id }
//      3. Conecta WebRTC. Si viene `context` (p. ej. el bloque de "Hablar de esto"), después de
//         conectar manda un conversation.item.create de sistema con el JSON y pide response.create
//         (PRD 19, notas técnicas).
//      4. Mientras dura: 'listening' (mic abierto, el usuario habla) · 'thinking' (esperando
//         respuesta o corriendo una herramienta) · 'speaking' (el Scout está hablando).
//      5. Si falla: state = 'error' y `error` con un texto para mostrar (voseo).
//  - endScoutCall(): corta, POST /voice/session/:id/end { transcript } y state = 'idle'.
//  - `available`: true cuando la voz está implementada y configurada (la UI muestra "pronto" si es false).
//
// El estado vive en un store global (zustand): cualquier pantalla que muestre el ScoutAvatar ve
// el mismo estado de la llamada en curso.
// ─────────────────────────────────────────────────────────────────────────────────────────────
import { SCOUT } from '@build101/shared';
import { Alert } from 'react-native';
import { create } from 'zustand';

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
  available: false,
  state: 'idle',
  error: null,
  focus: null,
}));

/** Solo para previsualizar estados del avatar (menú dev / deep link `?scout=speaking`). */
export function previewScoutState(state: ScoutState) {
  useScoutStore.setState({ state });
}

// ───────── STUB (reemplazar en PRD 05)

let stubTimer: ReturnType<typeof setTimeout> | null = null;

async function startScoutCallStub(opts: StartScoutCallOptions = {}): Promise<void> {
  if (stubTimer) clearTimeout(stubTimer);
  useScoutStore.setState({ state: 'thinking', error: null, focus: opts.focus ?? null });
  stubTimer = setTimeout(() => {
    useScoutStore.setState({ state: 'idle' });
    Alert.alert(
      `La voz de ${SCOUT.name} llega muy pronto`,
      opts.focus?.label
        ? `Cuando esté lista, ${SCOUT.name} va a arrancar hablando de "${opts.focus.label}".`
        : `Cuando esté lista, vas a poder hablar con ${SCOUT.name} desde acá.`,
    );
  }, 1200);
}

async function endScoutCallStub(): Promise<void> {
  if (stubTimer) clearTimeout(stubTimer);
  useScoutStore.setState({ state: 'idle', focus: null });
}

// ─────────

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
    startScoutCall: startScoutCallStub,
    endScoutCall: endScoutCallStub,
  };
}
