// "Videollamada" con el Scout (vista expandida de la llamada): el Scout entero, vivo, parado en un paisaje;
// arriba el estado ("Te escucho…", la herramienta que corre) y tu ventanita ("Vos") que se ilumina cuando hablás.
// Los subtítulos van en un panel debajo del recuadro, para no taparle la cara.
// Gestos: saluda al atender y hace pulgar arriba cuando termina una herramienta.
import { SCOUT } from '@build101/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useAuth } from '../../features/auth/AuthProvider';
import { useMyProfile } from '../../features/profile/queries';
import { FRAMES } from '../../scout/behavior';
import { ScoutRig, type ScoutPose } from '../../scout/ScoutRig';
import { Avatar } from '../../ui/Avatar';
import { MicIcon } from '../../ui/icons';
import { SCOUT_RING, SCOUT_STATE_LABEL } from '../../ui/ScoutAvatar';
import { font, radius, space } from '../../ui/theme';
import { useVoiceStore, type Line } from '../store';
import { friendlyToolName } from '../toolBridge';
import { scoutStateOf } from '../useScout';

export function ScoutStage({
  captions,
  onOpenTranscript,
  children,
}: {
  captions: boolean;
  onOpenTranscript: () => void;
  children?: ReactNode;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const state = useVoiceStore(scoutStateOf);
  const status = useVoiceStore((s) => s.status);
  const tools = useVoiceStore((s) => s.toolsRunning);
  const lines = useVoiceStore((s) => s.lines);
  const gesture = useGesture();

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - box.w) > 1 || Math.abs(height - box.h) > 1) setBox({ w: width, h: height });
  };
  const vb = FRAMES.full;
  // Cuerpo entero con los pies abajo, sin pasarse del alto (deja aire arriba para el estado).
  const rigW = Math.min(box.w * 0.8, (box.h * 0.9 * vb.w) / vb.h);
  const ring = status === 'reconnecting' ? SCOUT_RING.connecting : SCOUT_RING[state];
  const label =
    status === 'reconnecting'
      ? 'Se cortó. Reconectando…'
      : tools.length
        ? `${friendlyToolName(tools[0].name)}…`
        : state === 'connecting'
          ? `Llamando a ${SCOUT.name}…`
          : SCOUT_STATE_LABEL[state];

  return (
    <View style={styles.flex}>
      <View style={[styles.tile, { borderColor: ring }]} onLayout={onLayout}>
        {box.w > 0 ? <Backdrop w={box.w} h={box.h} /> : null}
        {rigW > 0 ? <ScoutRig width={rigW} framing="full" mode={state} pose={gesture} style={styles.rig} /> : null}

        {label ? (
          <Animated.View
            key={label}
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(150)}
            style={[styles.pill, { backgroundColor: ring }]}
          >
            <View style={styles.pillDot} />
            <Text style={styles.pillText} numberOfLines={1}>
              {label}
            </Text>
          </Animated.View>
        ) : null}

        <SelfView />

        <View style={styles.bottom} pointerEvents="box-none">
          {children}
        </View>
      </View>
      {captions ? (
        <Pressable onPress={onOpenTranscript} accessibilityRole="button" accessibilityHint="Ver todo el transcript" style={styles.captions}>
          <Captions lines={lines} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Saluda al atender; pulgar arriba cuando termina una herramienta. */
function useGesture(): ScoutPose | null {
  const status = useVoiceStore((s) => s.status);
  const running = useVoiceStore((s) => s.toolsRunning.length);
  const [gesture, setGesture] = useState<ScoutPose | null>(null);
  const prevStatus = useRef(status);
  const prevRunning = useRef(running);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let next: ScoutPose | null = null;
    if (status === 'live' && prevStatus.current === 'connecting') next = 'wave';
    else if (prevRunning.current > 0 && running === 0 && status === 'live') next = 'thumbs';
    prevStatus.current = status;
    prevRunning.current = running;
    if (!next) return;
    setGesture(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setGesture(null), next === 'wave' ? 2200 : 1800);
  }, [status, running]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return gesture;
}

function Captions({ lines }: { lines: Line[] }) {
  const last = lines.filter((l) => l.text.trim()).slice(-2);
  if (!last.length) return <Text style={styles.captionMuted}>Los subtítulos aparecen acá</Text>;
  return (
    <View style={{ gap: space.xs }}>
      {last.map((l) => (
        <Text key={l.id} style={[styles.caption, l.role === 'user' && styles.captionUser]} numberOfLines={2}>
          {l.role === 'user' ? 'Vos: ' : ''}
          {l.text}
        </Text>
      ))}
      {lines.length > 2 ? <Text style={styles.more}>Ver todo</Text> : null}
    </View>
  );
}

/** Tu ventanita: tu foto o iniciales; el borde se prende cuando hablás. */
function SelfView() {
  const { session } = useAuth();
  const profile = useMyProfile();
  const userTalking = useVoiceStore((s) => s.speaking === 'user');
  const muted = useVoiceStore((s) => s.muted);
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = userTalking ? withRepeat(withTiming(1, { duration: 500 }), -1, true) : withTiming(0, { duration: 200 });
  }, [userTalking, glow]);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * glow.value,
    transform: [{ scale: 1 + 0.06 * glow.value }],
  }));
  const person = {
    id: session?.user.id ?? 'yo',
    display_name: profile.data?.display_name ?? (session?.user.user_metadata?.full_name as string | undefined) ?? null,
    avatar_url: profile.data?.avatar_url ?? null,
  };
  return (
    <View style={styles.self} accessibilityLabel={userTalking ? 'Vos, hablando' : 'Vos'}>
      {userTalking ? <Animated.View style={[styles.selfRing, ringStyle]} /> : null}
      <Avatar person={person} size={44} />
      <View style={styles.selfFoot}>
        {muted ? <MicIcon color="#FFB4A8" size={13} off /> : null}
        <Text style={styles.selfName}>Vos</Text>
      </View>
    </View>
  );
}

