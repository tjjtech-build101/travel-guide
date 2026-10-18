// Vista de llamada expandida (PRD 05) como videollamada: el Scout vivo en ScoutStage (con subtítulos encima),\n// tarjetas de acción, controles y transcript completo.
import { VOICE_LANGS } from '@build101/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '../../lib/errors';
import { Button } from '../../ui/Button';
import { CameraIcon, CaptionsIcon, HandIcon, HangUpIcon, MicIcon, SpeakerIcon } from '../../ui/icons';
import { camera, useCameraStore } from '../camera/cameraStore';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { useVoiceStore, type CallError, type Line } from '../store';
import { ActionCards } from './ActionCards';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { mmss, SCOUT_COLOR, useElapsed } from './CallBar';
import { ScoutStage } from './ScoutStage';

const BG = '#14231A';

export function CallView() {
  const status = useVoiceStore((s) => s.status);
  const expanded = useVoiceStore((s) => s.expanded);
  const error = useVoiceStore((s) => s.error);
  const cameraOpen = useCameraStore((s) => s.open);
  // Conectando y error también se ven acá (pantalla completa), aunque no se haya expandido; con la cámara abierta no
  // (iOS no presenta dos Modal: la llamada se abre de fondo para narrar la foto).
  const visible = !cameraOpen && (expanded || status === 'connecting' || status === 'error');
  // Insets explícitos: SafeAreaView dentro de un Modal fullScreen a veces mide 0 en iOS y el header queda bajo el notch.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => useVoiceStore.getState().setExpanded(false)}>
      <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom }]}>
        {status === 'error' ? <ErrorView error={error} /> : <Live />}
      </View>
    </Modal>
  );
}

// La causa real (sin micrófono, sin créditos de OpenAI, sin conexión, sesión vencida…) la explica lib/errors.
function ErrorView({ error }: { error: CallError | null }) {
  const s = useVoiceStore.getState();
  const v = describeError(error, { doing: error?.reconnect ? 'reconectar la llamada' : 'conectar la llamada' });
  return (
    <View style={styles.center}>
      <ScoutAvatar size={120} state="error" />
      {v.tag ? <Text style={styles.errTag}>{v.tag}</Text> : null}
      <Text style={styles.title}>{v.title}</Text>
      <Text style={styles.sub}>{[v.body, v.hint].filter(Boolean).join(' ')}</Text>
      {__DEV__ && v.detail ? (
        <Text style={styles.errDetail} numberOfLines={4} selectable>
          {v.code} · {v.detail}
        </Text>
      ) : null}
      <View style={styles.errButtons}>
        {v.action === 'settings' ? (
          <Button label="Abrir Ajustes" onPress={() => Linking.openSettings()} />
        ) : v.action === 'login' ? (
          <Button
            label="Volver a entrar"
            onPress={() => {
              s.dismissSummary();
              router.replace('/login');
            }}
          />
        ) : (
          <Button label={error?.reconnect ? 'Llamar' : 'Reintentar'} onPress={() => void s.startCall(s.args ?? {})} />
        )}
        <Button label="Cerrar" variant="ghost" onPress={() => s.dismissSummary()} />
      </View>
    </View>
  );
}

function Live() {
  const status = useVoiceStore((s) => s.status);
  const name = useVoiceStore((s) => s.scoutName);
  const speaking = useVoiceStore((s) => s.speaking);
  const startedAt = useVoiceStore((s) => s.startedAt);
  const lines = useVoiceStore((s) => s.lines);
  const notice = useVoiceStore((s) => s.notice);
  const ptt = useVoiceStore((s) => s.turnTaking);
  const captions = useVoiceStore((s) => s.captions);
  const [showAll, setShowAll] = useState(false);
  const connecting = status === 'connecting';
  const elapsed = useElapsed(startedAt);

  return (
    <View style={styles.flex}>
      <View style={styles.top}>
        <Pressable onPress={() => useVoiceStore.getState().setExpanded(false)} hitSlop={12} style={styles.minimizeBtn} accessibilityRole="button" accessibilityLabel="Minimizar">
          <Text style={styles.minimize}>⌄</Text>
        </Pressable>
        <Text style={styles.name} numberOfLines={1}>
          {name || 'Scout'}
        </Text>
        <Text style={styles.timer}>{connecting || !startedAt ? '' : mmss(elapsed)}</Text>
      </View>

      <ScoutStage captions={captions} onOpenTranscript={() => setShowAll(true)}>
        {ptt && speaking === 'assistant' ? (
          <Pressable onPress={() => useVoiceStore.getState().interrupt()} style={styles.interrupt} accessibilityRole="button">
            <Text style={styles.interruptText}>Interrumpir</Text>
          </Pressable>
        ) : null}
      </ScoutStage>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <ActionCards style={styles.cards} />

      <Controls />
      <TranscriptSheet visible={showAll} lines={lines} onClose={() => setShowAll(false)} />
    </View>
  );
}

