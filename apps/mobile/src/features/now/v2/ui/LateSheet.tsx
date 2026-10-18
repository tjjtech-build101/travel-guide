// "Voy tarde": hoja de abajo (Modal de RN) con 3 acciones grandes.
// Avisar al grupo (report_late) · Mover el bloque 15 min (move_block, con deshacer) · Llevarme (Cómo llego).
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../../../../ui/Text';
import { GroupIcon, PlanIcon, RouteIcon } from '../../../../ui/icons';
import { colors, font, radius, space } from '../../../../ui/theme';
import { HERO_BUTTON } from './HeroState';

const SHIFT_MIN = 15;

type Props = {
  visible: boolean;
  blockTitle: string;
  /** Minutos de atraso estimados (≤ 0: todavía llegás justo). */
  lateByMin: number;
  onNotify: () => void;
  onShift: (min: number) => void;
  onDirections: () => void;
  onClose: () => void;
  notifying?: boolean;
  notified?: boolean;
};

export function LateSheet({ visible, blockTitle, lateByMin, onNotify, onShift, onDirections, onClose, notifying, notified }: Props) {
  const insets = useSafeAreaInsets();
  const title = lateByMin > 0 ? `Vas ${lateByMin} min tarde` : 'Vas justo';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar" />
        <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            a {blockTitle}
          </Text>
          <View style={styles.actions}>
            <Action
              icon={<GroupIcon color={notified ? colors.success : colors.primaryText} />}
              label={notified ? 'Grupo avisado' : 'Avisar al grupo'}
              primary
              busy={notifying}
              done={notified}
              onPress={onNotify}
            />
            <Action
              icon={<PlanIcon color={colors.text} />}
              label={`Pasarlo ${SHIFT_MIN} min más tarde`}
              onPress={() => onShift(SHIFT_MIN)}
            />
            <Action icon={<RouteIcon color={colors.text} />} label="Cómo llego" onPress={onDirections} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Action({
  icon,
  label,
  onPress,
  primary,
  busy,
  done,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
  done?: boolean;
}) {
  const disabled = !!busy || !!done;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.action,
        primary ? styles.actionPrimary : styles.actionSecondary,
        done && styles.actionDone,
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.primaryText : colors.primary} /> : icon}
      <Text style={[styles.actionText, primary && !done && styles.actionTextPrimary]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(42,30,23,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.lg },
  title: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.body, color: colors.textMuted, marginTop: 2 },
  actions: { gap: space.sm, marginTop: space.lg },
  action: {
    minHeight: HERO_BUTTON + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  actionPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionSecondary: { backgroundColor: colors.surface, borderColor: colors.border },
  actionDone: { backgroundColor: colors.successBg, borderColor: colors.successBg },
  actionText: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  actionTextPrimary: { color: colors.primaryText },
  pressed: { opacity: 0.85 },
});
