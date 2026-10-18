// Una frase del Scout arriba de Ahora (avatar chico + máx. 2 líneas). Tocarla abre la llamada.
// Cuando llega la versión de Claude reemplaza a la de reglas con un fundido corto.
import { SCOUT } from '@build101/shared';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ScoutAvatar } from '../../../../ui/ScoutAvatar';
import { Text } from '../../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../../ui/theme';

type Props = { text: string; loading?: boolean; onPress: () => void };

export function ScoutLine({ text, loading = false, onPress }: Props) {
  const shown = text;
  const prev = useRef(text);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (prev.current === text) return;
    const had = prev.current;
    prev.current = text;
    // Primera frase (o vacía): sin animación. Las siguientes entran con un fundido corto.
    if (!had || !text) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.15);
    const anim = Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true });
    anim.start();
    // Si se corta a la mitad, que no quede transparente.
    return () => {
      anim.stop();
      opacity.setValue(1);
    };
  }, [text, opacity]);

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
