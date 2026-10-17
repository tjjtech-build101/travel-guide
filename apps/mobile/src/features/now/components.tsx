// Piezas de la vista Ahora (PRD 19). Modo exterior: títulos ≥ 22 pt, cuerpo ≥ 17 pt, botones ≥ 56 pt.
import { SCOUT } from '@build101/shared';
import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AvatarStack, type AvatarPerson } from '../../ui/Avatar';
import { Text } from '../../ui/Text';
import { CameraIcon, FlagIcon, RouteIcon } from '../../ui/icons';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { colors, font, radius, space } from '../../ui/theme';
import type { ScoutState } from '../../voice/useScout';
import { AlertChips } from '../plan/components/BlockCard';
import { ChevronIcon, TypeIcon } from '../plan/components/TypeIcon';
import { hhmm, timeLabel, type PlanBlock } from '../plan/selectors';
import { clock, formatMinutes, leaveInMin, leaveLabel, leaveUrgency, type NowCurrent, type NowNext } from './selectors';
import type { Eta } from './useEta';

export const OUTDOOR = { title: 24, body: 17, button: 56 } as const;

const URGENCY_COLORS = {
  ok: { bg: colors.successBg, fg: colors.primary },
  soon: { bg: '#F7E9C6', fg: colors.bronzeText },
  late: { bg: colors.dangerBg, fg: colors.danger },
} as const;

/** Abre Apple Maps (iOS) o Google Maps con indicaciones a pie. */
export function openDirections(b: { lat: number; lng: number; place_name?: string | null }) {
  const dest = `${b.lat},${b.lng}`;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${dest}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`;
  void Linking.openURL(url).catch(() => {});
}

function Label({ children, color }: { children: string; color: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

function people(b: PlanBlock, members: Map<string, AvatarPerson>): AvatarPerson[] {
  return b.participant_ids.map((id) => members.get(id) ?? { id, display_name: null, avatar_url: null });
}

type CardActions = { onPress: (b: PlanBlock) => void; onLongPress: (b: PlanBlock) => void };

export function CurrentCard({
  current,
  members,
  onPress,
  onLongPress,
}: { current: NowCurrent; members: Map<string, AvatarPerson> } & CardActions) {
  const b = current.block;
  return (
    <Pressable
      onPress={() => onPress(b)}
      onLongPress={() => onLongPress(b)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Ahora: ${b.title}, quedan ${formatMinutes(current.remainingMin)}`}
      accessibilityHint="Mantené apretado para hablar de esto"
      style={({ pressed }) => [styles.card, styles.cardNow, pressed && styles.pressed]}
    >
      <View style={styles.cardHead}>
        <Label color="#1E6B34">AHORA</Label>
        <Text style={styles.time}>{timeLabel(b)}</Text>
      </View>
      <View style={styles.titleRow}>
        <TypeIcon type={b.type} color={colors.text} size={24} />
        <Text style={styles.title} numberOfLines={2}>
          {b.title}
        </Text>
      </View>
      {b.place_name ? <Text style={styles.place}>{b.place_name}</Text> : null}
      <View style={styles.progress} accessibilityElementsHidden>
        <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, current.progress)) * 100)}%` }]} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.remaining}>
          Quedan {formatMinutes(current.remainingMin)} · hasta {hhmm(b.end_time) || clock(current.end)}
        </Text>
        <AvatarStack people={people(b, members)} size={30} max={4} />
      </View>
      <AlertChips alerts={b.alerts} />
    </Pressable>
  );
}

export function NextCard({
  next,
  nowMin,
  eta,
  locationOff,
  farAway,
  onEnableLocation,
  members,
  onPress,
  onLongPress,
}: {
  next: NowNext;
  nowMin: number;
  eta: Eta | null;
  locationOff: boolean;
  farAway?: boolean;
  onEnableLocation: () => void;
  members: Map<string, AvatarPerson>;
} & CardActions) {
  const b = next.block;
  const leaveIn = eta ? leaveInMin(next.start, nowMin, eta.minutes) : null;
  const urgency = leaveIn === null ? null : leaveUrgency(leaveIn);
  const uc = urgency ? URGENCY_COLORS[urgency] : null;
  const hasPlace = typeof b.lat === 'number' && typeof b.lng === 'number';
  return (
    <Pressable
      onPress={() => onPress(b)}
      onLongPress={() => onLongPress(b)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Después: ${b.title} a las ${hhmm(b.start_time)}${leaveIn !== null ? `. ${leaveLabel(leaveIn)}` : ''}`}
      accessibilityHint="Mantené apretado para hablar de esto"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardHead}>
        <Label color={colors.primary}>DESPUÉS</Label>
        <Text style={styles.time}>
          {hhmm(b.start_time)} · en {formatMinutes(next.inMin)}
        </Text>
      </View>
      <View style={styles.titleRow}>
        <TypeIcon type={b.type} color={colors.text} size={24} />
        <Text style={styles.title} numberOfLines={2}>
          {b.title}
        </Text>
      </View>
      {b.place_name ? <Text style={styles.place}>{b.place_name}</Text> : null}
      {hasPlace ? (
        leaveIn !== null && uc && eta ? (
          <View style={[styles.leave, { backgroundColor: uc.bg }]} accessibilityRole="alert">
            <Text style={[styles.leaveText, { color: uc.fg }]}>{leaveLabel(leaveIn, nowMin)}</Text>
            <Text style={[styles.leaveSub, { color: uc.fg }]}>
              {eta.mode === 'walk' ? 'A pie' : 'En transporte'} · {formatMinutes(eta.minutes)}
              {eta.estimated ? ' aprox.' : ''}
            </Text>
          </View>
        ) : farAway ? (
          <Text style={styles.far}>Estás lejos de este lugar: no puedo calcular cuándo salir.</Text>
        ) : locationOff ? (
          <Pressable onPress={onEnableLocation} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>Activar ubicación para calcular cuándo salir</Text>
          </Pressable>
        ) : null
      ) : null}
      <View style={styles.footer}>
        <View />
        <AvatarStack people={people(b, members)} size={30} max={4} />
      </View>
      <AlertChips alerts={b.alerts} />
    </Pressable>
  );
}


