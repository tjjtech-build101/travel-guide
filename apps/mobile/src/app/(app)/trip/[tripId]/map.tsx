// Tab Mapa (placeholder hasta PRD 03): bloques con coordenadas + último LocationFix.
// Acá se pide el permiso de ubicación (momento justo), no al abrir la app.
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useTripId } from '../../../../features/trips/TripContext';
import { errorDetail, useTripBlocks } from '../../../../features/trips/queries';
import { LocationPermissionError } from '../../../../location/real';
import { useLocationFix, useLocationProvider } from '../../../../location/LocationContext';
import { Button } from '../../../../ui/Button';
import { EmptyState, ErrorState, LoadingList } from '../../../../ui/States';
import { colors, font, radius, space } from '../../../../ui/theme';

export default function MapTab() {
  const tripId = useTripId();
  const blocks = useTripBlocks(tripId);
  const { start, kind } = useLocationProvider();
  const fix = useLocationFix();
  const [locError, setLocError] = useState<Error | null>(null);

  const requestLocation = useCallback(() => {
    void start().then(setLocError);
  }, [start]);

  useFocusEffect(requestLocation);

  const located = (blocks.data ?? []).filter((b) => b.lat != null && b.lng != null);

  return (
    <View style={styles.flex}>
      <View style={styles.fixCard}>
        <Text style={styles.fixTitle}>Tu ubicación ({kind === 'real' ? 'GPS real' : 'simulada'})</Text>
        {locError ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Text style={styles.error}>
              {locError instanceof LocationPermissionError
                ? 'Necesitamos tu ubicación para mostrarte en el mapa.'
                : `No pudimos obtener tu ubicación. ${__DEV__ ? locError.message : ''}`}
            </Text>
            {locError instanceof LocationPermissionError && !locError.canAskAgain ? (
              <Button label="Abrir ajustes" variant="secondary" onPress={() => Linking.openSettings()} />
            ) : (
              <Button label="Reintentar" variant="secondary" onPress={requestLocation} />
            )}
          </View>
        ) : fix ? (
          <Text style={styles.mono}>
            {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
            {'\n'}rumbo {fix.heading == null ? '—' : `${Math.round(fix.heading)}°`} · ±{Math.round(fix.accuracy)} m ·{' '}
            {new Date(fix.t).toLocaleTimeString()}
          </Text>
        ) : (
          <Text style={styles.muted}>Buscando tu ubicación…</Text>
        )}
      </View>

      {blocks.isPending ? (
        <LoadingList count={2} />
      ) : blocks.isError ? (
        <ErrorState message="No pudimos cargar los lugares" detail={errorDetail(blocks.error)} onRetry={() => blocks.refetch()} />
      ) : located.length === 0 ? (
        <EmptyState title="Todavía no hay lugares con ubicación" />
      ) : (
        <FlashList
          data={located}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.mono}>
                {item.lat?.toFixed(5)}, {item.lng?.toFixed(5)}
                {item.place_name ? ` · ${item.place_name}` : ''}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fixCard: {
    margin: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fixTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  mono: { fontFamily: 'Menlo', fontSize: font.tiny, color: colors.textMuted, marginTop: 2 },
  muted: { fontSize: font.small, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl * 2 },
  row: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: font.body, fontWeight: '600', color: colors.text },
});
