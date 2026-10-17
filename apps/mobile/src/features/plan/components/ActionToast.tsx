// Tarjeta/toast de acción: "Listo · Deshacer" (5 s) que llama `undo` con el undo_token.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';
import { undoAction } from '../mutations';
import { useActionToast } from '../store';

export function ActionToast({ bottom }: { bottom: number }) {
  const toast = useActionToast((s) => s.toast);
  const hide = useActionToast((s) => s.hide);
  const qc = useQueryClient();
  const [undoing, setUndoing] = useState(false);
  if (!toast) return null;

  const bg = toast.tone === 'error' ? colors.danger : colors.warningBg;
  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(150)}
      style={[styles.wrap, { bottom }]}
      pointerEvents="box-none"
    >
      <View style={[styles.box, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.text} numberOfLines={2}>
          {toast.text}
        </Text>
        {toast.undoToken && toast.tripId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Deshacer"
            disabled={undoing}
            onPress={async () => {
              setUndoing(true);
              const { undoToken, tripId, id } = toast;
              hide(id);
              await undoAction(qc, tripId!, undoToken!);
              setUndoing(false);
            }}
            style={styles.undo}
            hitSlop={8}
          >
            {undoing ? <ActivityIndicator color="#fff" /> : <Text style={styles.undoText}>Deshacer</Text>}
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, zIndex: 50 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    minHeight: 52,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  text: { flex: 1, color: '#fff', fontSize: font.small, fontWeight: '600', paddingVertical: space.sm },
  undo: { minHeight: MIN_TOUCH, minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  undoText: { color: '#8DB8FF', fontSize: font.body, fontWeight: '800' },
});
