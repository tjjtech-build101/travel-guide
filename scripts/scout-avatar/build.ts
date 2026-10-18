// Genera las imágenes y videos del Scout desde apps/mobile/src/scout/parts.ts (la misma geometría que anima la app en vivo) → apps/mobile/assets/scout/
//   poses/scout-<pose>.png (@2x, @3x)   una imagen por pose, fondo transparente, 195×240 pt
//   head/scout-head.png (@2x, @3x)      solo la cabeza, para avatares redondos, 96×96 pt
//   talk/scout-talk-<boca>.png (…)      pose tranquila con cada boca, para animar "hablando"
//   svg/scout-<pose>.svg                fuente vectorial de cada pose
//   video/scout-hablando-demo.mp4       demo con frases y cambios de pose
//   video/scout-hablando-loop.mp4/.webp loop de 3,4 s hablando (el .webp con fondo transparente)
// Uso: pnpm scout:build   (requiere rsvg-convert; para video ffmpeg —o FFMPEG=/ruta— e img2webp)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HEAD_VIEW_BOX,
  headNode,
  LEGS,
  NECK,
  POSES,
  TORSO,
  VIEW,
  VIEW_BOX,
  type FaceState,
  type Mouth,
  type ScoutPose,
  type SvgNode,
} from '../../apps/mobile/src/scout/parts';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = join(ROOT, 'apps/mobile/assets/scout');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const TMP = mkdtempSync(join(tmpdir(), 'scout-'));
const DENSITIES = [['', 1], ['@2x', 2], ['@3x', 3]] as const;
const BODY_PT = { w: 195, h: 240 };
const HEAD_PT = 96;
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

// ---------- SVG

function svg(n: SvgNode): string {
  const [tag, props, ...kids] = n;
  const attrs = Object.entries(props).map(([k, v]) => ` ${kebab(k)}="${v}"`).join('');
  return `<${tag}${attrs}>${kids.map(svg).join('')}</${tag}>`;
}

type Frame = {
  pose: ScoutPose;
  face: FaceState;
  breath: number;
  headY: number;
  headRot: number;
  wave: number;
  needle: number;
};

function scene(f: Frame, { viewBox = VIEW_BOX, bg = false } = {}) {
  const p = POSES[f.pose];
  const moving = [
    svg(p.arms),
    p.wave ? `<g transform="rotate(${f.wave} ${p.wave.pivot})">${svg(p.wave.node)}</g>` : '',
    p.needle ? `<g transform="rotate(${f.needle} ${p.needle.pivot})">${svg(p.needle.node)}</g>` : '',
  ].join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    bg ? `<rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}" fill="#D6E8EE"/><ellipse cx="120" cy="313" rx="70" ry="6" fill="#B7CFA0"/>` : '',
    svg(LEGS),
    `<g transform="translate(0 ${f.breath})">${svg(TORSO)}</g>`,
    `<g transform="translate(0 ${f.headY}) rotate(${f.headRot} ${NECK})">${svg(headNode(f.face))}</g>`,
    `<g transform="translate(0 ${f.breath})">${moving}</g>`,
    '</svg>',
  ].join('');
}

function still(pose: ScoutPose, mouth?: Mouth): Frame {
  const p = POSES[pose];
  return {
    pose,
    face: { look: p.look ?? 0, eyesOpen: 1, mouth: mouth ?? p.mouth, eyes: p.eyes, brows: p.brows },
    breath: 0,
    headY: 0,
    headRot: 0,
    wave: 0,
    needle: 0,
  };
}

let tmpN = 0;
function png(svgText: string, file: string, w: number, h: number) {
  const src = join(TMP, `s${tmpN++}.svg`);
  writeFileSync(src, svgText);
  execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', file, src]);
}

