// Dock de Ahora v2 (≤ 22 % de la pantalla): "Hablar con Scout" con el avatar adentro y el estado de la
// llamada, y abajo 3 íconos chicos (Tour acá · Cámara · Cómo llego). Durante un tour en vivo, `tiles`
// reemplaza los íconos (como ScoutDock, que sigue en features/now/components.tsx para LiveTourView).
import { SCOUT } from '@build101/shared';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ScoutAvatar, SCOUT_STATE_LABEL } from '../../../../ui/ScoutAvatar';
import { Text } from '../../../../ui/Text';
import { CameraIcon, FlagIcon, RouteIcon } from '../../../../ui/icons';
import { colors, font, radius, space } from '../../../../ui/theme';
import type { ScoutState } from '../../../../voice/useScout';

type Props = {
  scoutState: ScoutState;
  onTalk: () => void;
  onNearbyTour: () => void;
  tourAvailable: boolean;
  onCamera: () => void;
  /** null = no hay a dónde ir: se oculta el ícono. */
  onDirections: (() => void) | null;
  /** Reemplaza los íconos (tour en vivo). */
  tiles?: ReactNode;
};

export function DockV2({ scoutState, onTalk, onNearbyTour, tourAvailable, onCamera, onDirections, tiles }: Props) {
  const inCall = scoutState !== 'idle' && scoutState !== 'error';
  const label = inCall ? `Cortar con ${SCOUT.name}` : `Hablar con ${SCOUT.name}`;
  const status = SCOUT_STATE_LABEL[scoutState];
  return (
    <View style={styles.dock}>
      <Pressable
        onPress={onTalk}
        accessibilityRole="button"
        accessibilityLabel={status ? `${label}. ${status}` : label}
        style={({ pressed }) => [styles.talk, inCall && styles.talkActive, pressed && styles.pressed]}
      >
        <ScoutAvatar size={40} state={scoutState} />
        <View style={styles.talkText}>
          <Text style={styles.talkLabel} numberOfLines={1}>
            {label}
          </Text>
          {status ? (
            <Text style={styles.talkStatus} numberOfLines={1}>
              {status}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {tiles ? (
        <View style={styles.row}>{tiles}</View>
      ) : (
        <View style={styles.row}>
          <DockIcon label="Tour acá" soon={!tourAvailable} onPress={onNearbyTour} icon={<FlagIcon color={colors.text} size={22} />} />
          <DockIcon label="Cámara" onPress={onCamera} icon={<CameraIcon color={colors.text} size={22} />} />
          {onDirections ? (
            <DockIcon label="Cómo llego" onPress={onDirections} icon={<RouteIcon color={colors.text} size={22} />} />
          ) : null}
        </View>
      )}
    </View>
  );
}

export function DockIcon({ label, icon, onPress, soon }: { label: string; icon: ReactNode; onPress: () => void; soon?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={soon ? `${label}, muy pronto` : label}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      {icon}
      <Text style={styles.iconLabel} numberOfLines={1}>
        {label}
      </Text>
      {soon ? <Text style={styles.soon}>pronto</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: space.sm,
    gap: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  pressed: { opacity: 0.8 },
  talk: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.scout,
  },
  talkActive: { backgroundColor: colors.text },
  talkText: { flex: 1 },
  talkLabel: { color: colors.scoutText, fontSize: font.h3, fontWeight: '700' },
  talkStatus: { color: colors.scoutText, fontSize: font.tiny, fontWeight: '600', opacity: 0.85 },
  row: { flexDirection: 'row', gap: space.sm },
  icon: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2 },
  iconLabel: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  soon: { position: 'absolute', top: 2, right: 8, fontSize: 10, fontWeight: '800', color: colors.primary },
});
