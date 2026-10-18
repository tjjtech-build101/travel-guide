// Conexión WebRTC con OpenAI Realtime (PRD 05). Solo transporte: micrófono, audio remoto y data channel de eventos.
// La lógica (subtítulos, herramientas, estados) vive en store.ts.
import { mediaDevices, RTCPeerConnection, type MediaStream } from 'react-native-webrtc';

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export type ServerEvent = { type: string; [k: string]: unknown };

export type RealtimeHandlers = {
  onEvent: (e: ServerEvent) => void;
  onOpen: () => void;
  /** 'failed' o 'disconnected' sostenido: el store decide si reconecta. */
  onConnectionLost: (state: string) => void;
};

export type ConnectTimings = { prepare: number; sdp: number };

/** Falla de la conexión con código (lib/errors la explica): el texto crudo de OpenAI/WebRTC va a `detail`. */
export class RealtimeError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: string,
    public provider?: 'openai',
  ) {
    super(message);
    this.name = 'RealtimeError';
  }
}

/** Respuesta no-OK de POST /realtime/calls → código de proveedor. */
function callsError(status: number, body: string): RealtimeError {
  const detail = `OpenAI ${status}: ${body.slice(0, 300)}`;
  if (/insufficient_quota|exceeded your current quota|billing/i.test(body)) return new RealtimeError('provider_no_credits', '', detail, 'openai');
  if (status === 401) return new RealtimeError('provider_auth', '', detail, 'openai');
  if (status === 403) return new RealtimeError('provider_denied', '', detail, 'openai');
  if (status === 429) return new RealtimeError('provider_rate_limited', '', detail, 'openai');
  if (status === 408 || status === 504) return new RealtimeError('provider_timeout', '', detail, 'openai');
  if (status >= 500) return new RealtimeError('provider_unavailable', '', detail, 'openai');
  return new RealtimeError(`http_${status}`, '', detail, 'openai');
}

const notReady = () => new RealtimeError('connect_failed', 'La llamada se cortó antes de conectar.', 'La conexión no está preparada');

export class RealtimeConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: ReturnType<RTCPeerConnection['createDataChannel']> | null = null;
  private mic: MediaStream | null = null;
  private closed = false;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private handlers: RealtimeHandlers) {}

  private offerSdp: string | null = null;
  private prepareMs = 0;

  /** Micrófono + PeerConnection + oferta SDP. No necesita el token: corre en paralelo con POST /voice/session. */
  async prepare(): Promise<void> {
    const t0 = Date.now();
    const pc = new RTCPeerConnection();
    this.pc = pc;
    // react-native-webrtc no expone echoCancellation & co. como constraints: en iOS el audio unit nativo es
    // VoiceProcessingIO (AEC + NS + AGC por hardware) y InCallManager pone la sesión en modo voz. Clave para el parlante.
    let mic: MediaStream;
    try {
      mic = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
    } catch (e) {
      const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (/NotAllowed|denied|permission/i.test(raw)) throw new RealtimeError('mic_denied', '', raw);
      throw new RealtimeError('mic_unavailable', 'No pude abrir el micrófono; puede que otra app lo esté usando.', raw);
    }
    this.mic = mic;
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.addEventListener('open', () => this.handlers.onOpen());
    dc.addEventListener('message', (ev) => {
      try {
        this.handlers.onEvent(JSON.parse(String((ev as { data: unknown }).data)) as ServerEvent);
      } catch (e) {
        console.warn('[voice] evento ilegible', e);
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (this.closed) return;
      if (s === 'connected' && this.lostTimer) {
        clearTimeout(this.lostTimer);
        this.lostTimer = null;
      } else if (s === 'failed') {
        this.handlers.onConnectionLost(s);
      } else if (s === 'disconnected' && !this.lostTimer) {
        // 'disconnected' a veces se recupera solo: esperamos un poco antes de declararla perdida.
        this.lostTimer = setTimeout(() => {
          this.lostTimer = null;
          if (!this.closed && pc.connectionState !== 'connected') this.handlers.onConnectionLost(pc.connectionState);
        }, 2500);
      }
    });

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    this.offerSdp = offer.sdp ?? null;
    this.prepareMs = Date.now() - t0;
  }

  get offer(): string | null {
    return this.offerSdp;
  }

  /** Interfaz unificada: la API ya creó la llamada con la oferta y devolvió la respuesta SDP. */
  async applyAnswer(sdp: string): Promise<void> {
    if (!this.pc || this.closed) throw notReady();
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /** Fallback: manda la oferta a OpenAI con el token temporal y aplica la respuesta. */
  async answer(clientSecret: string): Promise<ConnectTimings> {
    const pc = this.pc;
    if (!pc || !this.offerSdp || this.closed) throw notReady();
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(CALLS_URL, {
        method: 'POST',
        body: this.offerSdp,
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new RealtimeError(timedOut ? 'provider_timeout' : 'network_error', '', raw, timedOut ? 'openai' : undefined);
    }
    if (!res.ok) throw callsError(res.status, await res.text().catch(() => ''));
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    // El audio remoto suena solo: react-native-webrtc lo enruta a la salida del sistema.
    return { prepare: this.prepareMs, sdp: Date.now() - t0 };
  }

  send(event: Record<string, unknown>): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(event));
    return true;
  }

  /** Reporte de stats de WebRTC (de ahí sale el volumen para animar al Scout). null si no hay conexión. */
  async stats(): Promise<Map<string, unknown> | null> {
    if (!this.pc || this.closed) return null;
    return (await this.pc.getStats()) as Map<string, unknown>;
  }

  setMicEnabled(enabled: boolean) {
    this.mic?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  close() {
    this.closed = true;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    try {
      this.dc?.close();
    } catch {}
    this.mic?.getTracks().forEach((t) => t.stop());
    try {
      this.pc?.close();
    } catch {}
    this.dc = null;
    this.pc = null;
    this.mic = null;
  }
}