function dir(...parts: string[]) {
  const d = join(OUT, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

// ---------- Imágenes fijas

function buildStills() {
  const poses = dir('poses');
  const vec = dir('svg');
  for (const pose of Object.keys(POSES) as ScoutPose[]) {
    const s = scene(still(pose));
    writeFileSync(join(vec, `scout-${kebab(pose)}.svg`), s);
    for (const [suffix, k] of DENSITIES) png(s, join(poses, `scout-${kebab(pose)}${suffix}.png`), BODY_PT.w * k, BODY_PT.h * k);
  }
  const head = dir('head');
  const h = scene(still('idle'), { viewBox: HEAD_VIEW_BOX });
  for (const [suffix, k] of DENSITIES) png(h, join(head, `scout-head${suffix}.png`), HEAD_PT * k, HEAD_PT * k);

  const talk = dir('talk');
  for (const m of ['rest', 'M', 'E', 'A', 'O'] as Mouth[]) {
    const s = scene(still('idle', m));
    for (const [suffix, k] of DENSITIES) png(s, join(talk, `scout-talk-${m.toLowerCase()}${suffix}.png`), BODY_PT.w * k, BODY_PT.h * k);
  }
}

// ---------- Animación

/** Texto → bocas por letra (aproximación para el video; en la app lo va a mover la voz). */
function visemes(text: string) {
  const frames: { v: Mouth; at: number }[] = [];
  let at = 0;
  let prev: Mouth = 'rest';
  for (const ch of text.toLowerCase()) {
    let v: Mouth | null = null;
    let ms = 66;
    if ('aá'.includes(ch)) v = 'A';
    else if ('eéií'.includes(ch)) v = 'E';
    else if ('oóuú'.includes(ch)) v = 'O';
    else if ('mbpv'.includes(ch)) v = 'M';
    else if (ch === ' ') (v = 'rest'), (ms = 35);
    else if (',;:'.includes(ch)) (v = 'rest'), (ms = 220);
    else if ('.!?'.includes(ch)) (v = 'rest'), (ms = 300);
    else if ('¿¡'.includes(ch)) ms = 0;
    prev = v ?? prev;
    frames.push({ v: prev, at: at / 1000 });
    at += ms;
  }
  return { frames, total: at / 1000 };
}

const TAU = Math.PI * 2;
const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const blinkAt = (t: number, times: number[]) => {
  for (const b of times) {
    const d = (t - b) / 0.15;
    if (d >= 0 && d < 1) return 1 - Math.sin(d * Math.PI) * 0.92;
  }
  return 1;
};

function body(t: number, talking: boolean) {
  const breath = Math.sin((TAU * t) / 3.4);
  return {
    breath: breath * 0.6,
    headY: breath * 1.5 + (talking ? Math.sin(t * 9) * 0.6 : 0),
    headRot: talking ? Math.sin(TAU * 0.7 * t) * 1.8 : Math.sin((TAU * t) / 6) * 0.8,
    wave: Math.sin(TAU * 1.4 * t) * 14,
    needle: Math.sin(TAU * 0.5 * t) * 14 + Math.sin(TAU * 1.7 * t) * 5,
  };
}

type Line = { pose: ScoutPose; text: string };

function demoFrames(lines: Line[], fps: number): Frame[] {
  const LEAD = 0.35;
  const TAIL = 0.6;
  let start = 0;
  const segs = lines.map((l) => {
    const v = visemes(l.text);
    const seg = { ...l, ...v, start, speech: start + LEAD, end: start + LEAD + v.total + TAIL };
    start = seg.end;
    return seg;
  });
  const blinks = [1.1, 3.7, 6.4, 8.9, 11.6, 14.2, 16.8];
  const out: Frame[] = [];
  for (let i = 0; i < Math.round(start * fps); i++) {
    const t = i / fps;
    const k = Math.max(0, segs.findIndex((s) => t < s.end));
    const seg = segs[k];
    const p = POSES[seg.pose];
    const fromLook = k > 0 ? (POSES[segs[k - 1].pose].look ?? 0) : 0;
    const look = fromLook + ((p.look ?? 0) - fromLook) * easeOut((t - seg.start) / 0.35);
    const st = t - seg.speech;
    const talking = st >= 0 && st < seg.total;
    const mouth = talking ? (seg.frames.findLast((f) => f.at <= st)?.v ?? 'rest') : p.mouth;
    out.push({
      pose: seg.pose,
      face: { look, eyesOpen: blinkAt(t, blinks), mouth, eyes: p.eyes, brows: p.brows },
      ...body(t, talking),
    });
  }
  return out;
}

/** Loop sin cortes: todo lo periódico entra un número entero de veces en LOOP segundos. */
function loopFrames(fps: number): Frame[] {
  const LOOP = 3.4;
  const n = Math.round(LOOP * fps);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const seq: Mouth[] = [];
  const order: Mouth[] = ['A', 'E', 'O', 'M', 'E', 'A', 'rest', 'O', 'E'];
  while (seq.length < n) {
    const m = order[Math.floor(rnd() * order.length)];
    const hold = 2 + Math.floor(rnd() * 2);
    for (let j = 0; j < hold; j++) seq.push(m);
  }
  seq.length = n;
  seq[n - 1] = 'rest';
  return seq.map((mouth, i) => {
    const t = i / fps;
    const ph = t / LOOP;
    return {
      pose: 'idle' as const,
      face: { look: Math.sin(TAU * ph) * 0.12, eyesOpen: blinkAt(t, [1.6]), mouth, eyes: POSES.idle.eyes },
      breath: Math.sin(TAU * ph) * 0.6,
      headY: Math.sin(TAU * ph) * 1.5 + Math.sin(TAU * 5 * ph) * 0.6,
      headRot: Math.sin(TAU * 2 * ph) * 1.8,
      wave: 0,
      needle: 0,
    };
  });
}

function renderFrames(frames: Frame[], name: string, w: number, h: number, bg: boolean) {
  const d = join(TMP, name);
  mkdirSync(d);
  frames.forEach((f, i) => png(scene(f, { bg }), join(d, `f${String(i).padStart(4, '0')}.png`), w, h));
  return d;
}

function mp4(framesDir: string, fps: number, out: string) {
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, 'f%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out,
  ]);
}