function Controls() {
  const muted = useVoiceStore((s) => s.muted);
  const speaker = useVoiceStore((s) => s.speaker);
  const ptt = useVoiceStore((s) => s.turnTaking);
  const captions = useVoiceStore((s) => s.captions);
  const lang = useVoiceStore((s) => s.lang);
  const st = useVoiceStore.getState();
  return (
    <View style={styles.controls}>
      <View style={styles.langs}>
        {VOICE_LANGS.map((l) => (
          <Pressable
            key={l}
            onPress={() => st.setLanguage(l)}
            style={[styles.lang, lang === l && styles.langOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: lang === l }}
            accessibilityLabel={`Idioma ${l}`}
          >
            <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Round label={muted ? 'Activar micrófono' : 'Silenciar'} on={muted} onPress={() => st.setMuted(!muted)}>
          <MicIcon color="#fff" off={muted} />
        </Round>
        <Round label={speaker ? 'Usar auricular' : 'Usar parlante'} on={speaker} onPress={() => st.setSpeakerOn(!speaker)}>
          <SpeakerIcon color="#fff" on={speaker} />
        </Round>
        <Round label={ptt ? 'Por turnos (anti eco). Tocá para micrófono abierto' : 'Micrófono abierto. Tocá para hablar por turnos'} on={ptt} onPress={() => st.setTurnTaking(!ptt)}>
          <HandIcon color="#fff" />
        </Round>
        <Round label="Mostrarle algo con la cámara" on={false} onPress={() => camera.open({ source: 'button' })}>
          <CameraIcon color="#fff" />
        </Round>
        <Round label={captions ? 'Ocultar subtítulos' : 'Mostrar subtítulos'} on={captions} onPress={() => st.setCaptions(!captions)}>
          <CaptionsIcon color="#fff" />
        </Round>
      </View>
      <Pressable onPress={() => void st.endCall()} style={styles.hangup} accessibilityRole="button" accessibilityLabel="Colgar">
        <HangUpIcon color="#fff" size={30} />
      </Pressable>
    </View>
  );
}

function Round({ children, label, on, onPress }: { children: React.ReactNode; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} style={[styles.round, on && styles.roundOn]}>
      {children}
    </Pressable>
  );
}

function TranscriptSheet({ visible, lines, onClose }: { visible: boolean; lines: Line[]; onClose: () => void }) {
  const [tab, setTab] = useState<'transcript' | 'events'>('transcript');
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.tabs}>
            {(['transcript', 'events'] as const).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'transcript' ? 'Transcript' : 'Eventos'}</Text>
              </Pressable>
            ))}
          </View>
          <Button label="Cerrar" variant="ghost" onPress={onClose} />
        </View>
        {tab === 'events' ? <EventsLog /> : null}
        <ScrollView style={tab === 'events' ? styles.hidden : undefined} contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
          {lines.filter((l) => l.text.trim()).length === 0 ? <Text style={styles.empty}>Todavía no hablaron.</Text> : null}
          {lines
            .filter((l) => l.text.trim())
            .map((l) => (
              <View key={l.id} style={[styles.bubble, l.role === 'user' ? styles.bubbleUser : styles.bubbleScout]}>
                <Text style={[styles.bubbleText, l.role === 'user' && { color: '#fff' }]}>{l.text}</Text>
              </View>
            ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Consola de la llamada: eventos del data channel, herramientas (args → resultado), ecos descartados, idioma. */
function EventsLog() {
  const events = useVoiceStore((s) => s.events);
  const t0 = events[0]?.at ?? 0;
  return (
    <ScrollView contentContainerStyle={{ padding: space.md, gap: 2 }}>
      {events.length === 0 ? <Text style={styles.empty}>Sin eventos todavía.</Text> : null}
      {events.map((e, i) => (
        <Text key={i} style={[styles.event, e.dir === '🔧' && styles.eventTool, e.dir === '⚠️' && styles.eventWarn]} selectable>
          {`${((e.at - t0) / 1000).toFixed(1).padStart(6)}s ${e.dir} ${e.text}`}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: { paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tabOn: { backgroundColor: colors.text },
  tabText: { fontWeight: '700', color: colors.text, fontSize: font.small },
  tabTextOn: { color: '#fff' },
  hidden: { display: 'none' },
  event: { fontFamily: 'Menlo', fontSize: 11, color: colors.text },
  eventTool: { color: colors.primary, fontWeight: '700' },
  eventWarn: { color: colors.danger },
  root: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, height: MIN_TOUCH, gap: space.md },
  name: { flex: 1, color: '#fff', fontSize: font.h3, fontWeight: '800', textAlign: 'center' },
  minimizeBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  minimize: { color: '#fff', fontSize: 30, lineHeight: 30, marginTop: -8 },
  timer: { color: 'rgba(255,255,255,0.8)', fontSize: font.body, fontVariant: ['tabular-nums'], width: MIN_TOUCH, textAlign: 'right' },
  title: { color: '#fff', fontSize: font.h2, fontWeight: '800', marginTop: space.md, textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: font.body, minHeight: 22, textAlign: 'center' },
  errButtons: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg },
  errTag: { color: 'rgba(255,255,255,0.6)', fontSize: font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space.md },
  errDetail: { color: 'rgba(255,255,255,0.45)', fontSize: 11, textAlign: 'center' },
  cards: { marginHorizontal: space.lg, marginTop: space.md },
  interrupt: { alignSelf: 'center', paddingHorizontal: space.xl, minHeight: MIN_TOUCH, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#fff' },
  interruptText: { color: BG, fontWeight: '800', fontSize: font.body },
  notice: { color: '#FFD98A', fontSize: font.small, textAlign: 'center', marginTop: space.md, marginHorizontal: space.xl },
  controls: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md, alignItems: 'center' },
  langs: { flexDirection: 'row', gap: space.sm },
  lang: { paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  langOn: { backgroundColor: '#fff' },
  langText: { color: '#fff', fontWeight: '700', fontSize: font.small },
  langTextOn: { color: BG },
  row: { flexDirection: 'row', gap: space.lg },
  round: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: SCOUT_COLOR },
  hangup: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: space.lg, paddingTop: space.md },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  empty: { color: colors.textMuted, fontSize: font.body },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: space.md },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleScout: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  bubbleText: { fontSize: font.body, color: colors.text },
});
