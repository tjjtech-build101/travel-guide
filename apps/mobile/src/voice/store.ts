// Estado de la llamada con el scout (PRD 05): idle → permission → connecting → live (↔ reconnecting) → ending → summary.
// Zustand fuera de React: el motor del tour (PRD 07) y la cámara (PRD 08) llaman injectEvent() sin componentes.
import {
  BARGE_IN_TURN_DETECTION,
  composeVoiceInstructions,
  formatVoiceEvent,
  languageSwitchMessage,
  REALTIME_TRANSCRIBE_MODEL,
  type VoiceSourceGroup,
  type ResearchResult,
  type TranscriptLine,
  type VoiceEventType,
  type VoiceFocus,
  type VoiceSessionStart,
} from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { endVoiceSession, startVoiceSession } from './api';
import { looksLikeEcho } from './echo';
import { micPermission, requestMic } from './permissions';
import { setSpeaker, startCallAudio, stopCallAudio } from './audioRoute';
import { RealtimeConnection, type ServerEvent } from './realtimeClient';
import { camera, setBeforeCameraOpen } from './camera/cameraStore';
import { watchJob, watchTourJob } from './tourWatch';
import { actionText, registerLocalTool, runFunctionCalls, toModelOutput, type FunctionCall } from './toolBridge';
import { promisedWithoutCalling } from './toolText';

export type CallStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ending' | 'summary' | 'error';

export type StartCallArgs = {
  mode?: 'chat' | 'tour';
  tripId?: string | null;
  tourId?: string | null;
  focus?: VoiceFocus;
  /** Posición actual; si no viene, se toma del LocationProvider registrado (setLocationSource). */
  location?: { lat: number; lng: number; accuracy?: number | null } | null;
  /** Contexto de la pantalla (bloque, punto del mapa): va como mensaje de sistema antes del saludo. */
  context?: Record<string, unknown>;
  /** Sin saludo: la llamada se abre para narrar algo que llega enseguida (p. ej. la foto de la cámara). */
  silentOpen?: boolean;
};

type Fix = { lat: number; lng: number; accuracy?: number | null; heading?: number | null } | null;
let locationSource: () => Fix = () => null;
/** VoiceProvider registra el LocationProvider actual (real | simulado): el store vive fuera de React. */
export function setLocationSource(fn: () => Fix) {
  locationSource = fn;
}
/** Última posición del LocationProvider actual (la cámara la usa: en modo simulado sale del track). */
export function currentLocation(): Fix {
  return locationSource();
}

export type Line = { id: string; role: 'user' | 'assistant'; text: string; at: string; final: boolean };
export type ActionCard = { id: string; text: string; proposed: boolean; undoToken: string; tripId: string | null; at: number };
export type CallError = { code: string; message: string };
export type VoiceLogEntry = { at: number; dir: '←' | '→' | '🔧' | '⚠️'; text: string };

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
  /**
   * Por turnos (default): el mic se cierra mientras el scout suena y se reabre TAIL_MS después (sin auriculares el
   * micrófono escucha el parlante). false = abierto: se lo puede cortar con la voz (auriculares).
   */
  turnTaking: boolean;
  captions: boolean;
  lang: string;
  lines: Line[];
  toolsRunning: { callId: string; name: string }[];
  actions: ActionCard[];
  expanded: boolean;
  summary: { jobId: string | null; voiceSessionId: string; durationS: number; tripId: string | null } | null;
  /** Fuentes de lo que contó el scout en esta llamada (research, cámara, paradas), más nuevas al final. */
  sources: VoiceSourceGroup[];
  /** Hoja de Fuentes abierta. */
  sourcesOpen: boolean;
  /** Consola de eventos (dev): lo que pasa por el data channel y las herramientas, más nuevo al final. */
  events: VoiceLogEntry[];
  /** Aviso corto en la llamada ("Activé el modo por turnos…"). */
  notice: string | null;
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
  setTurnTaking: (on: boolean) => void;
  setCaptions: (on: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  dismissAction: (id: string) => void;
  dismissSummary: () => void;
  startTranslator: (from: string, to: string) => void;
  /** Corta al scout (botón "Interrumpir", sobre todo en modo por turnos). */
  interrupt: () => void;
  /** Suma un grupo de fuentes (dedupe por url + texto); la cámara y los jobs lo llaman. */
  addSources: (g: Omit<VoiceSourceGroup, 'id' | 'at'>) => void;
  setSourcesOpen: (open: boolean) => void;
};

