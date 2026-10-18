// Avatar del Scout: la cabeza del personaje, viva (scout/ScoutRig: parpadea, escucha, piensa y mueve la boca con
// la voz) dentro de un anillo animado (reanimated) según el estado de la llamada:
//   listening → anillo verde que late lento · speaking → anillo rojo (pañuelo) con ondas rápidas
//   thinking  → arco bronce que gira · idle/otros → anillo quieto.
// El nombre sale de SCOUT (packages/shared/src/scout.ts): nunca hardcodearlo.
import { SCOUT } from '@build101/shared';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import type { ScoutState } from '../voice/useScout';
import { ScoutRig, type ScoutPose } from '../scout/ScoutRig';
import { Text } from './Text';
import { colors, font, space } from './theme';

export type ScoutAvatarState = ScoutState;

export const SCOUT_RING: Record<ScoutAvatarState, string> = {
  idle: colors.khaki,
  connecting: colors.bronze,
  listening: colors.primary,
  thinking: colors.bronze,
  speaking: colors.scout,
  error: colors.danger,
};

export const SCOUT_STATE_LABEL: Record<ScoutAvatarState, string> = {
  idle: '',
  connecting: 'Conectando…',
  listening: 'Te escucho…',
  thinking: 'Pensando…',
  speaking: 'Hablando…',
  error: 'No pude conectar',
};

type Props = {
  size?: number;
  state?: ScoutAvatarState;
  /** Muestra el texto del estado debajo ("Te escucho…"). */
  showLabel?: boolean;
  /** Pose/gesto puntual (p. ej. 'thumbs' cuando algo salió bien). */
  pose?: ScoutPose | null;
};

export function ScoutAvatar({ size = 96, state = 'idle', showLabel = false, pose }: Props) {
  const color = SCOUT_RING[state];
  const ringW = Math.max(3, Math.round(size * 0.04));
  const outer = size + ringW * 4;
  const label = SCOUT_STATE_LABEL[state];

  return (
    <View style={styles.wrap} accessibilityRole="image" accessibilityLabel={`${SCOUT.name}${label ? `, ${label}` : ''}`}>
      <View style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}>
        <PulseRing size={outer} color={color} active={state === 'listening'} duration={1400} maxScale={1.14} />
        <PulseRing size={outer} color={color} active={state === 'speaking'} duration={650} maxScale={1.1} />
        <PulseRing size={outer} color={color} active={state === 'speaking'} duration={650} maxScale={1.1} delay={325} />
        <SpinArc size={outer} color={color} width={ringW} active={state === 'thinking' || state === 'connecting'} />
        <View
          style={[
            styles.ring,
            {
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: ringW,
              borderColor: state === 'thinking' || state === 'connecting' ? colors.surfaceMuted : color,
            },
          ]}
        />
        <ScoutFace size={size} state={state} pose={pose} />
      </View>
      {showLabel ? <Text style={[styles.label, { color: state === 'idle' ? colors.textMuted : color }]}>{label || ' '}</Text> : null}
    </View>
  );
}

function PulseRing({
  size,
  color,
  active,
  duration,
  maxScale,
  delay = 0,
}: {
  size: number;
  color: string;
  active: boolean;
  duration: number;
  maxScale: number;
  delay?: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (active) {
      t.value = 0;
      t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(t);
      t.value = 0;
    }
    return () => cancelAnimation(t);
  }, [active, delay, duration, t]);
  const style = useAnimatedStyle(() => ({
    opacity: active ? 0.55 * (1 - t.value) : 0,
    transform: [{ scale: 1 + (maxScale - 1) * t.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

function SpinArc({ size, color, width, active }: { size: number; color: string; width: number; active: boolean }) {
  const r = useSharedValue(0);
  useEffect(() => {
    if (active) {
      r.value = 0;
      r.value = withRepeat(withTiming(360, { duration: 1100, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(r);
      r.value = 0;
    }
    return () => cancelAnimation(r);
  }, [active, r]);
  const style = useAnimatedStyle(() => ({ opacity: active ? 1 : 0, transform: [{ rotate: `${r.value}deg` }] }));
  const rad = (size - width) / 2;
  const circ = 2 * Math.PI * rad;
  return (
    <Animated.View pointerEvents="none" style={[styles.ring, { width: size, height: size, zIndex: 2 }, style]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={rad}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ * 0.28} ${circ}`}
        />
      </Svg>
    </Animated.View>
  );
}

/** La cabeza del Scout, animada según el estado. */
export function ScoutFace({ size, state = 'idle', pose }: { size: number; state?: ScoutAvatarState; pose?: ScoutPose | null }) {
  return (
    <View style={[styles.face, { width: size, height: size, borderRadius: size / 2 }]}>
      <ScoutRig width={size} framing="head" mode={state} pose={pose} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  ring: { position: 'absolute' },
  face: { overflow: 'hidden', backgroundColor: '#E6F0DF' },
  label: { marginTop: space.xs, fontSize: font.small, fontWeight: '700' },
});
