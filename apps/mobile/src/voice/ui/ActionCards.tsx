// Tarjetas de acción de la llamada (PRD 05): "Agregué «Café» · 17:00 · Deshacer". 8 s visibles, máx. 3 apiladas.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';

import { undoAction } from '../../features/plan/mutations';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { useVoiceStore, type ActionCard } from '../store';

export function ActionCards({ style }: { style?: object }) {
  const actions = useVoiceStore((s) => s.actions);
  if (!actions.length) return null;
  return (
    <View style={[styles.stack, style]} pointerEvents="box-none">
      {actions.map((a) => (
        <Card key={a.id} card={a} />
      ))}
    </View>
  );
}

function Card({ card }: { card: ActionCard }) {
  const qc = useQueryClient();
  const dismiss = useVoiceStore((s) => s.dismissAction);
  const [busy, setBusy] = useState(false);
  return (
    <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOut.duration(150)} style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.icon}>{card.proposed ? '🗳️' : '✅'}</Text>
      <Text style={styles.text} numberOfLines={2}>
        {card.text}
      </Text>
      {card.proposed && card.tripId ? (
        <Pressable
          style={styles.btn}
          accessibilityRole="button"
          onPress={() => {
            useVoiceStore.getState().setExpanded(false);
            router.push({ pathname: '/plan/proposals', params: { tripId: card.tripId! } });
          }}
        >
          <Text style={styles.btnText}>Ver</Text>
        </Pressable>
      ) : null}
      {card.tripId && card.undoToken ? (
        <Pressable
          style={styles.btn}
          accessibilityRole="button"
          accessibilityLabel="Deshacer"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await undoAction(qc, card.tripId!, card.undoToken);
            dismiss(card.id);
          }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Deshacer</Text>}
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: 52,
    gap: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  icon: { fontSize: 18 },
  text: { flex: 1, color: '#fff', fontSize: font.small, fontWeight: '600', paddingVertical: space.sm },
  btn: { minHeight: MIN_TOUCH, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  btnText: { color: '#8DB8FF', fontSize: font.body, fontWeight: '800' },
});
