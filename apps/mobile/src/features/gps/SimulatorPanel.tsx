// Controles del simulador de GPS para el menú dev (PRD 09): modo, track, reproducción, saltar a parada, fuentes.
import { type NamedPoint, parseTrack, SIM_SPEEDS, synthesizeTrack, TrackCursor } from '@build101/shared';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { SEED_STOPS, SEED_TRACK_LABEL, seedTrack, useSimulator } from '../../location/LocationContext';
import { Button } from '../../ui/Button';
import { colors, font, radius, space } from '../../ui/theme';
import { formatClock, formatDistance } from './format';
import { ScrubBar } from './ScrubBar';
import { useToursWithStops } from './tours';

export function SimulatorPanel() {
  const { sim, state, stops, loadTrack, enabled, setKind, start, active } = useSimulator();
  const [showTours, setShowTours] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const tours = useToursWithStops(showTours);

  const track = sim.getTrack();
  const info = useMemo(() => {
    if (!track) return null;
    const c = new TrackCursor(track);
    return {
      points: track.length,
      distance: c.totalDistance,
      stopTicks: stops.map((s) => c.nearest(s).t),
      stopDistances: stops.map((s) => c.nearest(s).distanceM),
    };
    // El track cambia junto con trackLabel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, state.trackLabel, stops]);

  const ensureRunning = async () => {
    if (!enabled) setKind('simulated');
    if (!active || !enabled) await start('simulated');
  };

  const pickFile = async () => {
    setPicking(true);
    setMessage(null);
    try {
      const res = await File.pickFileAsync({ mimeTypes: ['application/json', 'public.json', 'text/plain'] });
      if (res.canceled) return;
      const text = await res.result.text();
      const parsed = parseTrack(text);
      if (!parsed.ok) {
        setMessage({ text: `El archivo no tiene el formato de track: ${parsed.error}`, error: true });
        return;
      }
      loadTrack(parsed.track, res.result.name, stops);
      setMessage({ text: `Track cargado: ${res.result.name}` });
    } catch (e) {
      setMessage({ text: `No pudimos abrir el archivo: ${e instanceof Error ? e.message : String(e)}`, error: true });
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Ubicación simulada</Text>
          <Text style={styles.muted}>{enabled ? 'Replay de un track (SIM)' : 'GPS real (expo-location)'}</Text>
        </View>
        <Switch value={enabled} onValueChange={(v) => setKind(v ? 'simulated' : 'real')} accessibilityLabel="Usar ubicación simulada" />
      </View>

      {!state.trackLabel ? (
        <Text style={styles.muted}>Cargá un track para empezar.</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label} numberOfLines={2}>
            {state.trackLabel}
          </Text>
          {info ? (
            <Text style={styles.muted}>
              {info.points} puntos · {formatDistance(info.distance)} · {formatClock(state.duration)}
            </Text>
          ) : null}

          <ScrubBar value={state.t} max={state.duration} onSeek={(v) => sim.seek(v)} ticks={info?.stopTicks} />

          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state.playing ? 'Pausar' : 'Reproducir'}
              onPress={async () => {
                if (state.playing) sim.pause();
                else {
                  await ensureRunning();
                  sim.play();
                }
              }}
              style={({ pressed }) => [styles.play, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.playText}>{state.playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <View style={styles.speeds}>
              {SIM_SPEEDS.map((x) => (
                <Pressable
                  key={x}
                  accessibilityRole="button"
                  accessibilityLabel={`Velocidad ${x}x`}
                  accessibilityState={{ selected: state.speed === x }}
                  onPress={() => sim.setSpeed(x)}
                  style={[styles.speed, state.speed === x && styles.speedOn]}
                >
                  <Text style={[styles.speedText, state.speed === x && styles.speedTextOn]}>{x}x</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {!enabled ? <Text style={styles.muted}>Prendé "Ubicación simulada" para que la app use este track.</Text> : null}
        </View>
      )}

      {state.trackLabel && stops.length ? (
        <View style={{ gap: space.xs }}>
          <Text style={styles.subTitle}>Saltar a parada (15 s antes de llegar)</Text>
          {stops.map((s, i) => {
            const far = info ? info.stopDistances[i] > 20 : false;
            return (
              <Pressable
                key={`${s.name}-${i}`}
                accessibilityRole="button"
                onPress={async () => {
                  await ensureRunning();
                  sim.seekToPoint(s.lat, s.lng, 15);
                }}
                style={({ pressed }) => [styles.stopRow, pressed && { backgroundColor: colors.surfaceMuted }]}
              >
                <Text style={styles.stopNum}>{i + 1}</Text>
                <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>
                  {s.name}
                </Text>
                {far && info ? <Text style={styles.warn}>a {Math.round(info.stopDistances[i])} m del track</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Text style={styles.subTitle}>Cargar track</Text>
        <Button
          label="Ciudad Vieja (seed)"
          variant="secondary"
          onPress={() => {
            loadTrack(seedTrack(), SEED_TRACK_LABEL, SEED_STOPS);
            setMessage({ text: 'Track del seed cargado' });
          }}
        />
        <Button label={showTours ? 'Ocultar tours' : 'Desde un tour…'} variant="secondary" onPress={() => setShowTours((v) => !v)} />
        {showTours ? (
          <ToursList
            loading={tours.isPending}
            error={tours.isError ? (tours.error as Error).message : null}
            onRetry={() => tours.refetch()}
            tours={tours.data ?? []}
            onWalk={(title, tourStops) => {
              const tr = synthesizeTrack(tourStops, { dwellS: 30, leadInS: 30 });
              loadTrack(tr, `Tour "${title}" (sintético)`, tourStops);
              setMessage({ text: `Track sintético: ${tourStops.length} paradas, 30 s en cada una` });
            }}
            onUseStops={(title, tourStops) => {
              if (track) loadTrack(track, state.trackLabel ?? title, tourStops);
              setMessage({ text: `Paradas de "${title}" sobre el track actual` });
            }}
          />
        ) : null}
        <Button label="Desde un archivo JSON…" variant="secondary" loading={picking} onPress={pickFile} />
        <Button label="Grabar track / grabaciones" variant="secondary" onPress={() => router.push('/dev-record')} />
        {message ? <Text style={message.error ? styles.error : styles.muted}>{message.text}</Text> : null}
      </View>
    </View>
  );
}

function ToursList({
  loading,
  error,
  onRetry,
  tours,
  onWalk,
  onUseStops,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  tours: { id: string; title: string; status: string; stops: NamedPoint[] }[];
  onWalk: (title: string, stops: NamedPoint[]) => void;
  onUseStops: (title: string, stops: NamedPoint[]) => void;
}) {
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (error)
    return (
      <View style={{ gap: space.sm }}>
        <Text style={styles.error}>No pudimos cargar los tours. {__DEV__ ? error : ''}</Text>
        <Button label="Reintentar" variant="secondary" onPress={onRetry} />
      </View>
    );
  if (!tours.length) return <Text style={styles.muted}>Todavía no hay tours. Generá uno y volvé.</Text>;
  return (
    <View style={{ gap: space.sm }}>
      {tours.map((t) => (
        <View key={t.id} style={styles.card}>
          <Text style={styles.label} numberOfLines={1}>
            {t.title}
          </Text>
          <Text style={styles.muted}>
            {t.stops.length} paradas · {t.status}
          </Text>
          {t.stops.length ? (
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
              <Button label="Caminarlo" onPress={() => onWalk(t.title, t.stops)} style={{ flex: 1 }} />
              <Button label="Solo paradas" variant="secondary" onPress={() => onUseStops(t.title, t.stops)} style={{ flex: 1 }} />
            </View>
          ) : (
            <Text style={styles.muted}>Sin paradas con ubicación</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.xs },
  label: { fontSize: font.body, color: colors.text },
  subTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.small, color: colors.textMuted },
  error: { fontSize: font.small, color: colors.danger },
  warn: { fontSize: font.tiny, color: colors.danger },
  mono: { fontFamily: 'Menlo', fontSize: font.tiny, color: colors.textMuted },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  play: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: { color: colors.primaryText, fontSize: 20, fontWeight: '700' },
  speeds: { flex: 1, flexDirection: 'row', gap: space.xs },
  speed: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedOn: { backgroundColor: colors.text, borderColor: colors.text },
  speedText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  speedTextOn: { color: colors.surface },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.xs, borderRadius: radius.sm },
  stopNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 26,
    fontSize: font.tiny,
    fontWeight: '700',
    color: colors.surface,
    backgroundColor: colors.primary,
  },
});