export function LaterList({ blocks, onPress, onLongPress }: { blocks: PlanBlock[] } & CardActions) {
  const [open, setOpen] = useState(false);
  if (!blocks.length) return null;
  return (
    <View style={styles.later}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.laterHead}
      >
        <Text style={styles.sectionTitle}>Más tarde hoy ({blocks.length})</Text>
        <ChevronIcon color={colors.textMuted} open={open} />
      </Pressable>
      {open
        ? blocks.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => onPress(b)}
              onLongPress={() => onLongPress(b)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.laterRow, pressed && styles.pressed]}
            >
              <Text style={styles.laterTime}>{timeLabel(b)}</Text>
              <Text style={styles.laterTitle} numberOfLines={1}>
                {b.title}
              </Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

export function Suggestions({
  ideas,
  onIdea,
  onNearbyTour,
  tourAvailable,
}: {
  ideas: PlanBlock[];
  onIdea: (b: PlanBlock) => void;
  onNearbyTour: () => void;
  tourAvailable: boolean;
}) {
  return (
    <View style={styles.card}>
      <Label color={colors.ghost}>TENÉS TIEMPO LIBRE</Label>
      <Text style={styles.sugTitle}>¿Qué hacemos?</Text>
      {ideas.map((b) => (
        <Pressable
          key={b.id}
          onPress={() => onIdea(b)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sugRow, pressed && styles.pressed]}
        >
          <TypeIcon type={b.type} color={colors.text} size={22} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sugText} numberOfLines={1}>
              {b.title}
            </Text>
            <Text style={styles.sugSub}>Idea del banco{b.place_name ? ` · ${b.place_name}` : ''}</Text>
          </View>
        </Pressable>
      ))}
      <Pressable onPress={onNearbyTour} accessibilityRole="button" style={({ pressed }) => [styles.sugRow, pressed && styles.pressed]}>
        <FlagIcon color={colors.primary} size={22} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.sugText, { color: colors.primary }]}>Tour acá, ahora</Text>
          <Text style={styles.sugSub}>
            {tourAvailable ? `${SCOUT.name} te arma un recorrido desde donde estás` : 'Muy pronto'}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

