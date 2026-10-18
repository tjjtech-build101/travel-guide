// Red de seguridad de Expo Router: si una pantalla revienta al renderizar, en vez de la pantalla roja (dev) o un
// cierre (prod) se ve al Scout explicando y un "Reintentar". Se exporta desde app/_layout y app/(app)/_layout.
import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ScoutRig } from '../scout/ScoutRig';
import { Button } from './Button';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <ScoutRig width={130} pose="think" mode="thinking" />
      <Text style={styles.title}>Se me rompió esta pantalla</Text>
      <Text style={styles.body}>
        Fue un error de la app, no tuyo. Lo que tenías guardado sigue ahí: probá de nuevo o volvé al inicio.
      </Text>
      {__DEV__ ? (
        <ScrollView style={styles.devBox}>
          <Text style={styles.dev} selectable>
            {error.name}: {error.message}
            {'\n\n'}
            {error.stack?.split('\n').slice(0, 8).join('\n')}
          </Text>
        </ScrollView>
      ) : null}
      <View style={styles.actions}>
        <Button label="Reintentar" onPress={() => void retry()} style={styles.btn} />
        <Button
          label="Ir al inicio"
          variant="secondary"
          onPress={() => {
            try {
              router.replace('/');
            } catch {
              void retry();
            }
          }}
          style={styles.btn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', lineHeight: 23 },
  devBox: {
    maxHeight: 180,
    alignSelf: 'stretch',
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    padding: space.md,
  },
  dev: { fontSize: font.tiny, color: colors.danger, fontFamily: 'Menlo' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.md },
  btn: { alignSelf: 'stretch' },
});
