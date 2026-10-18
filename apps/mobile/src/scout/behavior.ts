// Comportamiento del Scout animado (puro, sin React): encuadres, qué cara y pose corresponden a cada estado,
// qué boca va con el volumen de la voz y cómo leer ese volumen del getStats de WebRTC.
// Lo usan ScoutRig (dibujo) y voice/levels (muestreo); los tests están en behavior.test.ts.
import { HEAD_VIEW_BOX, POSES, TALK_MOUTHS, VIEW_BOX, type FaceState, type Mouth, type ScoutPose } from './parts';

export type ScoutMode = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

// ---------- Encuadres

export type Framing = 'full' | 'bust' | 'head';
export type ViewBox = { x: number; y: number; w: number; h: number };

const parse = (s: string): ViewBox => {
  const [x, y, w, h] = s.split(' ').map(Number);
  return { x, y, w, h };
};

/** full = cuerpo entero · bust = de la cintura para arriba (la "videollamada") · head = avatar redondo. */
export const FRAMES: Record<Framing, ViewBox> = {
  full: parse(VIEW_BOX),
  bust: { x: -5, y: 6, w: 250, h: 262 },
  head: parse(HEAD_VIEW_BOX),
};

export const viewBoxString = (v: ViewBox) => `${v.x} ${v.y} ${v.w} ${v.h}`;

// ---------- Pose y cara por estado

/** Pose de los brazos según el estado, si nadie pidió una. */
export function poseFor(mode: ScoutMode, override?: ScoutPose | null): ScoutPose {
  if (override) return override;
  if (mode === 'connecting') return 'wave';
  if (mode === 'thinking') return 'think';
  return 'idle';
}

/** Cara de base (sin parpadeo ni boca de habla) para un estado y una pose. */
export function baseFace(mode: ScoutMode, pose: ScoutPose): FaceState {
  const p = POSES[pose];
  const face: FaceState = { look: p.look ?? 0, eyesOpen: 1, mouth: p.mouth, eyes: p.eyes, brows: p.brows };
  if (mode === 'thinking' && pose !== 'think') return { ...face, mouth: 'hmm', brows: 'think', eyes: { dx: -2, dy: -3 }, look: -0.3 };
  if (mode === 'error') return { ...face, mouth: 'hmm', brows: 'think', eyes: { dy: 2 } };
  // Escuchando: mira a cámara, atento.
  if (mode === 'listening' && pose === 'idle') return { ...face, look: 0, eyes: {} };
  return face;
}

// ---------- Boca según el volumen

/**
 * Volumen (0…1, amplitud) → boca. Por debajo del umbral, boca cerrada; después abre más cuanto más fuerte.
 * `r` (0…1) desempata entre bocas parecidas para que no quede la misma muchas veces seguidas.
 */
export function mouthForLevel(level: number, r: number): Mouth {
  const open = Math.min(1, Math.max(0, (level - 0.015) / 0.22));
  if (open < 0.08) return 'rest';
  if (open < 0.3) return r < 0.5 ? 'M' : 'E';
  if (open < 0.6) return r < 0.6 ? 'E' : 'O';
  return r < 0.7 ? 'A' : 'O';
}

/** Sin volumen (no hay stats): bocas alternadas como en el video de la app. */
export function fallbackMouth(r: number): Mouth {
  return TALK_MOUTHS[Math.floor(r * TALK_MOUTHS.length) % TALK_MOUTHS.length];
}

// ---------- Volumen desde getStats

type Report = Record<string, unknown>;
/** Energía acumulada de la muestra anterior, para calcular el RMS del último intervalo. */
export type EnergyMemo = { out?: { e: number; d: number }; in?: { e: number; d: number } };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isAudio = (r: Report) => r.kind === 'audio' || r.mediaType === 'audio';

function levelOf(r: Report, prev: { e: number; d: number } | undefined): { level: number | null; memo?: { e: number; d: number } } {
  const e = num(r.totalAudioEnergy);
  const d = num(r.totalSamplesDuration);
  if (e !== null && d !== null) {
    const memo = { e, d };
    if (prev && d > prev.d) return { level: Math.sqrt(Math.max(0, e - prev.e) / (d - prev.d)), memo };
    const al = num(r.audioLevel);
    return { level: al, memo };
  }
  return { level: num(r.audioLevel) };
}

/**
 * Reporte de RTCPeerConnection.getStats() → volumen de lo que suena (out: el Scout) y del micrófono (in: vos).
 * null si el reporte no trae el dato (cada plataforma expone campos distintos).
 */
export function levelsFromStats(
  stats: Iterable<[string, unknown]> | Map<string, unknown>,
  memo: EnergyMemo,
): { out: number | null; in: number | null; memo: EnergyMemo } {
  let out: number | null = null;
  let mic: number | null = null;
  const next: EnergyMemo = {};
  for (const [, raw] of stats) {
    const r = raw as Report;
    if (!r || typeof r !== 'object' || !isAudio(r)) continue;
    if (r.type === 'inbound-rtp' || (r.type === 'track' && r.remoteSource === true)) {
      const l = levelOf(r, memo.out);
      if (l.memo) next.out = l.memo;
      if (l.level !== null) out = Math.max(out ?? 0, l.level);
    } else if (r.type === 'media-source' || (r.type === 'track' && r.remoteSource === false)) {
      const l = levelOf(r, memo.in);
      if (l.memo) next.in = l.memo;
      if (l.level !== null) mic = Math.max(mic ?? 0, l.level);
    }
  }
  return { out, in: mic, memo: next };
}
