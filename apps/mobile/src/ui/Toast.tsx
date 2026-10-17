import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export type ToastMessage = { text: string; detail?: string };

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
      <View style={styles.box} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <Text style={styles.text}>{toast.text}</Text>
        {__DEV__ && toast.detail ? <Text style={styles.detail}>{toast.detail}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg },
  box: { backgroundColor: colors.danger, borderRadius: radius.md, padding: space.md },
  text: { color: '#fff', fontSize: font.body, fontWeight: '600' },
  detail: { color: '#fff', opacity: 0.85, fontSize: font.tiny, marginTop: space.xs, fontFamily: 'Menlo' },
});