export type VoiceStore = State & Actions;

const ACTION_TTL_MS = 8000;
const MAX_ACTIONS = 3;

let conn: RealtimeConnection | null = null;
let reconnecting = false;
let tapAt = 0;
let micFallback: ReturnType<typeof setTimeout> | null = null;
/** El parlante está sonando (incluye la cola de TAIL_MS después de que termina el audio del scout). */
let scoutAudible = false;
let tailTimer: ReturnType<typeof setTimeout> | null = null;
const TAIL_MS = 600;
/** Detección de turno actual del lado del servidor: la normal (session_config) o la de "barge-in" mientras habla. */
let vadMode: 'normal' | 'barge' = 'normal';
const MAX_EVENTS = 200;
let echoCount = 0;
/** Eventos que llegaron mientras la llamada conectaba: se mandan apenas está en vivo. */
/** Último recordatorio de "dijiste que lo buscabas" (máximo uno cada 30 s, para no entrar en loop). */
let lastNudgeAt = 0;
/** Última function call y jobs que se están escuchando: "te aviso cuando esté" después de una llamada es correcto. */
let lastToolAt = 0;
let jobsWatching = 0;
let pendingEvents: { type: VoiceEventType; payload: unknown; respond: boolean }[] = [];
/** Hay una respuesta del modelo en curso en el servidor (entre response.created y response.done). */
let responseActive = false;
/** Se pidió un response.create mientras había otra en curso: se manda al terminar (evita conversation_already_has_active_response). */
let responseQueued = false;
let responseWatchdog: ReturnType<typeof setTimeout> | null = null;
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
  turnTaking: false,
  captions: true,
  lang: 'es',
  lines: [],
  toolsRunning: [],
  actions: [],
  expanded: false,
  summary: null,
  notice: null,
  sources: [],
  sourcesOpen: false,
  events: [],
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
    // Por turnos: mic cerrado mientras el scout suena (y la cola), así no se escucha a sí mismo.
    const closedForTurn = s.turnTaking && scoutAudible;
    conn?.setMicEnabled(!s.muted && !closedForTurn);
    if (micFallback) clearTimeout(micFallback);
    micFallback = null;
    // Si nunca llega output_audio_buffer.stopped, no dejar el mic cerrado para siempre.
    if (closedForTurn) {
      micFallback = setTimeout(() => {
        scoutAudible = false;
        if (get().speaking === 'assistant') set({ speaking: null });
        applyMic();
      }, 30_000);
    }
  };

  /** response.create con cola: si el servidor ya está respondiendo, se manda cuando termine. */
  const requestResponse = () => {
    if (!conn) return;
    if (responseActive) {
      responseQueued = true;
      return;
    }
    responseActive = true; // optimista: hasta que llegue response.created
    conn.send({ type: 'response.create' });
    // Si el pedido falló y nunca llega response.created, que la cola no quede trabada.
    if (responseWatchdog) clearTimeout(responseWatchdog);
    responseWatchdog = setTimeout(() => {
      if (responseActive && !get().responding) responseActive = false;
    }, 4000);
  };

  const log = (dir: VoiceLogEntry['dir'], text: string) =>
    set((s) => ({ events: [...s.events.slice(-(MAX_EVENTS - 1)), { at: Date.now(), dir, text }] }));

  /** Mic abierto: mientras el scout suena, VAD con umbral alto (el eco atenuado no lo corta, tu voz sí). */
  const setVad = (mode: 'normal' | 'barge') => {
    const s = get();
    if (vadMode === mode || !conn || !s.session || s.turnTaking) return;
    vadMode = mode;
    const normal = (s.session.session_config as { audio?: { input?: { turn_detection?: unknown } } }).audio?.input?.turn_detection;
    conn.send({
      type: 'session.update',
      session: { type: 'realtime', audio: { input: { turn_detection: mode === 'barge' ? BARGE_IN_TURN_DETECTION : normal } } },
    });
    log('→', `turn_detection ${mode === 'barge' ? 'exigente (scout hablando)' : 'normal'}`);
  };

  /** Cambia idioma: instrucciones (idioma arriba y abajo), transcripción y un mensaje de sistema explícito. */
  const applyLanguage = (lang: string, announce: boolean) => {
    const s = get();
    set({ lang });
    if (!conn || !s.session) return;
    conn.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: composeVoiceInstructions(s.session.instructions_base, lang),
        audio: { input: { transcription: { model: REALTIME_TRANSCRIBE_MODEL, language: lang } } },
      },
    });
    conn.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: languageSwitchMessage(lang, announce) }] },
    });
    // Desde la barra: que confirme ya en el idioma nuevo. Desde set_language la respuesta llega sola tras el output.
    if (announce) requestResponse();
    log('→', `idioma ${lang}`);
  };

  // Por voz ("mirá esto", "¿qué dice esa placa?"): abre la cámara y devuelve enseguida. La narración llega después
  // como [EVENTO:photo_result] (así no hay doble respuesta).
  registerLocalTool('look_at_photo', async (input) => {
    const question = typeof input.question === 'string' ? input.question : null;
    camera.open({ question, source: 'voice' });
    log('🔧', `cámara abierta${question ? `: «${question}»` : ''}`);
    return { ok: true, data: { status: 'capturing' } };
  });
  setBeforeCameraOpen(() => {
    if (!get().expanded) return false;
    set({ expanded: false });
    return true;
  });

  registerLocalTool('set_language', async (input) => {
    const lang = String(input.lang ?? '').trim().slice(0, 2).toLowerCase();
    if (!/^[a-z]{2}$/.test(lang)) return { ok: false, error: { code: 'invalid_input', message: 'lang = código ISO de 2 letras' } };
    applyLanguage(lang, false);
    return { ok: true, data: { lang } };
  });

  const showNotice = (notice: string) => {
    set({ notice });
    setTimeout(() => {
      if (get().notice === notice) set({ notice: null });
    }, 6000);
  };

  /** El usuario "dijo" casi lo mismo que el scout: es el parlante. Se descarta y se pasa al modo por turnos. */
  const handleEcho = (itemId: string, text: string) => {
    echoCount++;
    console.warn(`[voice] eco detectado (${echoCount}): descartado`);
    log('⚠️', `eco descartado: «${text.slice(0, 60)}»`);
    conn?.send({ type: 'response.cancel' });
    conn?.send({ type: 'conversation.item.delete', item_id: itemId });
    set((s) => ({ lines: s.lines.filter((l) => l.id !== itemId) }));
    if (echoCount === 3 && !get().turnTaking) {
      showNotice('Hay mucho eco del parlante. Con auriculares va perfecto; si no, probá el modo por turnos (✋).');
    }
  };

  // ---------- herramientas ----------
  const flushCalls = async (calls: FunctionCall[]) => {
    lastToolAt = Date.now();
    set((s) => ({ toolsRunning: [...s.toolsRunning, ...calls.map((c) => ({ callId: c.call_id, name: c.name }))] }));
    hapticLight();
    for (const c of calls) log('🔧', `${c.name}(${c.arguments.replace(/\s+/g, ' ').slice(0, 140)})`);
    const t0 = Date.now();
    const results = await runFunctionCalls(calls);
    for (const r of results) {
      log('🔧', `${r.call.name} → ${r.res.ok ? 'ok' : `error ${r.res.error.code}: ${r.res.error.message.slice(0, 80)}`} (${Date.now() - t0} ms)`);
    }
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
    // Fuentes de lo que vuelve de las herramientas: research desde la memoria (cached) y las paradas del tour.
    for (const { call, res, input } of results) {
      if (!res.ok) continue;
      const d = (res.data ?? {}) as {
        cached?: boolean;
        facts?: { text: string; source_url: string; quote?: string }[];
        name?: string;
        sources?: { url: string; title?: string }[];
      };
      if (call.name === 'research' && d.cached && d.facts?.length) {
        get().addSources({ kind: 'research', topic: String(input.question ?? 'Lo que preguntaste'), items: d.facts.map((f) => ({ text: f.text, url: f.source_url, quote: f.quote })) });
      } else if (call.name === 'get_stop_content' && d.sources?.length) {
        get().addSources({ kind: 'stop', topic: d.name ?? 'Esta parada', items: d.sources.map((x) => ({ url: x.url, title: x.title })) });
      }
    }
    // research es un job: cuando termine, el scout retoma solo el tema ([EVENTO:research_ready]).
    for (const { call, res, input } of results) {
      if (call.name !== 'research' || !res.ok) continue;
      const jobId = (res.data as { job_id?: string } | undefined)?.job_id;
      if (!jobId) continue;
      const question = String(input.question ?? '');
      log('🔧', `research: «${question.slice(0, 60)}» (job ${jobId.slice(0, 8)}…)`);
      const sessionId = get().session?.voice_session_id;
      jobsWatching++;
      void watchJob(jobId, 'La búsqueda').then((r) => {
        jobsWatching = Math.max(0, jobsWatching - 1);
        if (get().session?.voice_session_id !== sessionId) return; // la llamada ya terminó
        if (r.ok) {
          const out = r.row.result as ResearchResult | null;
          log('🔧', `research listo: ${out?.facts.length ?? 0} datos verificados`);
          get().injectEvent('research_ready', { question, answer: out?.answer ?? '', facts: (out?.facts ?? []).map((f) => ({ text: f.text, source_url: f.source_url })) });
          if (out?.facts.length) get().addSources({ kind: 'research', topic: question, items: out.facts.map((f) => ({ text: f.text, url: f.source_url, quote: f.quote })) });
        } else {
          log('⚠️', `research falló: ${r.error}`);
          get().injectEvent('research_failed', { question, error: r.error });
        }
      });
    }
    // generate_tour (y el tour interno) es un job: cuando termine, el scout lo anuncia solo ([EVENTO:tour_ready]).
    for (const { call, res } of results) {
      if ((call.name !== 'generate_tour' && call.name !== 'generate_indoor_tour') || !res.ok) continue;
      const { job_id, tour_id } = (res.data ?? {}) as { job_id?: string; tour_id?: string };
      if (!job_id || !tour_id) continue;
      log('🔧', `generate_tour: escuchando el job ${job_id.slice(0, 8)}…`);
      const sessionId = get().session?.voice_session_id;
      jobsWatching++;
      void watchTourJob(job_id, tour_id).then((r) => {
        jobsWatching = Math.max(0, jobsWatching - 1);
        if (get().session?.voice_session_id !== sessionId) return; // la llamada ya terminó
        if (r.ok) {
          log('🔧', `tour listo: ${r.event.stop_count} paradas`);
          get().injectEvent('tour_ready', r.event);
          hapticResult(true);
        } else {
          log('⚠️', `tour falló: ${r.error}`);
          get().injectEvent('tour_failed', { tour_id, error: r.error });
          hapticResult(false);
        }
      });
    }
    hapticResult(results.every((r) => r.res.ok));
    set((s) => ({ toolsRunning: s.toolsRunning.filter((t) => !calls.some((c) => c.call_id === t.callId)) }));
    // Un solo response.create para todas las llamadas paralelas (con cola si el servidor ya arrancó otra).
    requestResponse();
  };

  // ---------- eventos del data channel ----------
  const onEvent = (e: ServerEvent) => {
    set({ lastEventAt: Date.now() });
    if (!e.type.endsWith('.delta') && e.type !== 'rate_limits.updated') {
      if (__DEV__) console.log('[voice] ←', e.type);
      const extra =
        e.type === 'conversation.item.input_audio_transcription.completed'
          ? ` «${String(e.transcript ?? '').trim().slice(0, 80)}»`
          : e.type === 'response.done'
            ? ` ${String((e.response as { status?: string })?.status ?? '')}`
            : e.type === 'error'
              ? ` ${JSON.stringify(e.error).slice(0, 160)}`
              : '';
      log('←', `${e.type}${extra}`);
    }
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
      case 'conversation.item.input_audio_transcription.completed': {
        const id = String(e.item_id);
        const text = String(e.transcript ?? '').trim();
        const lastScout = [...get().lines].reverse().find((l) => l.role === 'assistant' && l.text.trim());
        if (lastScout && looksLikeEcho(text, lastScout.text)) {
          handleEcho(id, text);
          break;
        }
        upsertLine(id, 'user', () => ({ text, final: true }));
        break;
      }
      case 'response.created':
        responseActive = true;
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
        if (tailTimer) clearTimeout(tailTimer);
        tailTimer = null;
        scoutAudible = true;
        set({ speaking: 'assistant' });
        applyMic();
        setVad('barge');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (get().speaking === 'assistant') set({ speaking: null });
        // La cola: el parlante y la sala siguen sonando un instante después del último frame.
        if (tailTimer) clearTimeout(tailTimer);
        tailTimer = setTimeout(
          () => {
            tailTimer = null;
            scoutAudible = false;
            applyMic();
            setVad('normal');
          },
          e.type === 'output_audio_buffer.cleared' ? 0 : TAIL_MS,
        );
        break;
      case 'response.done': {
        responseActive = false;
        set({ responding: false });
        if (responseQueued) {
          responseQueued = false;
          requestResponse();
        }
        const response = e.response as { status?: string; output?: { type: string; call_id: string; name: string; arguments: string }[] };
        const calls = (response?.output ?? []).filter((o) => o.type === 'function_call');
        if (!calls.length && response?.status === 'completed') {
          const said = (response.output ?? [])
            .flatMap((o) => ((o as { content?: { transcript?: string; text?: string }[] }).content ?? []).map((c) => c.transcript ?? c.text ?? ''))
            .join(' ');
          const toolsBusy = get().toolsRunning.length > 0 || jobsWatching > 0 || Date.now() - lastToolAt < 20_000;
          if (said && !toolsBusy && promisedWithoutCalling(said) && Date.now() - lastNudgeAt > 30_000) {
            lastNudgeAt = Date.now();
            log('⚠️', `prometió buscar sin llamar herramienta: «${said.slice(0, 60)}»`);
            conn?.send({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'system',
                content: [{ type: 'input_text', text: 'Dijiste que lo ibas a buscar o averiguar pero no llamaste ninguna herramienta. Llamala ahora (research si es un dato que no tenés). No repitas el aviso en voz alta.' }],
              },
            });
            requestResponse();
          }
        }
        if (calls.length) {
          void flushCalls(calls.map((c) => ({ call_id: c.call_id, name: c.name, arguments: c.arguments })));
        }
        break;
      }
      case 'error': {
        const err = e.error as { message?: string; code?: string } | undefined;
        console.warn('[voice] error del servidor', err?.code, err?.message);
        // Carrera con una respuesta automática del VAD: se reintenta cuando termine.
        if (err?.code === 'conversation_already_has_active_response') responseQueued = true;
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
        if (args.context) {
          c.send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{ type: 'input_text', text: `Contexto de la pantalla desde donde te llamaron: ${JSON.stringify(args.context)}` }],
            },
          });
        }
        if (!isRetry && !args.silentOpen) {
          // El saludo con la detección exigente: un ruido de la sala no lo cancela; una voz cercana sí.
          setVad('barge');
          requestResponse();
        }
      },
      onConnectionLost: (state) => void handleLost(state),
    });
    conn = c;
    // Mic + oferta SDP (unos ms) y después UN solo viaje: la API crea la llamada en OpenAI con la oferta
    // (interfaz unificada) y devuelve la respuesta SDP. Ahorra ~1 s frente a token + SDP desde el celu.
    await c.prepare();
    const tPrep = Date.now() - t0;
    const s = await startVoiceSession({
      mode: args.mode ?? 'chat',
      trip_id: args.tripId ?? undefined,
      tour_id: args.tourId ?? undefined,
      focus: args.focus,
      location: (() => {
        const f = args.location ?? locationSource();
        return f ? { lat: f.lat, lng: f.lng, accuracy: f.accuracy ?? null } : undefined;
      })(),
      lang: isRetry ? get().lang : undefined,
      sdp: c.offer ?? undefined,
    });
    const tApi = Date.now() - t0 - tPrep;
    sessionConfig = s.session_config;
    // Antes de abrir el canal: onOpen (saludo, setVad) ya ve la sesión.
    set({
      session: { voice_session_id: s.voice_session_id, instructions_base: s.instructions_base, session_config: s.session_config },
      scoutName: s.scout.name,
      lang: s.lang,
    });
    if (s.answer_sdp) await c.applyAnswer(s.answer_sdp);
    else if (s.client_secret) await c.answer(s.client_secret);
    else throw new Error('La API no devolvió ni answer_sdp ni client_secret');
    console.log(`[voice] mic+oferta ${tPrep} ms · API${s.answer_sdp ? '+SDP' : ''} ${tApi} ms · total ${Date.now() - t0} ms`);
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
      scoutAudible = false;
      vadMode = 'normal';
      echoCount = 0;
      responseActive = false;
      responseQueued = false;
      pendingEvents = [];
      lastNudgeAt = 0;
      lastToolAt = 0;
      jobsWatching = 0;
      set({ ...initial, speaker: get().speaker, turnTaking: get().turnTaking, captions: get().captions, status: 'connecting', args });
      try {
        startCallAudio(get().speaker);
        const s = await connect(args, false);
        if (get().status !== 'connecting') {
          // Colgó mientras conectaba: cerrar lo que se abrió y la sesión en la API.
          conn?.close();
          conn = null;
          void endVoiceSession(s.voice_session_id, []).catch(() => {});
          return;
        }
        set({ status: 'live', startedAt: Date.now() });
        // Lo que llegó mientras conectaba (p. ej. el resultado de la foto).
        const queued = pendingEvents;
        pendingEvents = [];
        for (const ev of queued) get().injectEvent(ev.type, ev.payload, { respond: ev.respond });
        hapticResult(true);
      } catch (e) {
        // Colgó mientras conectaba: endCall ya limpió todo, no es un error.
        if (get().status !== 'connecting') return;
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
        set({ ...initial, speaker: s.speaker, turnTaking: s.turnTaking, captions: s.captions });
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
      if (get().status === 'connecting') {
        pendingEvents.push({ type, payload, respond: opts.respond !== false });
        return true;
      }
      if (!conn || get().status !== 'live') return false;
      const sent = conn.send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: formatVoiceEvent(type, payload) }] },
      });
      if (sent && opts.respond !== false) requestResponse();
      return sent;
    },

    setLanguage: (lang) => applyLanguage(lang, true),

    setMuted: (muted) => {
      set({ muted });
      applyMic();
    },
    setSpeakerOn: (on) => {
      set({ speaker: on });
      setSpeaker(on);
    },
    setTurnTaking: (on) => {
      set({ turnTaking: on });
      applyMic();
    },
    setCaptions: (captions) => set({ captions }),
    setExpanded: (expanded) => set({ expanded }),
    dismissAction: (id) => set((s) => ({ actions: s.actions.filter((a) => a.id !== id) })),
    dismissSummary: () => {
      const s = get();
      set({ ...initial, speaker: s.speaker, turnTaking: s.turnTaking, captions: s.captions });
    },

    addSources: (g) => {
      const items = g.items.filter((x) => /^https?:\/\//.test(x.url));
      if (!items.length) return;
      set((s) => {
        const seen = new Set(s.sources.flatMap((x) => x.items.map((i) => `${i.url}|${i.text ?? ''}`)));
        const fresh = items.filter((i) => !seen.has(`${i.url}|${i.text ?? ''}`));
        if (!fresh.length) return {};
        return { sources: [...s.sources, { ...g, items: fresh, id: `src-${Date.now()}`, at: Date.now() }].slice(-30) };
      });
      log('🔧', `fuentes: ${items.length} de «${g.topic.slice(0, 40)}»`);
    },
    setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),

    interrupt: () => {
      if (!conn) return;
      conn.send({ type: 'response.cancel' });
      conn.send({ type: 'output_audio_buffer.clear' });
      scoutAudible = false;
      set((s) => ({ speaking: null, lines: s.lines.map((l) => (l.role === 'assistant' && !l.final ? { ...l, final: true } : l)) }));
      applyMic();
      Haptics.selectionAsync().catch(() => {});
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