function webp(framesDir: string, count: number, fps: number, out: string) {
  const files = Array.from({ length: count }, (_, i) => join(framesDir, `f${String(i).padStart(4, '0')}.png`));
  execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '70', '-d', String(Math.round(1000 / fps)), ...files, '-o', out]);
}

function buildVideos() {
  const video = dir('video');
  const FPS = 25;
  const W = 720;
  const H = Math.round((W * VIEW.h) / VIEW.w / 2) * 2;

  const demo = demoFrames(
    [
      { pose: 'wave', text: '¡Hola! Soy Scout. ¿Arrancamos el tour por la Ciudad Vieja?' },
      { pose: 'pointRight', text: 'Mirá para allá: esa es la Puerta de la Ciudadela.' },
      { pose: 'map', text: 'Tengo tres paradas cerca, unos cuarenta minutos caminando.' },
      { pose: 'thumbs', text: '¿Dale? ¡Vamos!' },
    ],
    FPS,
  );
  mp4(renderFrames(demo, 'demo', W, H, true), FPS, join(video, 'scout-hablando-demo.mp4'));

  const loop = loopFrames(FPS);
  mp4(renderFrames(loop, 'loop-bg', W, H, true), FPS, join(video, 'scout-hablando-loop.mp4'));
  webp(renderFrames(loop, 'loop', BODY_PT.w * 2, BODY_PT.h * 2, false), loop.length, FPS, join(video, 'scout-hablando-loop.webp'));
}

try {
  buildStills();
  console.log('Imágenes listas');
  if (!process.argv.includes('--no-video')) {
    buildVideos();
    console.log('Videos listos');
  }
  console.log(`→ ${OUT}`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
