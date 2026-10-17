// Botón flotante para llamar al scout (PRD 05): abajo a la derecha encima de las tabs, arrastrable a los bordes.
import { SCOUT } from '@build101/shared';
import { useNetworkState } from 'expo-network';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocationProvider } from '../../location/LocationContext';
import { useToast, Toast } from '../../ui/Toast';
import { useVoiceStore } from '../store';
import { startVoiceWarmup } from '../warmup';
import { ScoutAvatar } from '../../ui/ScoutAvatar';

const SIZE = 64;
const EDGE = 16;
const TAB_BAR = 49;

export function FloatingVoiceButton({ tripId }: { tripId: string }) {
  const status = useVoiceStore((s) => s.status);
  const requestCall = useVoiceStore((s) => s.requestCall);
  const { provider } = useLocationProvider();
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { toast, show } = useToast(2500);
  const [dragging, setDragging] = useState(false);
  // Con el viaje abierto (el botón vive en su layout) la API queda despierta para el toque.
  useEffect(() => startVoiceWarmup(), []);

  const x = useSharedValue(0); // 0 = derecha; negativo = hacia la izquierda
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const leftEdge = -(width - SIZE - EDGE * 2);

  const pan = Gesture.Pan()
    .minDistance(8)
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
      scheduleOnRN(setDragging, true);
    })
    .onUpdate((e) => {
      x.value = Math.min(0, Math.max(leftEdge, startX.value + e.translationX));
      y.value = Math.min(0, Math.max(-400, startY.value + e.translationY));
    })
    .onEnd(() => {
      x.value = withSpring(x.value < leftEdge / 2 ? leftEdge : 0);
      scheduleOnRN(setDragging, false);
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));

  // En llamada manda la barra de arriba.
  if (status === 'live' || status === 'reconnecting' || status === 'ending') return null;

  const onPress = () => {
    if (dragging) return;
    if (offline) return show({ text: 'Sin conexión' });
    const fix = provider.getCurrent();
    void requestCall({ mode: 'chat', tripId, location: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null });
  };

  return (
    <>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.wrap, { bottom: insets.bottom + TAB_BAR + EDGE, right: EDGE }, style]}>
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Llamar a ${SCOUT.name}`}
            style={[styles.btn, offline && styles.offline]}
            hitSlop={6}
          >
            <ScoutAvatar size={SIZE - 12} state={status === 'connecting' ? 'connecting' : 'idle'} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
      <Toast toast={toast} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 40 },
  btn: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: SIZE / 2,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  offline: { opacity: 0.45 },
});
