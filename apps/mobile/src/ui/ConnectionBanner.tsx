// Banner global: "Sin conexión — mostrando lo último" cuando no hay red o el canal Realtime cae.
// Arriba, justo debajo del encabezado y chiquito: abajo tapaba la lista y el botón del Scout.
import { useNetworkState } from 'expo-network';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConnectionStore } from '../realtime/connectionStore';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export function useIsOffline(): boolean {
  const network = useNetworkState();
  const realtime = useConnectionStore((s) => s.realtime);
  const noNetwork = network.isConnected === false || network.isInternetReachable === false;
  return noNetwork || realtime === 'error' || realtime === 'closed';
}

export function ConnectionBanner() {
  const offline = useIsOffline();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 48 }]}>
      <View style={styles.pill} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.text}>Sin conexión — mostrando lo último</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
  pill: {
    backgroundColor: colors.warningBg,
    paddingHorizontal: space.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    opacity: 0.92,
  },
  text: { color: colors.warningText, fontSize: font.tiny, fontWeight: '600' },
});
