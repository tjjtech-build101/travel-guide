// Resumen al cortar (PRD 05): duración, acciones (con Deshacer) y el texto del job voice_summary (en vivo por Realtime).
import type { VoiceSummaryResult } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAgentJob } from '../../features/jobs/queries';
import { undoAction } from '../../features/plan/mutations';
import { Button } from '../../ui/Button';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { Skeleton } from '../../ui/States';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { useVoiceStore } from '../store';
import { mmss } from './CallBar';

export function CallSummary() {
  const summary = useVoiceStore((s) => s.summary);
  const status = useVoiceStore((s) => s.status);
  const dismiss = useVoiceStore((s) => s.dismissSummary);
  const job = useAgentJob(summary?.jobId ?? undefined);
  const visible = status === 'summary' && !!summary;
  const result = job.data?.result as VoiceSummaryResult | null | undefined;
  const failed = !summary?.jobId || job.data?.status === 'failed' || job.isError;
  const loading = !failed && job.data?.status !== 'done';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={dismiss}>
      <View style={styles.root}>
        <View style={styles.head}>
          <Text style={styles.title}>Resumen de la llamada</Text>
          <Text style={styles.duration}>{mmss(summary?.durationS ?? 0)}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {loading ? (
            <View style={{ gap: space.sm }}>
              <Skeleton height={18} />
              <Skeleton height={18} width="80%" />
              <Skeleton height={18} width="60%" />
            </View>
          ) : failed ? (
            // La causa: el cierre en la API (summary.error), el job (fila con error_code) o la lectura del job.
            <ErrorNotice
              error={summary?.error ?? (job.data?.status === 'failed' ? job.data : job.error) ?? null}
              doing="armar el resumen de la llamada"
              compact
            />
          ) : (
            <Text style={styles.summary}>{result?.summary}</Text>
          )}

          <Text style={styles.section}>Lo que se hizo</Text>
          {result?.actions?.length ? (
            result.actions.map((a) => <ActionRow key={a.feed_id} text={a.summary} undoToken={a.undo_token} tripId={summary?.tripId ?? null} />)
          ) : loading ? (
            <Skeleton height={44} />
          ) : (
            <Text style={styles.muted}>No hubo cambios en el plan.</Text>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <Button label="Listo" onPress={dismiss} />
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({ text, undoToken, tripId }: { text: string; undoToken: string | null; tripId: string | null }) {
  const qc = useQueryClient();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  return (
    <View style={styles.action}>
      <Text style={styles.actionText}>{text}</Text>
      {undoToken && tripId ? (
        <Pressable
          disabled={state !== 'idle'}
          onPress={async () => {
            setState('busy');
            await undoAction(qc, tripId, undoToken);
            setState('done');
          }}
          style={styles.undo}
          accessibilityRole="button"
          accessibilityLabel="Deshacer"
        >
          {state === 'busy' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.undoText}>{state === 'done' ? 'Deshecho' : 'Deshacer'}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', padding: space.lg },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  duration: { fontSize: font.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  body: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.xl },
  summary: { fontSize: font.body, lineHeight: 24, color: colors.text },
  muted: { fontSize: font.body, color: colors.textMuted },
  section: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginTop: space.md, textTransform: 'uppercase' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: space.md,
    minHeight: 52,
  },
  actionText: { flex: 1, fontSize: font.small, color: colors.text, paddingVertical: space.sm },
  undo: { minHeight: MIN_TOUCH, minWidth: 96, alignItems: 'center', justifyContent: 'center' },
  undoText: { color: colors.primary, fontWeight: '800', fontSize: font.body },
  footer: { padding: space.lg },
});
