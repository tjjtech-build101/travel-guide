// Avatar del Scout: ilustración simple en SVG (sombrero de scout, pañuelo con pasador y brújula),
// sin assets externos, con un anillo animado (reanimated) según el estado de la llamada:
//   listening → anillo verde que late lento · speaking → anillo azul con ondas rápidas
//   thinking  → arco ámbar que gira · idle/otros → anillo quieto.
// El nombre sale de SCOUT (packages/shared/src/scout.ts): nunca hardcodearlo.
import { SCOUT } from '@build101/shared';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { ScoutState } from '../voice/useScout';
import { colors, font, space } from './theme';

export type ScoutAvatarState = ScoutState;

const RING: Record<ScoutAvatarState, string> = {
  idle: '#C9BFA9',
  connecting: '#E39B1B',
  listening: '#1E8E5A',
  thinking: '#E39B1B',
  speaking: colors.primary,
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
};

export function ScoutAvatar({ size = 96, state = 'idle', showLabel = false }: Props) {
  const color = RING[state];
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
        <ScoutFace size={size} />
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

/** La ilustración: cara amigable con sombrero de campaña, pañuelo rojo con pasador y brújula en el pecho. */
export function ScoutFace({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="scout-clip">
          <Circle cx={50} cy={50} r={48} />
        </ClipPath>
      </Defs>
      <Circle cx={50} cy={50} r={48} fill="#E6F0DF" />
      <G clipPath="url(#scout-clip)">
        {/* Camisa caqui */}
        <Path d="M10 104 C12 82 28 72 50 72 C72 72 88 82 90 104 Z" fill="#C9A66B" />
        <Path d="M50 74 L50 104" stroke="#B08D55" strokeWidth={1.2} />
        {/* Cuello */}
        <Rect x={44} y={60} width={12} height={12} rx={4} fill="#E9B98E" />
        {/* Pañuelo scout + pasador */}
        <Path d="M33 71 L67 71 L50 94 Z" fill="#D9472B" />
        <Path d="M33 71 L50 76 L67 71" stroke="#B73A22" strokeWidth={1.5} fill="none" strokeLinejoin="round" />
        <Circle cx={50} cy={79} r={3.6} fill="#8B5A2B" stroke="#6E4520" strokeWidth={1} />
        {/* Brújula en el pecho */}
        <Circle cx={71} cy={86} r={7} fill="#FFFFFF" stroke="#2B2A27" strokeWidth={1.4} />
        <Path d="M71 80.5 L73 86 L69 86 Z" fill="#D9472B" />
        <Path d="M71 91.5 L73 86 L69 86 Z" fill="#2B2A27" />
        <Circle cx={71} cy={86} r={0.9} fill="#FFFFFF" />
      </G>
      {/* Orejas y cabeza */}
      <Circle cx={32.5} cy={49} r={4} fill="#E9B98E" />
      <Circle cx={67.5} cy={49} r={4} fill="#E9B98E" />
      <Circle cx={50} cy={48} r={18} fill="#F2C9A0" />
      {/* Cara */}
      <Circle cx={43.5} cy={49} r={2.2} fill="#2B2A27" />
      <Circle cx={56.5} cy={49} r={2.2} fill="#2B2A27" />
      <Circle cx={44.2} cy={48.2} r={0.7} fill="#FFFFFF" />
      <Circle cx={57.2} cy={48.2} r={0.7} fill="#FFFFFF" />
      <Circle cx={39.5} cy={55} r={2.8} fill="#EE9C86" opacity={0.6} />
      <Circle cx={60.5} cy={55} r={2.8} fill="#EE9C86" opacity={0.6} />
      <Path d="M44 56 Q50 62 56 56" stroke="#7A3E2A" strokeWidth={2} strokeLinecap="round" fill="none" />
      {/* Sombrero de campaña */}
      <Ellipse cx={50} cy={35} rx={28} ry={5} fill="#8B6A3E" />
      <Path d="M37 35 C37 23 43 18 50 18 C57 18 63 23 63 35 Z" fill="#A47E4B" />
      <Path d="M50 19.5 L50 28 M44 22 L46 28 M56 22 L54 28" stroke="#7E5F35" strokeWidth={1.4} strokeLinecap="round" />
      <Rect x={37.5} y={30.5} width={25} height={3.6} fill="#5B4426" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  ring: { position: 'absolute' },
  label: { marginTop: space.xs, fontSize: font.small, fontWeight: '700' },
});
