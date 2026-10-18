// Piezas compartidas de Ahora y del tour en vivo (PRD 19 / PRD 07): Cómo llego, el dock de la vista de tour
// (ScoutDock + Tile) y los tamaños del modo exterior. La vista Ahora v2 usa features/now/v2/ui.
import { SCOUT } from '@build101/shared';
import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../ui/Text';
import { CameraIcon, FlagIcon, RouteIcon } from '../../ui/icons';
import { ScoutAvatar } from '../../ui/ScoutAvatar';
import { colors, font, radius, space } from '../../ui/theme';
import type { ScoutState } from '../../voice/useScout';

export const OUTDOOR = { title: 24, body: 17, button: 56 } as const;

/** Abre Apple Maps (iOS) o Google Maps con indicaciones a pie. */
export function openDirections(b: { lat: number; lng: number; place_name?: string | null }) {
  const dest = `${b.lat},${b.lng}`;
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${dest}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`;
  void Linking.openURL(url).catch(() => {});
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
  tiles,
}: {
  scoutState: ScoutState;
  onTalk: () => void;
  onNearbyTour: () => void;
  tourAvailable: boolean;
  onCamera: () => void;
  onDirections: (() => void) | null;
  directionsLabel?: string;
  /** Reemplaza las acciones de abajo (PRD 07: durante un tour, cámara / saltar parada / terminar). */
  tiles?: ReactNode;
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
      {tiles ? <View style={styles.tiles}>{tiles}</View> : null}
      <View style={[styles.tiles, tiles ? styles.hidden : null]}>
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

export function Tile({ label, icon, onPress, soon, hint }: { label: string; icon: ReactNode; onPress: () => void; soon?: boolean; hint?: string }) {
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
  hidden: { display: 'none' },
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
