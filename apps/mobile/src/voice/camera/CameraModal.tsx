// Cámara a pedido (PRD 08): visor → disparo → "Mirando…" sobre la foto congelada → resultado. El resultado entra a la
// llamada como [EVENTO:photo_result] y el scout lo narra. Abrirla no corta al scout (mode picture, sin micrófono).
import type { LookAtPhotoOutput } from '@build101/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { callTool } from '../../lib/api';
import { Button } from '../../ui/Button';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { currentLocation, useVoiceStore } from '../store';
import { useCameraStore } from './cameraStore';

type Phase =
  | { kind: 'viewfinder' }
  | { kind: 'looking'; uri: string; slow: boolean }
  | { kind: 'result'; uri: string; out: LookAtPhotoOutput }
  | { kind: 'error'; uri: string | null; message: string; retry: (() => void) | null };

const PREFERRED_SIZES = ['1280x720', 'Medium', 'High'];
const RETRIES = 2;
const AUTO_CLOSE_MS = 6000;

export function CameraModal() {
  const open = useCameraStore((s) => s.open);
  return (
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => useCameraStore.getState().close()}>
      {open ? <CameraScreen /> : null}
    </Modal>
  );
}

function CameraScreen() {
  const question = useCameraStore((s) => s.question);
  const source = useCameraStore((s) => s.source);
  const close = useCameraStore((s) => s.close);
  const [perm, requestPerm] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [size, setSize] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>({ kind: 'viewfinder' });

  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) void requestPerm();
  }, [perm, requestPerm]);

  // Se cierra sola a los 6 s del resultado (el scout ya lo está narrando).
  useEffect(() => {
    if (phase.kind !== 'result') return;
    const id = setTimeout(close, AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [phase.kind, close]);

  const onReady = async () => {
    try {
      const sizes = (await ref.current?.getAvailablePictureSizesAsync()) ?? [];
      setSize(PREFERRED_SIZES.find((s) => sizes.includes(s)));
    } catch {
      // nos quedamos con el default
    }
  };

  const send = async (uri: string, base64: string, attempt = 0): Promise<void> => {
    const t0 = Date.now();
    const fix = currentLocation();
    if (!fix) return setPhase({ kind: 'error', uri, message: 'No tengo tu ubicación todavía.', retry: () => void send(uri, base64) });
    const slowTimer = setTimeout(() => setPhase((p) => (p.kind === 'looking' ? { ...p, slow: true } : p)), 2500);
    const res = await callTool<'look_at_photo', LookAtPhotoOutput>(
      'look_at_photo',
      {
        image_base64: base64,
        lat: fix.lat,
        lng: fix.lng,
        heading: fix.heading ?? null,
        accuracy: fix.accuracy ?? null,
        question: question ?? undefined,
        trip_id: useVoiceStore.getState().args?.tripId ?? undefined,
        tour_id: useVoiceStore.getState().args?.tourId ?? undefined,
        taken_at: new Date().toISOString(),
        language: useVoiceStore.getState().lang,
      },
      { actor: source === 'voice' ? 'agent' : 'user' },
    );
    clearTimeout(slowTimer);
    if (!res.ok) {
      const retryable = res.error.code === 'network_error' || res.error.code.startsWith('http_5') || res.error.code === 'internal';
      if (retryable && attempt < RETRIES) return send(uri, base64, attempt + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const message = res.error.code === 'vision_unavailable' ? 'Ahora no puedo mirar fotos.' : 'No pude mandar la foto.';
      return setPhase({ kind: 'error', uri, message, retry: () => void send(uri, base64) });
    }
    const out = res.data;
    console.log(`[camera] disparo → resultado ${Date.now() - t0} ms · servidor ${JSON.stringify(out.timings)}`);
    if (out.quality !== 'ok') {
      return setPhase({ kind: 'error', uri, message: out.quality === 'dark' ? 'Salió oscura, probá de nuevo.' : 'Salió movida, probá de nuevo.', retry: null });
    }
    setPhase({ kind: 'result', uri, out });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (out.facts_used.length) {
      useVoiceStore.getState().addSources({
        kind: 'photo',
        topic: out.place && out.place.confidence >= 0.6 ? out.place.name : 'Tu foto',
        items: out.facts_used.map((f) => ({ text: f.text, url: f.source_url })),
      });
    }
    // El scout lo narra (si hay llamada). Sin llamada, la tarjeta alcanza.
    useVoiceStore.getState().injectEvent('photo_result', {
      photo_id: out.photo_id,
      question,
      place: out.place,
      narration: out.narration,
      inscriptions: out.inscriptions,
      facts_used: out.facts_used,
    });
  };

  const shoot = async () => {
    if (!ref.current || phase.kind !== 'viewfinder') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const pic = await ref.current.takePictureAsync({ quality: 0.6, base64: true, exif: false, shutterSound: false });
      if (!pic?.base64) throw new Error('sin imagen');
      setPhase({ kind: 'looking', uri: pic.uri, slow: false });
      await send(pic.uri, pic.base64);
    } catch (e) {
      setPhase({ kind: 'error', uri: null, message: 'No pude sacar la foto.', retry: () => setPhase({ kind: 'viewfinder' }) });
      console.warn('[camera]', e);
    }
  };

  if (!perm) return <View style={styles.root} />;
  if (!perm.granted) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <Text style={styles.title}>Necesitamos la cámara</Text>
        <Text style={styles.sub}>Para que el scout vea lo que tenés enfrente.</Text>
        <Button label={perm.canAskAgain ? 'Permitir cámara' : 'Abrir Ajustes'} onPress={() => (perm.canAskAgain ? void requestPerm() : void Linking.openSettings())} style={styles.btn} />
        <Button label="Cerrar" variant="ghost" onPress={close} style={styles.btn} />
      </SafeAreaView>
    );
  }

  const frozen = phase.kind !== 'viewfinder' ? phase.uri : null;
  return (
    <View style={styles.root}>
      {/* mode picture y mute: no toca la sesión de audio de la llamada (el scout sigue hablando). */}
      <CameraView ref={ref} style={StyleSheet.absoluteFill} mode="picture" mute animateShutter={false} pictureSize={size} onCameraReady={() => void onReady()} />
      {frozen ? <Image source={{ uri: frozen }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.top}>
          <Pressable onPress={close} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Cerrar cámara" hitSlop={10}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          {question ? (
            <View style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={2}>
                {question}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.bottom}>
          {phase.kind === 'viewfinder' ? (
            <Pressable onPress={() => void shoot()} style={styles.shutter} accessibilityRole="button" accessibilityLabel="Sacar foto">
              <View style={styles.shutterInner} />
            </Pressable>
          ) : null}
          {phase.kind === 'looking' ? (
            <View style={styles.card}>
              <ActivityIndicator color={colors.text} />
              <Text style={styles.cardTitle}>{phase.slow ? 'Mirando… un segundo' : 'Mirando…'}</Text>
            </View>
          ) : null}
          {phase.kind === 'result' ? <ResultCard out={phase.out} onDone={close} /> : null}
          {phase.kind === 'error' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{phase.message}</Text>
              <View style={styles.row}>
                {phase.retry ? <Button label="Reintentar" onPress={phase.retry} /> : <Button label="Otra foto" onPress={() => setPhase({ kind: 'viewfinder' })} />}
                <Button label="Cerrar" variant="ghost" onPress={close} />
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

function ResultCard({ out, onDone }: { out: LookAtPhotoOutput; onDone: () => void }) {
  const [showSources, setShowSources] = useState(false);
  const sure = !!out.place && out.place.confidence >= 0.6;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{sure ? out.place!.name : 'No lo reconozco'}</Text>
      {out.inscriptions.map((ins, i) => (
        <View key={i} style={styles.inscription}>
          <Text style={styles.insOriginal}>«{ins.original}»</Text>
          {ins.translation ? <Text style={styles.insTranslation}>{ins.translation}</Text> : null}
        </View>
      ))}
      {showSources ? (
        out.facts_used.length ? (
          out.facts_used.map((f, i) => (
            <Pressable key={i} onPress={() => void Linking.openURL(f.source_url)} accessibilityRole="link">
              <Text style={styles.source} numberOfLines={2}>
                {f.text} · {f.source_url.replace(/^https?:\/\//, '').split('/')[0]}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.source}>Sin datos verificados: solo lo que se ve en la foto.</Text>
        )
      ) : null}
      <View style={styles.row}>
        <Button label={showSources ? 'Ocultar fuentes' : 'Fuentes'} variant="ghost" onPress={() => setShowSources((v) => !v)} />
        <Button label="Listo" onPress={onDone} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md, backgroundColor: colors.bg },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text, textAlign: 'center' },
  sub: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  btn: { alignSelf: 'stretch' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  closeBtn: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  chip: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  chipText: { color: '#fff', fontSize: font.small, fontWeight: '600' },
  bottom: { padding: space.lg, alignItems: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  card: { alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, alignItems: 'center' },
  cardTitle: { fontSize: font.h3, fontWeight: '800', color: colors.text, textAlign: 'center' },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  inscription: { alignSelf: 'stretch', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.sm },
  insOriginal: { fontSize: font.small, fontStyle: 'italic', color: colors.text },
  insTranslation: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  source: { fontSize: font.tiny, color: colors.primary, alignSelf: 'stretch' },
});
