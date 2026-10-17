// Grabación de tracks reales (PRD 09, menú dev): grabar el paseo caminando y exportarlo como TrackPoint[] JSON.
import { maxJumpMeters, parseTrack, TrackCursor } from '@build101/shared';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { accuracyColor, formatClock, formatDistance } from '../../features/gps/format';
import { useSimulator } from '../../location/LocationContext';
import { LocationPermissionError } from '../../location/real';
import {
  deleteTrackFile,
  listRecordings,
  readTrackFile,
  type RecorderState,
  type RecordingFile,
  shareTrackFile,
  trackRecorder,
} from '../../location/recorder';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';

export default function RecordTrackScreen() {
  const [rec, setRec] = useState<RecorderState>(() => trackRecorder.state);
  const [files, setFiles] = useState<RecordingFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; settings?: boolean } | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const { loadTrack, stops } = useSimulator();

  useEffect(() => trackRecorder.subscribe(setRec), []);

  const refresh = useCallback(() => {
    try {
      setFiles(listRecordings());
      setFilesError(null);
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : String(e));
      setFiles([]);
    }
  }, []);
  useEffect(refresh, [refresh]);

  const startRec = async () => {
    setError(null);
    setBusy(true);
    try {
      await trackRecorder.start();
    } catch (e) {
      if (e instanceof LocationPermissionError) {
        setError({ text: 'Necesitamos tu ubicación para grabar el track.', settings: !e.canAskAgain });
      } else setError({ text: `No pudimos arrancar la grabación: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const stopRec = async () => {
    setBusy(true);
    try {
      const out = await trackRecorder.stop();
      refresh();
      if (out?.smoothed) {
        Alert.alert('Track guardado', `${rec.points} puntos. ¿Lo compartís ahora?`, [
          { text: 'Después', style: 'cancel' },
          { text: 'Compartir crudo', onPress: () => share(out.raw.uri) },
          { text: 'Compartir suavizado', onPress: () => share(out.smoothed!.uri) },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const share = (uri: string) =>
    shareTrackFile(uri).catch((e) => setError({ text: `No pudimos compartir: ${e instanceof Error ? e.message : String(e)}` }));

  const syncMark = () => {
    trackRecorder.mark();
    setFlash(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => setFlash(false), 300);
  };

  const loadInSim = async (f: RecordingFile) => {
    try {
      const parsed = parseTrack(await readTrackFile(f.uri));
      if (!parsed.ok) {
        Alert.alert('El archivo no tiene el formato de track', parsed.error);
        return;
      }
      const c = new TrackCursor(parsed.track);
      loadTrack(parsed.track, f.name, stops);
      Alert.alert(
        'Track cargado en el simulador',
        `${parsed.track.length} puntos · ${formatDistance(c.totalDistance)} · ${formatClock(c.duration)} · salto máx. ${Math.round(maxJumpMeters(parsed.track))} m`,
      );
    } catch (e) {
      Alert.alert('No pudimos abrir el track', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Grabar track' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.big}>{formatClock(rec.elapsedS)}</Text>
          <View style={styles.statsRow}>
            <Stat label="Puntos" value={String(rec.points)} />
            <Stat label="Distancia" value={formatDistance(rec.distanceM)} />
            <Stat
              label="Precisión"
              value={rec.accuracy == null ? '—' : `±${Math.round(rec.accuracy)} m`}
              color={accuracyColor(rec.accuracy)}
            />
          </View>
          {rec.recording ? (
            <View style={{ gap: space.sm }}>
              <Button label="Marca de sync" variant="secondary" onPress={syncMark} />
              <Button label="Parar y guardar" variant="danger" loading={busy} onPress={stopRec} />
            </View>
          ) : (
            <Button label="Grabar" loading={busy} onPress={startRec} />
          )}
          {rec.marks.length ? (
            <Text style={styles.muted}>Marcas de sync: {rec.marks.map((m) => `${m.toFixed(1)} s`).join(', ')}</Text>
          ) : null}
          {rec.recording ? (
            <Text style={styles.muted}>
              Dejá la app abierta y la pantalla prendida. Se guarda solo cada 10 s{rec.fileName ? ` en ${rec.fileName}.raw.json` : ''}.
            </Text>
          ) : (
            <Text style={styles.muted}>
              Graba 1 punto por segundo con la app en primer plano. Para sincronizar con el video, tocá "Marca de sync" con el
              celu frente a la cámara.
            </Text>
          )}
          {rec.error ? <Text style={styles.error}>{rec.error}</Text> : null}
          {error ? (
            <View style={{ gap: space.sm }}>
              <Text style={styles.error}>{error.text}</Text>
              {error.settings ? <Button label="Abrir ajustes" variant="secondary" onPress={() => Linking.openSettings()} /> : null}
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Grabaciones en este celu</Text>
        {files == null ? (
          <Text style={styles.muted}>Cargando…</Text>
        ) : filesError ? (
          <View style={{ gap: space.sm }}>
            <Text style={styles.error}>No pudimos leer las grabaciones. {__DEV__ ? filesError : ''}</Text>
            <Button label="Reintentar" variant="secondary" onPress={refresh} />
          </View>
        ) : files.length === 0 ? (
          <Text style={styles.muted}>Todavía no grabaste ningún track.</Text>
        ) : (
          files.map((f) => (
            <View key={f.uri} style={styles.card}>
              <Text style={styles.label} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={styles.muted}>
                {f.smoothed ? 'Suavizado (1 Hz)' : 'Crudo'}
                {f.modified ? ` · ${new Date(f.modified).toLocaleString()}` : ''}
              </Text>
              <View style={styles.actions}>
                <Button label="Compartir" variant="secondary" onPress={() => share(f.uri)} style={{ flex: 1 }} />
                <Button label="Al simulador" variant="secondary" onPress={() => loadInSim(f)} style={{ flex: 1 }} />
              </View>
              <Button
                label="Borrar"
                variant="ghost"
                onPress={() =>
                  Alert.alert('¿Borrar este track?', f.name, [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Borrar',
                      style: 'destructive',
                      onPress: () => {
                        deleteTrackFile(f.uri);
                        refresh();
                      },
                    },
                  ])
                }
              />
            </View>
          ))
        )}
      </ScrollView>
      {flash ? <View style={styles.flash} pointerEvents="none" /> : null}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl * 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  big: { fontSize: 44, fontWeight: '700', color: colors.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row' },
  statValue: { fontSize: font.h3, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, marginTop: space.md },
  label: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  muted: { fontSize: font.small, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger },
  actions: { flexDirection: 'row', gap: space.sm },
  flash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' },
});
