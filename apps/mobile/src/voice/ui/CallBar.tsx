// Barra de llamada tipo WhatsApp (PRD 05): verde, arriba de todo, en todas las pantallas. Tocar → vista expandida.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, space } from '../../ui/theme';
import { useVoiceStore } from '../store';
import { friendlyToolName } from '../toolBridge';
import { SCOUT_COLOR } from './ScoutAvatar';

export const CALL_BAR_HEIGHT = 44;

export function mmss(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Segundos desde startedAt, re-renderizando cada 1 s. */
export function useElapsed(startedAt: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
}

/** Texto extra opcional (PRD 07: "Tour · próxima: Cabildo · 3 min"). */
export const useCallBarSubtitle = { current: null as null | (() => string | null) };

export function CallBar() {
  const status = useVoiceStore((s) => s.status);
  const startedAt = useVoiceStore((s) => s.startedAt);
  const speaking = useVoiceStore((s) => s.speaking);
  const tool = useVoiceStore((s) => s.toolsRunning[0]?.name);
  const name = useVoiceStore((s) => s.scoutName);
  const setExpanded = useVoiceStore((s) => s.setExpanded);
  const insets = useSafeAreaInsets();
  const elapsed = useElapsed(startedAt);
  const reconnecting = status === 'reconnecting';
  const right = reconnecting
    ? 'Se cortó. Reconectando…'
    : tool
      ? `${friendlyToolName(tool)}…`
      : speaking === 'assistant'
        ? 'hablando'
        : speaking === 'user'
          ? 'te escucha'
          : (useCallBarSubtitle.current?.() ?? 'en llamada');

  return (
    <Pressable
      onPress={() => setExpanded(true)}
      accessibilityRole="button"
      accessibilityLabel={`Llamada con ${name}, ${mmss(elapsed)}. Tocá para abrir`}
      style={[styles.bar, { paddingTop: insets.top, backgroundColor: reconnecting ? '#B26B00' : SCOUT_COLOR }]}
    >
      <View style={styles.row}>
        <View style={[styles.dot, speaking && styles.dotOn]} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.time}>{mmss(elapsed)}</Text>
        <Text style={styles.right} numberOfLines={1}>
          {right}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%', zIndex: 100 },
  row: { height: CALL_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotOn: { backgroundColor: '#fff' },
  name: { color: '#fff', fontSize: font.body, fontWeight: '700', maxWidth: 140 },
  time: { color: '#fff', fontSize: font.small, fontVariant: ['tabular-nums'] },
  right: { flex: 1, textAlign: 'right', color: '#fff', fontSize: font.small, opacity: 0.9 },
});
