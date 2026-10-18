// El Scout diciendo algo: el personaje vivo (scout/ScoutRig) al lado de un globo de texto que se va escribiendo
// mientras él "habla" (mueve la boca). Lo usan la guía (features/guide), "Nuevo viaje" y el onboarding.
// Tocar el globo completa el texto. Con "reducir movimiento" el texto aparece entero.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ScoutRig, type ScoutMode, type ScoutPose } from '../scout/ScoutRig';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

const CHARS_PER_S = 38;

/** Revela `text` de a poco. `done` cuando terminó; `finish()` lo completa ya. */
export function useTypewriter(text: string, enabled = true) {
  const reduced = useReducedMotion();
  const instant = !enabled || reduced;
  const [n, setN] = useState(instant ? text.length : 0);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
    if (instant) {
      setN(text.length);
      return;
    }
    setN(0);
    const t0 = Date.now();
    const id = setInterval(() => {
      const next = Math.min(text.length, Math.round(((Date.now() - t0) / 1000) * CHARS_PER_S));
      setN(next);
      if (next >= text.length) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [text, instant]);
  return { shown: text.slice(0, n), done: n >= text.length, finish: () => setN(textRef.current.length) };
}

type Props = {
  text: string;
  title?: string;
  pose?: ScoutPose | null;
  /** Estado del Scout (p. ej. 'thinking' mientras algo carga). Si escribe, habla. */
  mode?: ScoutMode;
  /** Ancho del Scout de cuerpo entero (pt). */
  size?: number;
  /** El Scout a la izquierda (default), a la derecha o arriba del globo. */
  side?: 'left' | 'right' | 'top';
  /** false = el texto aparece entero (sin escribir). */
  typing?: boolean;
  /** Avisa cuando terminó de escribir. */
  onDone?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScoutSays({ text, title, pose, mode = 'idle', size = 84, side = 'left', typing = true, onDone, children, style }: Props) {
  const { shown, done, finish } = useTypewriter(text, typing);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (done) doneRef.current?.();
  }, [done]);

  const talking = !done && mode !== 'thinking';
  const scout = <ScoutRig width={size} mode={mode} pose={pose} talking={talking} />;
  const tail = side === 'top' ? styles.tailTop : side === 'right' ? styles.tailRight : styles.tailLeft;

  return (
    <View style={[side === 'top' ? styles.column : styles.row, side === 'right' && styles.rowReverse, style]}>
      {scout}
      <Pressable
        onPress={finish}
        disabled={done}
        accessibilityRole="text"
        accessibilityLabel={title ? `${title}. ${text}` : text}
        style={[styles.bubble, side === 'top' && styles.bubbleTop]}
      >
        <View style={[styles.tail, tail]} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <View>
          {/* El texto entero invisible reserva el alto: el globo no salta mientras escribe. */}
          <Text style={[styles.text, styles.ghost]}>{text}</Text>
          <Text style={[styles.text, styles.overlay]}>{shown}</Text>
        </View>
        {children}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  rowReverse: { flexDirection: 'row-reverse' },
  column: { alignItems: 'center', gap: space.md },
  bubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
    marginBottom: space.md,
  },
  bubbleTop: { flex: 0, alignSelf: 'stretch', marginBottom: 0 },
  tail: {
    position: 'absolute',
    width: 14,
    height: 14,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    transform: [{ rotate: '45deg' }],
  },
  tailLeft: { left: -8, bottom: 22, borderLeftWidth: 1, borderBottomWidth: 1 },
  tailRight: { right: -8, bottom: 22, borderRightWidth: 1, borderTopWidth: 1 },
  tailTop: { top: -8, alignSelf: 'center', left: '50%', marginLeft: -7, borderLeftWidth: 1, borderTopWidth: 1 },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  text: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  ghost: { opacity: 0 },
  overlay: { position: 'absolute', left: 0, top: 0, right: 0 },
});
