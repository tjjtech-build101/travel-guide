// El Scout vivo: dibuja la geometría de parts.ts con react-native-svg y la anima por capas (como build.ts arma el
// video), así que se ve igual que los PNG pero se mueve:
//   piernas (quietas) · torso (respira) · cabeza (cabecea y gira sobre el cuello) · brazos (respiran; el que saluda rota)
// El movimiento continuo corre en el hilo de UI (reanimated, un reloj por frame). La cara (boca, parpadeo, mirada)
// es estado de React que cambia ~10 veces por segundo como mucho.
//   idle       respira, parpadea y cada tanto mira a un costado
//   listening  se inclina hacia vos, ladea la cabeza y asiente (más si hablás fuerte)
//   thinking   mano en el mentón, cejas y boca de "hmm"
//   speaking   la boca sigue el volumen real de la voz (voice/levels) y la cabeza acompaña
// `talking` hace hablar al Scout sin llamada (globos de la guía): bocas alternadas.
// Con "reducir movimiento" del sistema queda quieto (solo cambia la cara).
import { memo, useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';

import { voiceLevels } from '../voice/levels';
import { baseFace, fallbackMouth, FRAMES, mouthForLevel, poseFor, viewBoxString, type Framing, type ScoutMode } from './behavior';
import { headNode, LEGS, NECK, POSES, TORSO, type FaceState, type Mouth, type ScoutPose, type SvgNode } from './parts';

export type { Framing, ScoutMode } from './behavior';
export type { ScoutPose } from './parts';

const TAGS: Record<SvgNode[0], ComponentType<Record<string, unknown>>> = {
  g: G as never,
  path: Path as never,
  rect: Rect as never,
  circle: Circle as never,
  ellipse: Ellipse as never,
  clipPath: ClipPath as never,
  defs: Defs as never,
};

/** Nodo de parts.ts → elementos de react-native-svg (los props ya vienen en camelCase). */
export function renderNode(n: SvgNode, key?: number): ReactElement {
  const [tag, props, ...kids] = n;
  const C = TAGS[tag];
  return (
    <C key={key} {...props}>
      {kids.map((k, i) => renderNode(k, i))}
    </C>
  );
}

const TAU = Math.PI * 2;
const MOUTH_MS = 90;

type Props = {
  /** Ancho en pt; el alto sale del encuadre. */
  width: number;
  framing?: Framing;
  mode?: ScoutMode;
  /** Pose de los brazos (y su cara). Si no viene, sale del estado (saluda al conectar, piensa al pensar). */
  pose?: ScoutPose | null;
  /** Habla sin llamada (globo de la guía): bocas alternadas y la cabeza acompaña. */
  talking?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const ScoutRig = memo(function ScoutRig({ width, framing = 'full', mode = 'idle', pose: poseProp, talking = false, style }: Props) {
  const reduced = useReducedMotion();
  const vb = FRAMES[framing];
  const k = width / vb.w;
  const height = vb.h * k;
  const viewBox = viewBoxString(vb);
  const at = (x: number, y: number): [number, number, number] => [(x - vb.x) * k, (y - vb.y) * k, 0];

  const pose = poseFor(mode, poseProp);
  const def = POSES[pose];
  const speaking = mode === 'speaking' || talking;

  // ---------- Hilo de UI: reloj + intensidades que se acomodan con resorte
  const t = useSharedValue(0);
  const clock = useFrameCallback((f) => {
    t.value = f.timeSinceFirstFrame / 1000;
  }, false);
  useEffect(() => {
    clock.setActive(!reduced);
    return () => clock.setActive(false);
  }, [clock, reduced]);

  const talk = useSharedValue(0);
  const listen = useSharedValue(0);
  const tilt = useSharedValue(0);
  const energy = useSharedValue(0);
  useEffect(() => {
    talk.value = withSpring(speaking ? 1 : 0, { damping: 18 });
    listen.value = withSpring(mode === 'listening' ? 1 : 0, { damping: 16 });
    tilt.value = withSpring(mode === 'listening' ? 5 : mode === 'thinking' ? -4 : mode === 'error' ? -2 : 0, { damping: 14 });
  }, [speaking, mode, talk, listen, tilt]);

  // ---------- Cara (React)
  const face = useFace({ mode, pose, speaking, voiced: mode === 'speaking' && !talking, energy, still: reduced });
  const head = useMemo(() => renderNode(headNode(face)), [face]);

  // ---------- Capas fijas (se recalculan solo si cambia la pose)
  const legs = useMemo(() => renderNode(LEGS), []);
  const torso = useMemo(() => renderNode(TORSO), []);
  const arms = useMemo(() => renderNode(def.arms), [def]);
  const wave = useMemo(() => (def.wave ? renderNode(def.wave.node) : null), [def]);
  const needle = useMemo(() => (def.needle ? renderNode(def.needle.node) : null), [def]);

  // ---------- Estilos animados
  const whole = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.025 * listen.value }] }));
  const breathe = useAnimatedStyle(() => ({ transform: [{ translateY: Math.sin((TAU * t.value) / 3.4) * 0.6 * k }] }));
  const headStyle = useAnimatedStyle(() => {
    const s = t.value;
    const breath = Math.sin((TAU * s) / 3.4);
    const nod = Math.pow(Math.max(0, Math.sin((TAU * s) / 1.9)), 4) * (2 + 4 * energy.value) * listen.value;
    const y = breath * 1.5 + talk.value * Math.sin(s * 9) * (0.4 + 1.2 * energy.value) + nod;
    const rot =
      (1 - talk.value) * Math.sin((TAU * s) / 6) * 0.8 +
      talk.value * Math.sin(TAU * 0.7 * s) * (1.2 + 1.5 * energy.value) +
      tilt.value;
    return { transform: [{ translateY: y * k }, { rotate: `${rot}deg` }] };
  });
  const waveStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.sin((TAU * t.value) / 3.4) * 0.6 * k }, { rotate: `${Math.sin(TAU * 1.4 * t.value) * 14}deg` }],
  }));
  const needleStyle = useAnimatedStyle(() => {
    const s = t.value;
    return { transform: [{ rotate: `${Math.sin(TAU * 0.5 * s) * 14 + Math.sin(TAU * 1.7 * s) * 5}deg` }] };
  });

  const layer = { position: 'absolute' as const, left: 0, top: 0, width, height };
  const svg = (children: ReactElement | null) => (
    <Svg width={width} height={height} viewBox={viewBox}>
      {children}
    </Svg>
  );

  return (
    <View style={[{ width, height }, style]} pointerEvents="none">
      <Animated.View style={[layer, { transformOrigin: [width / 2, height, 0] }, whole]}>
        <View style={layer}>{svg(legs)}</View>
        <Animated.View style={[layer, breathe]}>{svg(torso)}</Animated.View>
        <Animated.View style={[layer, { transformOrigin: at(NECK[0], NECK[1]) }, headStyle]}>{svg(head)}</Animated.View>
        <Animated.View style={[layer, breathe]}>{svg(arms)}</Animated.View>
        {wave && def.wave ? (
          <Animated.View style={[layer, { transformOrigin: at(def.wave.pivot[0], def.wave.pivot[1]) }, waveStyle]}>{svg(wave)}</Animated.View>
        ) : null}
        {needle && def.needle ? (
          <Animated.View style={[layer, { transformOrigin: at(def.needle.pivot[0], def.needle.pivot[1]) }, needleStyle]}>{svg(needle)}</Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
});

/** Parpadeo, mirada y boca. Devuelve un FaceState nuevo solo cuando algo cambió de verdad. */
function useFace({
  mode,
  pose,
  speaking,
  voiced,
  energy,
  still,
}: {
  mode: ScoutMode;
  pose: ScoutPose;
  speaking: boolean;
  /** La boca la mueve el volumen real de la llamada. */
  voiced: boolean;
  energy: SharedValue<number>;
  still: boolean;
}): FaceState {
  const base = useMemo(() => baseFace(mode, pose), [mode, pose]);
  const [mouth, setMouth] = useState<Mouth | null>(null);
  const [eyesOpen, setEyesOpen] = useState(1);
  const [glance, setGlance] = useState(0);

  // Parpadeo: cada 2 a 5,5 s; a veces doble.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const close = (then: () => void) => {
      setEyesOpen(0.1);
      timer = setTimeout(() => {
        setEyesOpen(1);
        then();
      }, 110);
    };
    const loop = () => {
      timer = setTimeout(() => close(() => (Math.random() < 0.2 ? (timer = setTimeout(() => close(loop), 160)) : loop())), 2000 + Math.random() * 3500);
    };
    loop();
    return () => clearTimeout(timer);
  }, []);

  // Mirada: tranquilo, cada tanto mira a un costado y vuelve.
  useEffect(() => {
    if (mode !== 'idle' || still) {
      setGlance(0);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(() => {
        setGlance(Math.random() < 0.5 ? -0.3 : 0.3);
        timer = setTimeout(() => {
          setGlance(0);
          loop();
        }, 1100 + Math.random() * 800);
      }, 3000 + Math.random() * 4000);
    };
    loop();
    return () => clearTimeout(timer);
  }, [mode, still]);

  // Boca: con la voz, según el volumen; sin volumen (o en un globo), alternada. Escuchando, el volumen del micrófono
  // le da intensidad a los asentimientos.
  useEffect(() => {
    if (!speaking && mode !== 'listening') {
      setMouth(null);
      energy.value = withTiming(0, { duration: 200 });
      return;
    }
    const id = setInterval(() => {
      if (!speaking) {
        const l = voiceLevels.in;
        energy.value = withTiming(l === null ? 0.2 : Math.min(1, l * 5), { duration: MOUTH_MS });
        return;
      }
      const r = Math.random();
      const l = voiced ? voiceLevels.out : null;
      setMouth(l === null ? fallbackMouth(r) : mouthForLevel(l, r));
      energy.value = withTiming(l === null ? 0.45 : Math.min(1, l * 4), { duration: MOUTH_MS });
    }, MOUTH_MS);
    return () => {
      clearInterval(id);
      setMouth(null);
    };
  }, [speaking, voiced, mode, energy]);

  const look = useTween(base.look + glance, still ? 0 : 180);

  // Misma referencia mientras no cambie nada (la cabeza solo se vuelve a dibujar cuando hace falta).
  const prev = useRef<FaceState | null>(null);
  const eyes = glance && !base.eyes?.happy ? { ...base.eyes, dx: (base.eyes?.dx ?? 0) + glance * 8 } : base.eyes;
  const next: FaceState = { ...base, look, eyesOpen, mouth: mouth ?? base.mouth, eyes };
  if (prev.current && JSON.stringify(prev.current) === JSON.stringify(next)) return prev.current;
  prev.current = next;
  return next;
}

/** Valor que va hacia `target` en `ms` (pasos de ~30 ms). Para girar la cabeza sin saltos. */
function useTween(target: number, ms: number): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (ms <= 0 || Math.abs(cur.current - target) < 0.01) {
      cur.current = target;
      setV(target);
      return;
    }
    const from = cur.current;
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - (1 - p) ** 3;
      cur.current = from + (target - from) * e;
      setV(Math.round(cur.current * 100) / 100);
      if (p >= 1) clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [target, ms]);
  return v;
}