export function StateCard({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={[styles.place, { marginTop: space.xs }]}>{body}</Text> : null}
      {children ? <View style={{ marginTop: space.md, gap: space.sm }}>{children}</View> : null}
    </View>
  );
}

// ───────── Zona de acciones (abajo, ≤ 40 % de la pantalla): todo lo del Scout a un toque.

export function ScoutDock({
  scoutState,
  onTalk,
  onNearbyTour,
  tourAvailable,
  onCamera,
  onDirections,
  directionsLabel,
}: {
  scoutState: ScoutState;
  onTalk: () => void;
  onNearbyTour: () => void;
  tourAvailable: boolean;
  onCamera: () => void;
  onDirections: (() => void) | null;
  directionsLabel?: string;
}) {
  const inCall = scoutState !== 'idle' && scoutState !== 'error';
  return (
    <View style={styles.dock}>
      <View style={styles.dockMain}>
        <ScoutAvatar size={64} state={scoutState} />
        <Pressable
          onPress={onTalk}
          accessibilityRole="button"
          accessibilityLabel={inCall ? `Cortar con ${SCOUT.name}` : `Hablar con ${SCOUT.name}`}
          style={({ pressed }) => [styles.talk, inCall && styles.talkActive, pressed && styles.pressed]}
        >
          <Text style={styles.talkText} numberOfLines={1}>
            {inCall ? `Cortar con ${SCOUT.name}` : `Hablar con ${SCOUT.name}`}
          </Text>
        </Pressable>
      </View>
      <View style={styles.tiles}>
        <Tile label="Tour acá, ahora" soon={!tourAvailable} onPress={onNearbyTour} icon={<FlagIcon color={colors.text} />} />
        <Tile label="Cámara" onPress={onCamera} icon={<CameraIcon color={colors.text} />} />
        {onDirections ? (
          <Tile
            label="Cómo llego"
            hint={directionsLabel}
            onPress={onDirections}
            icon={<RouteIcon color={colors.text} />}
          />
        ) : null}
      </View>
    </View>
  );
}

function Tile({ label, icon, onPress, soon, hint }: { label: string; icon: ReactNode; onPress: () => void; soon?: boolean; hint?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={soon ? `${label}, muy pronto` : label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      {icon}
      <Text style={styles.tileText} numberOfLines={1}>
        {label}
      </Text>
      {soon ? <Text style={styles.soon}>pronto</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.xs,
  },
  cardNow: { borderColor: colors.primary, borderWidth: 2 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1 },
  time: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  title: { flex: 1, fontSize: OUTDOOR.title, fontWeight: '800', color: colors.text },
  place: { fontSize: OUTDOOR.body, color: colors.textMuted },
  progress: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, marginTop: space.sm, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  remaining: { fontSize: OUTDOOR.body, fontWeight: '700', color: colors.text },
  leave: { marginTop: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  leaveText: { fontSize: font.h2, fontWeight: '800' },
  leaveSub: { fontSize: font.small, fontWeight: '600', marginTop: 2 },
  far: { fontSize: font.small, color: colors.textMuted, marginTop: space.sm },
  link: { fontSize: font.small, color: colors.primary, fontWeight: '700', marginTop: space.sm },
  later: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg },
  laterHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  laterRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  laterTime: { width: 96, fontSize: font.small, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  laterTitle: { flex: 1, fontSize: OUTDOOR.body, color: colors.text },
  sugTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, marginBottom: space.xs },
  sugRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sugText: { fontSize: OUTDOOR.body, fontWeight: '700', color: colors.text },
  sugSub: { fontSize: font.tiny, color: colors.textMuted },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.md,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  dockMain: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  talk: {
    flex: 1,
    minHeight: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.scout,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  talkActive: { backgroundColor: colors.text },
  talkText: { color: colors.scoutText, fontSize: font.h3, fontWeight: '800' },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    minHeight: OUTDOOR.button + 8,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: space.xs,
  },
  tileText: { fontSize: font.tiny, fontWeight: '700', color: colors.text },
  soon: {
    position: 'absolute',
    top: 4,
    right: 6,
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
});
