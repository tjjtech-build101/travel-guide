// Estado de la llamada con el scout (PRD 05): idle → permission → connecting → live (↔ reconnecting) → ending → summary.
// Zustand fuera de React: el motor del tour (PRD 07) y la cámara (PRD 08) llaman injectEvent() sin componentes.
import {
  formatVoiceEvent,
  REALTIME_TRANSCRIBE_MODEL,
  voiceLangLine,
  type TranscriptLine,
  type VoiceEventType,
  type VoiceFocus,
  type VoiceSessionStart,
} from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { endVoiceSession, startVoiceSession } from './api';
import { micPermission, requestMic } from './permissions';
import { setSpeaker, startCallAudio, stopCallAudio } from './audioRoute';
import { RealtimeConnection, type ServerEvent } from './realtimeClient';
import { actionText, runFunctionCalls, toModelOutput, type FunctionCall } from './toolBridge';

export type CallStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ending' | 'summary' | 'error';

export type StartCallArgs = {
  mode?: 'chat' | 'tour';
  tripId?: string | null;
  tourId?: string | null;
  focus?: VoiceFocus;
  /** Posición actual (LocationProvider) para que el scout sepa dónde estás. */
  location?: { lat: number; lng: number; accuracy?: number | null } | null;
};

export type Line = { id: string; role: 'user' | 'assistant'; text: string; at: string; final: boolean };
export type ActionCard = { id: string; text: string; proposed: boolean; undoToken: string; tripId: string | null; at: number };
export type CallError = { code: string; message: string };

type State = {
  status: CallStatus;
  error: CallError | null;
  args: StartCallArgs | null;
  session: Pick<VoiceSessionStart, 'voice_session_id' | 'instructions_base' | 'session_config'> | null;
  scoutName: string;
  startedAt: number | null;
  /** Quién está hablando ahora (para animar el avatar). */
  speaking: 'user' | 'assistant' | null;
  /** Hay una respuesta del modelo en curso (entre response.created y response.done). */
  responding: boolean;
  muted: boolean;
  speaker: boolean;
  pushToTalk: boolean;
  captions: boolean;
  lang: string;
  lines: Line[];
  toolsRunning: { callId: string; name: string }[];
  actions: ActionCard[];
  expanded: boolean;
  summary: { jobId: string | null; voiceSessionId: string; durationS: number; tripId: string | null } | null;
  /** Llamada esperando la explicación del permiso de micrófono. */
  askPermission: StartCallArgs | null;
  /** Último evento del data channel (para el menú dev y PRD 07: esperar silencio antes de inyectar). */
  lastEventAt: number;
};

