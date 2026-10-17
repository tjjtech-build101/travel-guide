// Tarjetas del Plan: bloque, "Ocupado" (privado ajeno), fantasma (propuesta add) y compacta (paralelo).
import type { BlockAlert, BlockStatus } from '@build101/shared';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AvatarStack, type AvatarPerson } from '../../../ui/Avatar';
import { Button } from '../../../ui/Button';
import { Text } from '../../../ui/Text';
import { colors, font, radius, space } from '../../../ui/theme';
import { useShouldGenerateTour } from '../../tours/useShouldGenerateTour';
import { ALERT_COLORS, ALERT_FALLBACK, STATUS_COLORS, STATUS_LABEL, TRANSFER_MODE_LABEL, TYPE_LABEL } from '../labels';
import { durationLabel, hhmm, timeLabel, type GhostBlock, type PlanBlock } from '../selectors';
import { AlertIcon, LockIcon, TypeIcon } from './TypeIcon';

const NEW_MS = 15_000;

function isFresh(b: PlanBlock): boolean {
  const t = Date.parse(b.created_at);
  return Number.isFinite(t) && Date.now() - t < NEW_MS;
}

export function StatusBadge({ status }: { status: BlockStatus }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.confirmed;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}

export function AlertChips({ alerts, max = 3 }: { alerts: BlockAlert[] | null; max?: number }) {
  if (!alerts?.length) return null;
  return (
    <View style={styles.alerts}>
      {alerts.slice(0, max).map((a, i) => {
        const c = ALERT_COLORS[a.kind] ?? ALERT_FALLBACK;
        return (
          <View key={i} style={[styles.alertChip, { backgroundColor: c.bg }]} accessibilityLabel={`Alerta: ${a.text}`}>
            <AlertIcon color={c.fg} />
            <Text style={[styles.alertText, { color: c.fg }]} numberOfLines={1}>
              {a.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function transferLabel(b: Pick<PlanBlock, 'transfer' | 'duration_min'>): string {
  if (!b.transfer) return '';
  const mode = TRANSFER_MODE_LABEL[b.transfer.mode] ?? b.transfer.mode;
  const dur = durationLabel(b.transfer.duration_min ?? b.duration_min);
  return dur ? `${mode} · ${dur}` : mode;
}

export function a11yTime(b: Pick<PlanBlock, 'start_time' | 'end_time' | 'time_flex'>): string {
  const s = hhmm(b.start_time);
  const e = hhmm(b.end_time);
  if (s && e) return `${s.replace(/^0/, '')} a ${e.replace(/^0/, '')}`;
  return timeLabel(b);
}

type CardProps = {
  block: PlanBlock;
  me: string;
  legColor: string;
  people: Map<string, AvatarPerson>;
  onPress?: (b: PlanBlock) => void;
  onLongPress?: (b: PlanBlock) => void;
  /** Bloque tipo "tour" sin tour_id todavía: ofrece armarlo (PRD 06/18). */
  onGenerateTour?: (b: PlanBlock) => void;
};

export const BlockCard = memo(function BlockCard({ block, me, legColor, people, onPress, onLongPress, onGenerateTour }: CardProps) {
  // Hooks SIEMPRE antes de cualquier return condicional (incluido el de masked, abajo).
  // "tour" ya es el tipo pensado para esto: siempre sí. Para el resto (activity, meal, lodging...),
  // lo decide should_generate_tour (OpenAI Decisions API) — un museo sí, un restaurante puntual no.
  const askAi = !!onGenerateTour && !block.masked && block.type !== 'tour';
  const aiDecision = useShouldGenerateTour(askAi ? block : null);

  if (block.masked) return <BusyCard block={block} legColor={legColor} />;
  const s = hhmm(block.start_time);
  const e = hhmm(block.end_time);
  const participants = block.participant_ids.map((id) => people.get(id) ?? { id, display_name: null, avatar_url: null });
  const privateMine = block.is_private && (block.participant_ids.includes(me) || block.created_by === me);
  const transfer = transferLabel(block);
  const label = `${TYPE_LABEL[block.type]} ${block.title}, ${a11yTime(block)}, ${STATUS_LABEL[block.status].toLowerCase()}${
    privateMine ? ', privado' : ''
  }`;
  const showGenerateTour = !!onGenerateTour && (block.type === 'tour' || aiDecision.data?.should_tour === true);
  return (
    <Animated.View entering={isFresh(block) ? FadeInDown.duration(200) : undefined}>
      <Pressable
        onPress={() => onPress?.(block)}
        onLongPress={() => onLongPress?.(block)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={[styles.stripe, { backgroundColor: legColor }]} />
        <View style={styles.timeCol}>
          {s ? (
            <>
              <Text style={styles.time}>{s}</Text>
              {e ? <Text style={styles.timeEnd}>{e}</Text> : null}
            </>
          ) : (
            <Text style={styles.flex}>{timeLabel(block)}</Text>
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <TypeIcon type={block.type} color={colors.textMuted} size={18} />
            <Text style={styles.title} numberOfLines={2}>
              {block.title}
            </Text>
            {privateMine ? <LockIcon color={colors.textMuted} /> : null}
          </View>
          {block.place_name ? (
            <Text style={styles.meta} numberOfLines={1}>
              {block.place_name}
            </Text>
          ) : null}
          {transfer ? <Text style={styles.meta}>{transfer}</Text> : null}
          <AlertChips alerts={block.alerts} />
          {showGenerateTour ? (
            <Button
              label={block.tour_id ? 'Generar de nuevo' : 'Generar tour'}
              variant="secondary"
              style={styles.genTourBtn}
              onPress={() => onGenerateTour!(block)}
            />
          ) : null}
          <View style={styles.footer}>
            <StatusBadge status={block.status} />
            {participants.length ? <AvatarStack people={participants} size={24} max={3} /> : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

export function BusyCard({ block, legColor, compact }: { block: PlanBlock; legColor: string; compact?: boolean }) {
  return (
    <View
      style={[styles.card, styles.busy, compact && styles.compact]}
      accessible
      accessibilityLabel={`Ocupado, ${a11yTime(block)}`}
    >
      <View style={[styles.stripe, { backgroundColor: legColor, opacity: 0.35 }]} />
      {!compact ? (
        <View style={styles.timeCol}>
          <Text style={[styles.time, styles.busyText]}>{hhmm(block.start_time) || timeLabel(block)}</Text>
          {block.end_time ? <Text style={styles.timeEnd}>{hhmm(block.end_time)}</Text> : null}
        </View>
      ) : null}
      <View style={styles.body}>
        {compact ? <Text style={styles.compactTime}>{timeLabel(block)}</Text> : null}
        <Text style={[styles.title, styles.busyText]}>Ocupado</Text>
      </View>
    </View>
  );
}

export function GhostCard({ ghost, onPress }: { ghost: GhostBlock; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Propuesta: agregar ${ghost.title}, ${timeLabel(ghost)}`}
      style={({ pressed }) => [styles.card, styles.ghost, pressed && styles.pressed]}
    >
      <View style={styles.timeCol}>
        <Text style={[styles.time, styles.ghostText]}>{hhmm(ghost.start_time) || timeLabel(ghost)}</Text>
        {ghost.end_time ? <Text style={[styles.timeEnd, styles.ghostText]}>{hhmm(ghost.end_time)}</Text> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <TypeIcon type={ghost.type} color={colors.ghost} size={18} />
          <Text style={[styles.title, styles.ghostText]} numberOfLines={2}>
            {ghost.title}
          </Text>
        </View>
        {ghost.place_name ? <Text style={[styles.meta, styles.ghostText]}>{ghost.place_name}</Text> : null}
        <Text style={styles.ghostTag}>Propuesta pendiente · tocá para ver</Text>
      </View>
    </Pressable>
  );
}

/** Tarjeta compacta para la vista en paralelo (2 columnas). */
export function CompactBlockCard({
  block,
  legColor,
  onPress,
}: {
  block: PlanBlock;
  legColor: string;
  onPress?: (b: PlanBlock) => void;
}) {
  if (block.masked) return <BusyCard block={block} legColor={legColor} compact />;
  return (
    <Pressable
      onPress={() => onPress?.(block)}
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABEL[block.type]} ${block.title}, ${a11yTime(block)}`}
      style={({ pressed }) => [styles.card, styles.compact, pressed && styles.pressed]}
    >
      <View style={[styles.stripe, { backgroundColor: legColor }]} />
      <View style={styles.body}>
        <Text style={styles.compactTime}>{timeLabel(block)}</Text>
        <Text style={styles.compactTitle} numberOfLines={3}>
          {block.title}
        </Text>
        {block.alerts?.length ? <AlertChips alerts={block.alerts} max={1} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.sm,
    overflow: 'hidden',
    minHeight: 64,
  },
  pressed: { opacity: 0.75 },
  stripe: { width: 4 },
  timeCol: { width: 64, paddingVertical: space.md, paddingLeft: space.md },
  time: { fontSize: font.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  timeEnd: { fontSize: font.tiny, color: colors.textMuted, fontVariant: ['tabular-nums'], marginTop: 2 },
  flex: { fontSize: font.tiny, fontWeight: '600', color: colors.textMuted },
  body: { flex: 1, paddingVertical: space.md, paddingRight: space.md, paddingLeft: space.sm, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  title: { flexShrink: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  meta: { fontSize: font.tiny + 1, color: colors.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  genTourBtn: { alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 0, marginTop: space.xs },
  badge: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: font.tiny - 1, fontWeight: '700' },
  alerts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: 2 },
  alertChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  alertText: { fontSize: font.tiny - 1, fontWeight: '700', flexShrink: 1 },
  busy: { backgroundColor: colors.surfaceMuted, borderStyle: 'dashed' },
  busyText: { color: colors.masked, fontStyle: 'italic' },
  ghost: { backgroundColor: 'transparent', borderStyle: 'dashed', borderWidth: 1.5, borderColor: colors.ghost },
  ghostText: { color: colors.ghost },
  ghostTag: { fontSize: font.tiny - 1, fontWeight: '700', color: colors.ghost, marginTop: 2 },
  compact: { minHeight: 56 },
  compactTime: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  compactTitle: { fontSize: font.small, fontWeight: '600', color: colors.text },
});