/** Paisaje de fondo: cielo, sol y lomas (colores del uniforme). */
function Backdrop({ w, h }: { w: number; h: number }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9FCBD8" />
          <Stop offset="0.65" stopColor="#E5EFE6" />
          <Stop offset="1" stopColor="#F3EBDA" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={300} height={400} fill="url(#sky)" />
      <Circle cx={232} cy={92} r={34} fill="#FFE7A6" opacity={0.9} />
      <Circle cx={232} cy={92} r={52} fill="#FFE7A6" opacity={0.25} />
      <Path d="M30,70 q10,-10 22,-2 q10,-8 18,2 q8,0 6,8 h-50 q-4,-6 4,-8 Z" fill="#FFFFFF" opacity={0.8} />
      <Path d="M150,40 q8,-8 18,-2 q8,-6 14,2 q6,0 5,6 h-40 q-3,-5 3,-6 Z" fill="#FFFFFF" opacity={0.65} />
      <Path d="M0,260 C60,215 120,240 170,222 C220,204 260,228 300,214 L300,400 L0,400 Z" fill="#B7CFA0" />
      <Path d="M0,300 C70,268 130,292 200,276 C240,267 270,280 300,272 L300,400 L0,400 Z" fill="#9DBB86" />
      <Path d="M150,400 C160,350 190,320 240,300" stroke="#E9D9B4" strokeWidth={10} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    marginHorizontal: space.md,
    borderRadius: 28,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: '#E5EFE6',
  },
  rig: { position: 'absolute', bottom: -4, alignSelf: 'center' },
  pill: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    maxWidth: '62%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pillText: { color: '#fff', fontWeight: '800', fontSize: font.tiny },
  self: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    width: 72,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: 'rgba(20,35,26,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  selfRing: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.md,
    borderWidth: 3,
    borderColor: '#7CD992',
  },
  selfFoot: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  selfName: { color: '#fff', fontSize: 12, fontWeight: '700' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    gap: space.md,
  },
  flex: { flex: 1 },
  captions: {
    minHeight: 76,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  caption: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  captionUser: { color: '#BFD9FF' },
  captionMuted: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: font.small,
    textAlign: 'center',
  },
  more: { color: '#BFD9FF', fontSize: font.small, fontWeight: '700' },
});
