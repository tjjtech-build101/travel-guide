// La guía en pantalla: oscurece todo menos el elemento del paso (recorte con borde que late), y el Scout lo
// señala y lo explica con un globo que se escribe mientras habla. Va montada una sola vez, arriba de todo
// (app/_layout). Tocar afuera o "Siguiente" avanza; "Saltear" cierra el recorrido.
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ScoutSays } from '../../ui/ScoutSays';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { GUIDE_FLOWS, type GuideStep } from './flows';
import { useGuideStore } from './store';
import { measureTarget, type Rect } from './targets';

const PAD = 8;
const R = 16;
const DIM = 'rgba(20,30,22,0.66)';

const tick = () => void Haptics.selectionAsync().catch(() => {});

function roundRect({ x, y, w, h }: Rect, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x + rr},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x + rr} A${rr},${rr} 0 0 1 ${x},${y + h - rr} V${y + rr} A${rr},${rr} 0 0 1 ${x + rr},${y} Z`;
}

export function GuideOverlay() {
  const active = useGuideStore((s) => s.active);
  const { width: W, height: H } = useWindowDimensions();
  const step = active ? GUIDE_FLOWS[active.flow][active.index] : null;
  // Lo que se muestra: el paso con su recorte ya medido (así no parpadea entre pasos).
  const [shown, setShown] = useState<{ step: GuideStep; hole: Rect | null } | null>(null);

  useEffect(() => {
    if (!step) {
      setShown(null);
      return;
    }
    let alive = true;
    const measure = step.target ? measureTarget(step.target) : Promise.resolve(null);
    void measure.then((r) => {
      if (!alive) return;
      const hole = r
        ? (() => {
            const x = Math.max(4, r.x - PAD);
            const y = Math.max(4, r.y - PAD);
            return { x, y, w: Math.min(W - 4, r.x + r.w + PAD) - x, h: Math.min(H - 4, r.y + r.h + PAD) - y };
          })()
        : null;
      setShown({ step, hole });
    });
    return () => {
      alive = false;
    };
  }, [step, W, H]);

  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      useGuideStore.getState().close();
      return true;
    });
    return () => sub.remove();
  }, [active]);

  if (!active || !shown) return null;
  const { hole } = shown;
  const total = GUIDE_FLOWS[active.flow].length;
  const last = active.index === total - 1;
  const next = () => {
    tick();
    useGuideStore.getState().next();
  };

  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={next} accessibilityLabel="Siguiente" accessibilityRole="button">
        <Svg width={W} height={H}>
          <Path d={`M0,0 H${W} V${H} H0 Z ${hole ? roundRect(hole, R) : ''}`} fill={DIM} fillRule="evenodd" />
        </Svg>
      </Pressable>
      {hole ? <PulseRing hole={hole} /> : null}
      <StepCard
        key={`${active.flow}.${active.index}`}
        step={shown.step}
        hole={hole}
        index={active.index}
        total={total}
        last={last}
        onNext={next}
        onBack={active.index > 0 ? () => useGuideStore.getState().back() : undefined}
        onSkip={() => useGuideStore.getState().close()}
      />
    </Animated.View>
  );
}

function PulseRing({ hole }: { hole: Rect }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * t.value, transform: [{ scale: 1 + 0.03 * t.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { left: hole.x, top: hole.y, width: hole.w, height: hole.h, borderRadius: Math.min(R, hole.h / 2) }, style]}
    />
  );
}

function StepCard({
  step,
  hole,
  index,
  total,
  last,
  onNext,
  onBack,
  onSkip,
}: {
  step: GuideStep;
  hole: Rect | null;
  index: number;
  total: number;
  last: boolean;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  // Con ancla: el globo va del lado opuesto (arriba o abajo) y el Scout señala hacia el elemento.
  const below = hole ? hole.y + hole.h / 2 < H / 2 : false;
  const targetLeft = hole ? hole.x + hole.w / 2 < W / 2 : false;
  const pose = step.pose ?? (hole ? (targetLeft ? 'pointLeft' : 'pointRight') : 'idle');
  const place = !hole
    ? styles.center
    : below
      ? { bottom: insets.bottom + space.lg, left: space.lg, right: space.lg }
      : { top: insets.top + space.lg, left: space.lg, right: space.lg };

  return (
    <Animated.View entering={FadeInDown.duration(220)} style={[styles.card, place]} pointerEvents="box-none">
      <ScoutSays
        text={step.text}
        title={step.title}
        pose={pose}
        size={hole ? 92 : 150}
        side={!hole ? 'top' : targetLeft ? 'right' : 'left'}
      >
        {total > 1 ? (
          <View style={styles.dots} accessibilityLabel={`Paso ${index + 1} de ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
        ) : null}
        <View style={styles.footer}>
          {!last ? (
            <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button" style={styles.skip}>
              <Text style={styles.skipText}>Saltear</Text>
            </Pressable>
          ) : null}
          <View style={styles.flex} />
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Anterior" style={styles.backBtn}>
              <Text style={styles.backText}>‹</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onNext} accessibilityRole="button" style={({ pressed }) => [styles.next, pressed && { opacity: 0.8 }]}>
            <Text style={styles.nextText}>{last ? (total > 1 ? '¡Dale!' : 'Entendido') : 'Siguiente'}</Text>
          </Pressable>
        </View>
      </ScoutSays>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 3, borderColor: colors.bronze },
  card: { position: 'absolute' },
  center: { left: space.lg, right: space.lg, top: 0, bottom: 0, justifyContent: 'center' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  flex: { flex: 1 },
  skip: { minHeight: 36, justifyContent: 'center' },
  skipText: { fontSize: font.small, color: colors.textMuted, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 5, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.primary, width: 14 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  backText: { fontSize: 22, lineHeight: 24, color: colors.text, fontWeight: '800' },
  next: {
    minHeight: 40,
    minWidth: MIN_TOUCH * 2,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { color: colors.primaryText, fontWeight: '800', fontSize: font.small },
});
