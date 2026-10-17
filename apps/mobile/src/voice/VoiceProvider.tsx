// Monta la voz global (PRD 05): barra de llamada arriba de todo, tarjetas, vista expandida, resumen y permiso.
// La barra va en el flujo (empuja el contenido); debajo, el inset de arriba es 0 para que los headers no lo sumen dos veces.
import { SCOUT } from '@build101/shared';
import { useEffect, type ReactNode } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocationProvider } from '../location/LocationContext';
import { Button } from '../ui/Button';
import { ScoutAvatar } from '../ui/ScoutAvatar';
import { colors, font, radius, space } from '../ui/theme';
import { setLocationSource, useVoiceStore } from './store';
import { ActionCards } from './ui/ActionCards';
import { CallBar } from './ui/CallBar';
import { CallSummary } from './ui/CallSummary';
import { CameraModal } from './camera/CameraModal';
import { CallView } from './ui/CallView';

export function VoiceProvider({ children }: { children: ReactNode }) {
  const status = useVoiceStore((s) => s.status);
  const expanded = useVoiceStore((s) => s.expanded);
  const insets = useSafeAreaInsets();
  const { provider } = useLocationProvider();
  // El store vive fuera de React: le pasamos de dónde sacar la ubicación (real | simulada).
  useEffect(() => {
    setLocationSource(() => {
      const f = provider.getCurrent();
      return f ? { lat: f.lat, lng: f.lng, accuracy: f.accuracy, heading: f.heading } : null;
    });
  }, [provider]);
  const inCall = status === 'live' || status === 'reconnecting' || status === 'ending';

  return (
    <View style={styles.flex}>
      {inCall ? <CallBar /> : null}
      <SafeAreaInsetsContext.Provider value={inCall ? { ...insets, top: 0 } : insets}>
        <View style={styles.flex}>
          {children}
          {inCall && !expanded ? <ActionCards style={styles.floatingCards} /> : null}
        </View>
      </SafeAreaInsetsContext.Provider>
      <CallView />
      <CameraModal />
      <CallSummary />
      <MicPermissionSheet />
    </View>
  );
}

function MicPermissionSheet() {
  const ask = useVoiceStore((s) => s.askPermission);
  const answer = useVoiceStore((s) => s.answerPermission);
  return (
    <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => void answer(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScoutAvatar size={72} />
          <Text style={styles.title}>Para hablar con {SCOUT.name}</Text>
          <Text style={styles.body}>
            Necesitamos el micrófono para que puedas hablarle como en una llamada. Solo escucha mientras la llamada está abierta.
          </Text>
          <Button label="Permitir micrófono" onPress={() => void answer(true)} style={styles.btn} />
          <Button label="Ahora no" variant="ghost" onPress={() => void answer(false)} style={styles.btn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floatingCards: { position: 'absolute', top: space.sm, left: space.lg, right: space.lg, zIndex: 60 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: space.md },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 23 },
  btn: { alignSelf: 'stretch' },
});
