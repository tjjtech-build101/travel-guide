import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError, type ErrorTone } from '../lib/errors';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export type ToastMessage = { text: string; detail?: string; title?: string; tone?: ErrorTone };

/** Toast a partir de un error: causa real (título) + qué hacer. */
export function errorToast(error: unknown, doing?: string): ToastMessage {
  const v = describeError(error, { doing });
  return { title: v.title, text: v.hint ?? v.body, detail: v.detail ? `${v.code} · ${v.detail}` : v.code, tone: v.tone };
}

/** Toast mínimo local a la pantalla (sin librería). */
export function useToast(durationMs = 4000) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (msg: ToastMessage) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(msg);
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + space.xl }]}>
      <View
        style={[styles.box, toast.tone && toast.tone !== 'danger' && styles.soft]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
        <Text style={[styles.text, toast.title ? styles.sub : null]}>{toast.text}</Text>
        {__DEV__ && toast.detail ? <Text style={styles.detail}>{toast.detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  box: { backgroundColor: colors.danger, borderRadius: radius.md, padding: space.md },
  soft: { backgroundColor: colors.warningBg },
  title: { color: '#fff', fontSize: font.body, fontWeight: '700' },
  text: { color: '#fff', fontSize: font.body, fontWeight: '600' },
  sub: { fontSize: font.small, fontWeight: '400', marginTop: 2 },
  detail: { color: '#fff', opacity: 0.85, fontSize: font.tiny, marginTop: space.xs, fontFamily: 'Menlo' },
});
