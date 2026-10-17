// Fuentes de la llamada: lo que el scout contó como hecho (research, cámara, paradas del tour) con la cita textual de
// la fuente y el link. Así se ve que nada es inventado (Calidad de la IA, DECISIONES: botón "Fuentes").
import type { VoiceSourceGroup } from '@build101/shared';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';

import { Button } from '../../ui/Button';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { useVoiceStore } from '../store';

const TOAST_MS = 10_000;
const KIND_LABEL: Record<VoiceSourceGroup['kind'], string> = { research: 'Lo averiguado', photo: 'De tu foto', stop: 'Parada del tour' };

const domain = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
const count = (gs: VoiceSourceGroup[]) => gs.reduce((n, g) => n + g.items.length, 0);

/** Lista de fuentes agrupada por tema (la usan la hoja y el resumen al cortar). */
export function SourcesList({ groups, dark = false }: { groups: VoiceSourceGroup[]; dark?: boolean }) {
  const ink = dark ? '#fff' : colors.text;
  const quiet = dark ? 'rgba(255,255,255,0.7)' : colors.textMuted;
  if (!groups.length) return <Text style={[styles.empty, { color: quiet }]}>Todavía no hay fuentes en esta llamada.</Text>;
  return (
    <View style={{ gap: space.lg }}>
      {[...groups].reverse().map((g) => (
        <View key={g.id} style={{ gap: space.sm }}>
          <Text style={[styles.kind, { color: quiet }]}>{KIND_LABEL[g.kind]}</Text>
          <Text style={[styles.topic, { color: ink }]}>{g.topic}</Text>
          {g.items.map((it, i) => (
            <Pressable
              key={i}
              onPress={() => void Linking.openURL(it.url)}
              accessibilityRole="link"
              accessibilityLabel={`Abrir fuente ${domain(it.url)}`}
              style={[styles.item, dark && styles.itemDark]}
            >
              {it.text ? <Text style={[styles.text, { color: ink }]}>{it.text}</Text> : null}
              {it.quote ? <Text style={[styles.quote, { color: quiet }]}>«{it.quote}»</Text> : null}
              <Text style={styles.link} numberOfLines={1}>
                {it.title ? `${it.title} · ` : ''}
                {domain(it.url)} ↗
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Hoja de Fuentes (modal). `visible` lo decide quien la monta (dentro de la vista de llamada o fuera). */
export function SourcesSheet({ visible }: { visible: boolean }) {
  const groups = useVoiceStore((s) => s.sources);
  const close = () => useVoiceStore.getState().setSourcesOpen(false);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Fuentes</Text>
            <Text style={styles.sub}>Cada dato se comprobó contra la página de su fuente.</Text>
          </View>
          <Button label="Cerrar" variant="ghost" onPress={close} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
          <SourcesList groups={groups} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Aviso que aparece 10 s cuando llegan fuentes nuevas: "📚 2 datos con fuente · Ver". */
export function SourcesToast({ style }: { style?: object }) {
  const groups = useVoiceStore((s) => s.sources);
  const last = groups.at(-1);
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (!last) return;
    setShownId(last.id);
    const id = setTimeout(() => setShownId((cur) => (cur === last.id ? null : cur)), TOAST_MS);
    return () => clearTimeout(id);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!last || shownId !== last.id) return null;
  const n = last.items.length;
  return (
    <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOut.duration(150)} style={[styles.toast, style]}>
      <Text style={styles.toastText} numberOfLines={2}>
        📚 {n} {n === 1 ? 'dato con fuente' : 'datos con fuente'} · {last.topic}
      </Text>
      <Pressable onPress={() => useVoiceStore.getState().setSourcesOpen(true)} style={styles.toastBtn} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.toastBtnText}>Ver</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Botón "Fuentes (N)" para la vista de llamada. */
export function SourcesButton() {
  const n = useVoiceStore((s) => count(s.sources));
  if (!n) return null;
  return (
    <Pressable onPress={() => useVoiceStore.getState().setSourcesOpen(true)} style={styles.button} accessibilityRole="button">
      <Text style={styles.buttonText}>📚 Fuentes ({n})</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.lg, paddingTop: space.md },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  empty: { fontSize: font.body },
  kind: { fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase' },
  topic: { fontSize: font.body, fontWeight: '700' },
  item: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.xs },
  itemDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
  text: { fontSize: font.small, lineHeight: 21 },
  quote: { fontSize: font.small, fontStyle: 'italic', lineHeight: 20 },
  link: { fontSize: font.tiny, fontWeight: '700', color: colors.primary },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingRight: space.xs,
    minHeight: 48,
    gap: space.sm,
  },
  toastText: { flex: 1, color: '#fff', fontSize: font.small, fontWeight: '600', paddingVertical: space.sm },
  toastBtn: { minHeight: MIN_TOUCH, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  toastBtnText: { color: '#8DB8FF', fontSize: font.body, fontWeight: '800' },
  button: { alignSelf: 'center', marginTop: space.md, paddingHorizontal: space.lg, minHeight: 40, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: font.small },
});
