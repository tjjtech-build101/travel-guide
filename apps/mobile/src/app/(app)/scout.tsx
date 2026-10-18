// Deep link build101://scout?tripId=…&mode=chat|tour: abre la llamada con el Scout desde el widget, una Live Activity
// o el botón de una notificación. Lleva a Ahora del viaje (o a Inicio) y llama; con tour en vivo, en modo tour.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTourStore } from '../../tour/store';
import { Text } from '../../ui/Text';
import { colors, space } from '../../ui/theme';
import { useVoiceStore } from '../../voice/store';

export default function ScoutDeepLink() {
  const { tripId, mode } = useLocalSearchParams<{ tripId?: string; mode?: string }>();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const tour = useTourStore.getState();
    const tourTrip = tour.phase === 'live' ? tour.live?.tripId : null;
    const target = tripId || tourTrip;
    router.replace(target ? { pathname: '/trip/[tripId]/now', params: { tripId: target } } : '/');
    const voice = useVoiceStore.getState();
    if (voice.status === 'live' || voice.status === 'connecting' || voice.status === 'reconnecting') return;
    if (tour.phase === 'live' && (mode === 'tour' || !tripId || tripId === tourTrip)) {
      void tour.askScout(tour.live?.engine.insideStopId ?? null);
    } else {
      void voice.requestCall({ mode: 'chat', tripId: target ?? null });
    }
  }, [tripId, mode]);

  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.scout} />
      <Text style={styles.text}>Llamando al Scout…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: space.md },
  text: { color: colors.textMuted },
});
