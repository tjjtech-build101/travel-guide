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
    const mic = (await mediaDevices.getUserMedia({ audio: true, video: false })) as MediaStream;
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

  /** Manda la oferta con el token temporal y aplica la respuesta. */
  async answer(clientSecret: string): Promise<ConnectTimings> {
    const pc = this.pc;
    if (!pc || !this.offerSdp || this.closed) throw new Error('La conexión no está preparada');
    const t0 = Date.now();
    const res = await fetch(CALLS_URL, {
      method: 'POST',
      body: this.offerSdp,
      headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    // El audio remoto suena solo: react-native-webrtc lo enruta a la salida del sistema.
    return { prepare: this.prepareMs, sdp: Date.now() - t0 };
  }

  send(event: Record<string, unknown>): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(JSON.stringify(event));
    return true;
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