type Actions = {
  /** Lo que usan los botones: chequea el micrófono (explicación previa) y llama. */
  requestCall: (args?: StartCallArgs) => Promise<void>;
  /** Respuesta a la explicación del permiso. */
  answerPermission: (allow: boolean) => Promise<void>;
  startCall: (args?: StartCallArgs) => Promise<void>;
  endCall: () => Promise<void>;
  injectEvent: (type: VoiceEventType, payload: unknown, opts?: { respond?: boolean }) => boolean;
  setLanguage: (lang: string) => void;
  setMuted: (muted: boolean) => void;
  setSpeakerOn: (on: boolean) => void;
  setPushToTalk: (on: boolean) => void;
  setCaptions: (on: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  dismissAction: (id: string) => void;
  dismissSummary: () => void;
  startTranslator: (from: string, to: string) => void;
};

export type VoiceStore = State & Actions;

const ACTION_TTL_MS = 8000;
const MAX_ACTIONS = 3;

let conn: RealtimeConnection | null = null;
let reconnecting = false;
let tapAt = 0;
let firstAudioLogged = false;

const now = () => new Date().toISOString();

function hapticLight() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function hapticResult(ok: boolean) {
  Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
}

const initial: State = {
  status: 'idle',
  error: null,
  args: null,
  session: null,
  scoutName: '',
  startedAt: null,
  speaking: null,
  responding: false,
  muted: false,
  speaker: true,
  pushToTalk: false,
  captions: true,
  lang: 'es',
  lines: [],
  toolsRunning: [],
  actions: [],
  expanded: false,
  summary: null,
  askPermission: null,
  lastEventAt: 0,
};

export const useVoiceStore = create<VoiceStore>((set, get) => {
  // ---------- subtítulos ----------
  const upsertLine = (id: string, role: Line['role'], patch: (l: Line) => Partial<Line>) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => l.id === id);
      if (idx === -1) {
        const l: Line = { id, role, text: '', at: now(), final: false };
        return { lines: [...s.lines, { ...l, ...patch(l) }] };
      }
      const lines = s.lines.slice();
      lines[idx] = { ...lines[idx], ...patch(lines[idx]) };
      return { lines };
    });

  const applyMic = () => {
    const s = get();
    // push-to-talk (plan B del eco): mic cerrado mientras el scout habla.
    conn?.setMicEnabled(!s.muted && !(s.pushToTalk && s.speaking === 'assistant'));
  };

  // ---------- herramientas ----------
  const flushCalls = async (calls: FunctionCall[]) => {
    set((s) => ({ toolsRunning: [...s.toolsRunning, ...calls.map((c) => ({ callId: c.call_id, name: c.name }))] }));
    hapticLight();
    const results = await runFunctionCalls(calls);
    const tripId = get().args?.tripId ?? null;
    for (const { call, res } of results) {
      conn?.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: toModelOutput(res) } });
      const card = actionText(call.name, res);
      if (card && res.ok && res.undo_token) {
        const id = `${call.call_id}`;
        set((s) => ({
          actions: [...s.actions, { id, ...card, undoToken: res.undo_token!, tripId, at: Date.now() }].slice(-MAX_ACTIONS),
        }));
        setTimeout(() => get().dismissAction(id), ACTION_TTL_MS);
      }
    }
    hapticResult(results.every((r) => r.res.ok));
    set((s) => ({ toolsRunning: s.toolsRunning.filter((t) => !calls.some((c) => c.call_id === t.callId)) }));
    // Un solo response.create para todas las llamadas paralelas.
    conn?.send({ type: 'response.create' });
  };

  // ---------- eventos del data channel ----------
  const onEvent = (e: ServerEvent) => {
    set({ lastEventAt: Date.now() });
    if (__DEV__ && !e.type.endsWith('.delta') && e.type !== 'rate_limits.updated') console.log('[voice] ←', e.type);
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        // El servidor ya corta al scout (interrupt_response); nosotros cerramos su subtítulo.
        Haptics.selectionAsync().catch(() => {});
        set((s) => ({ speaking: 'user', lines: s.lines.map((l) => (l.role === 'assistant' && !l.final ? { ...l, final: true } : l)) }));
        break;
      case 'input_audio_buffer.speech_stopped':
        if (get().speaking === 'user') set({ speaking: null });
        break;
      case 'input_audio_buffer.committed':
        upsertLine(String(e.item_id), 'user', () => ({}));
        break;
      case 'conversation.item.input_audio_transcription.delta':
        upsertLine(String(e.item_id), 'user', (l) => ({ text: l.text + String(e.delta ?? '') }));
        break;
      case 'conversation.item.input_audio_transcription.completed':
        upsertLine(String(e.item_id), 'user', () => ({ text: String(e.transcript ?? '').trim(), final: true }));
        break;
      case 'response.created':
        set({ responding: true });
        break;
      case 'response.output_audio_transcript.delta':
        upsertLine(String(e.item_id), 'assistant', (l) => ({ text: l.text + String(e.delta ?? '') }));
        break;
      case 'response.output_audio_transcript.done':
        upsertLine(String(e.item_id), 'assistant', () => ({ text: String(e.transcript ?? ''), final: true }));
        break;
      case 'output_audio_buffer.started':
        if (!firstAudioLogged && tapAt) {
          firstAudioLogged = true;
          console.log(`[voice] toque → primera palabra: ${Date.now() - tapAt} ms`);
        }
        set({ speaking: 'assistant' });
        applyMic();
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (get().speaking === 'assistant') set({ speaking: null });
        applyMic();
        break;
      case 'response.done': {
        set({ responding: false });
        const response = e.response as { status?: string; output?: { type: string; call_id: string; name: string; arguments: string }[] };
        const calls = (response?.output ?? []).filter((o) => o.type === 'function_call');
        if (calls.length) {
          void flushCalls(calls.map((c) => ({ call_id: c.call_id, name: c.name, arguments: c.arguments })));
        }
        break;
      }
      case 'error': {
        const err = e.error as { message?: string; code?: string } | undefined;
        console.warn('[voice] error del servidor', err?.code, err?.message);
        break;
      }
    }
  };

  // ---------- conexión ----------
  const connect = async (args: StartCallArgs, isRetry: boolean) => {
    const t0 = Date.now();
    let sessionConfig: Record<string, unknown> | null = null;
    const c = new RealtimeConnection({
      onEvent,
      onOpen: () => {
        // Instrucciones completas (el token se creó con unas mínimas) y que el scout hable primero.
        if (sessionConfig) c.send({ type: 'session.update', session: sessionConfig });
        if (!isRetry) c.send({ type: 'response.create' });
      },
      onConnectionLost: (state) => void handleLost(state),
    });
    conn = c;
    // Mic + oferta SDP en paralelo con la API (ahorra ~300-500 ms al toque → primera palabra).
    const [s] = await Promise.all([
      startVoiceSession({
        mode: args.mode ?? 'chat',
        trip_id: args.tripId ?? undefined,
        tour_id: args.tourId ?? undefined,
        focus: args.focus,
        location: args.location ?? undefined,
        lang: isRetry ? get().lang : undefined,
      }).then((r) => {
        console.log(`[voice] sesión API ${Date.now() - t0} ms`);
        return r;
      }),
      c.prepare(),
    ]);
    sessionConfig = s.session_config;
    const timings = await c.answer(s.client_secret);
    console.log(`[voice] mic+oferta ${timings.prepare} ms · SDP ${timings.sdp} ms · total ${Date.now() - t0} ms`);
    set({
      session: { voice_session_id: s.voice_session_id, instructions_base: s.instructions_base, session_config: s.session_config },
      scoutName: s.scout.name,
      lang: s.lang,
    });
    applyMic();
    return s;
  };

  const handleLost = async (state: string) => {
    if (reconnecting || get().status !== 'live') return;
    reconnecting = true;
    console.warn('[voice] conexión perdida:', state);
    set({ status: 'reconnecting', speaking: null, responding: false });
    conn?.close();
    conn = null;
    const prevId = get().session?.voice_session_id;
    try {
      // 1 reintento con sesión nueva (mismo focus). La sesión vieja se cierra con lo que había.
      if (prevId) void endVoiceSession(prevId, finalTranscript(get().lines)).catch(() => {});
      await connect(get().args ?? {}, true);
      set({ status: 'live', lines: [] });
    } catch (e) {
      console.warn('[voice] no pude reconectar', e);
      stopCallAudio();
      set({ status: 'error', error: { code: 'reconnect_failed', message: 'No pudimos reconectar' } });
    } finally {
      reconnecting = false;
    }
  };

  return {
    ...initial,

    requestCall: async (args = {}) => {
      const p = await micPermission();
      if (p === 'granted') return get().startCall(args);
      if (p === 'undetermined') return set({ askPermission: args });
      set({ status: 'error', args, error: { code: 'mic_denied', message: 'Activá el micrófono en Ajustes' } });
    },

    answerPermission: async (allow) => {
      const args = get().askPermission;
      set({ askPermission: null });
      if (!allow || !args) return;
      if (await requestMic()) return get().startCall(args);
      set({ status: 'error', args, error: { code: 'mic_denied', message: 'Activá el micrófono en Ajustes' } });
    },

    startCall: async (args = {}) => {
      const st = get().status;
      if (st === 'connecting' || st === 'live' || st === 'reconnecting' || st === 'ending') return;
      tapAt = Date.now();
      firstAudioLogged = false;
      set({ ...initial, speaker: get().speaker, pushToTalk: get().pushToTalk, captions: get().captions, status: 'connecting', args });
      try {
        startCallAudio(get().speaker);
        await connect(args, false);
        set({ status: 'live', startedAt: Date.now() });
        hapticResult(true);
      } catch (e) {
        conn?.close();
        conn = null;
        stopCallAudio();
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[voice] no pude conectar', message);
        hapticResult(false);
        set({ status: 'error', error: { code: (e as { code?: string }).code ?? 'connect_failed', message } });
      }
    },

    endCall: async () => {
      const s = get();
      if (s.status === 'idle' || s.status === 'ending' || s.status === 'summary') return;
      set({ status: 'ending', speaking: null });
      conn?.close();
      conn = null;
      stopCallAudio();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const id = s.session?.voice_session_id;
      const durationS = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
      if (!id) {
        set({ ...initial, speaker: s.speaker, pushToTalk: s.pushToTalk, captions: s.captions });
        return;
      }
      let jobId: string | null = null;
      try {
        jobId = (await endVoiceSession(id, finalTranscript(s.lines))).job_id;
      } catch (e) {
        console.warn('[voice] no pude cerrar la sesión', e);
      }
      set({ status: 'summary', expanded: false, summary: { jobId, voiceSessionId: id, durationS, tripId: s.args?.tripId ?? null } });
    },

    injectEvent: (type, payload, opts = {}) => {
      if (!conn || get().status !== 'live') return false;
      const sent = conn.send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: formatVoiceEvent(type, payload) }] },
      });
      if (sent && opts.respond !== false) conn.send({ type: 'response.create' });
      return sent;
    },

    setLanguage: (lang) => {
      const s = get();
      set({ lang });
      if (!conn || !s.session) return;
      conn.send({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: `${s.session.instructions_base}\n${voiceLangLine(lang)}`,
          audio: { input: { transcription: { model: REALTIME_TRANSCRIBE_MODEL, language: lang } } },
        },
      });
    },

    setMuted: (muted) => {
      set({ muted });
      applyMic();
    },
    setSpeakerOn: (on) => {
      set({ speaker: on });
      setSpeaker(on);
    },
    setPushToTalk: (on) => {
      set({ pushToTalk: on });
      applyMic();
    },
    setCaptions: (captions) => set({ captions }),
    setExpanded: (expanded) => set({ expanded }),
    dismissAction: (id) => set((s) => ({ actions: s.actions.filter((a) => a.id !== id) })),
    dismissSummary: () => {
      const s = get();
      set({ ...initial, speaker: s.speaker, pushToTalk: s.pushToTalk, captions: s.captions });
    },

    startTranslator: (from, to) => {
      if (!conn) return;
      conn.send({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: `Sos intérprete. Repetí en ${to} todo lo que se diga en ${from}, y en ${from} todo lo que se diga en ${to}. Sin agregar nada.`,
          tools: [],
        },
      });
    },
  };
});

export function finalTranscript(lines: Line[]): TranscriptLine[] {
  return lines.filter((l) => l.text.trim()).map((l) => ({ role: l.role, text: l.text.trim(), at: l.at }));
}

/** API pública para otros PRDs (07 tour, 08 cámara, Ahora, Mapa). */
export function useVoice() {
  const status = useVoiceStore((s) => s.status);
  const a = useVoiceStore.getState();
  return {
    status,
    startCall: a.requestCall,
    endCall: a.endCall,
    injectEvent: a.injectEvent,
    setLanguage: a.setLanguage,
    setMuted: a.setMuted,
    startTranslator: a.startTranslator,
  };
}

export const voice = {
  start: (args?: StartCallArgs) => useVoiceStore.getState().requestCall(args),
  end: () => useVoiceStore.getState().endCall(),
  injectEvent: (type: VoiceEventType, payload: unknown, opts?: { respond?: boolean }) =>
    useVoiceStore.getState().injectEvent(type, payload, opts),
  isLive: () => useVoiceStore.getState().status === 'live',
};
