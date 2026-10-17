// Una frase del Scout arriba de Ahora (avatar chico + máx. 2 líneas). Tocarla abre la llamada.
// Cuando llega la versión de Claude reemplaza a la de reglas con un fundido corto.
import { SCOUT } from '@build101/shared';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ScoutAvatar } from '../../../../ui/ScoutAvatar';
import { Text } from '../../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../../ui/theme';

type Props = { text: string; loading?: boolean; onPress: () => void };

export function ScoutLine({ text, loading = false, onPress }: Props) {
  const [shown, setShown] = useState(text);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (text === shown) return;
    // Primera frase: sin animación.
    if (!shown) {
      setShown(text);
      return;
    }
    const out = Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true });
    out.start(({ finished }) => {
      if (!finished) return;
      setShown(text);
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
    return () => out.stop();
  }, [text, shown, opacity]);

  const empty = !shown;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={empty ? `${SCOUT.name} está pensando` : `${SCOUT.name}: ${shown}`}
      accessibilityHint="Abre la llamada"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <ScoutAvatar size={28} state={loading && empty ? 'thinking' : 'idle'} />
      {empty ? (
        <View style={styles.skeleton} />
      ) : (
        <Animated.View style={[styles.textWrap, { opacity }]}>
          <Text style={styles.text} numberOfLines={2}>
            {shown}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  textWrap: { flex: 1 },
  text: { fontSize: font.body, lineHeight: 22, color: colors.text },
  skeleton: { flex: 1, height: 14, borderRadius: radius.sm, backgroundColor: colors.skeleton, marginRight: space.xxl },
});
