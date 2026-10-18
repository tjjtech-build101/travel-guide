// La única noticia de Ahora (offline > lluvia > propuestas): una fila compacta, un color por tipo.
import { SCOUT } from '@build101/shared';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { CloseIcon, OfflineIcon, RainIcon, SparkIcon } from '../../../../ui/icons';
import { Text } from '../../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../../ui/theme';
import { formatMinutes } from '../../selectors';
import type { NoticeKind } from '../types';

type Props = { notice: NoticeKind; onPress: () => void; onDismiss?: () => void };

const STYLE: Record<NoticeKind['kind'], { bg: string; fg: string; Icon: ComponentType<{ color: ColorValue; size?: number }> }> = {
  offline: { bg: colors.warningBg, fg: colors.warningText, Icon: OfflineIcon },
  rain: { bg: colors.khakiLight, fg: colors.khakiText, Icon: RainIcon },
  proposals: { bg: colors.successBg, fg: colors.ghost, Icon: SparkIcon },
};

/** "15:00" → "15"; "15:30" queda igual. */
function hourLabel(at: string): string {
  return at.endsWith(':00') ? String(Number(at.slice(0, -3))) : at;
}

/** Texto de la noticia: [principal, acción]. */
export function noticeText(n: NoticeKind): [string, string | null] {
  switch (n.kind) {
    case 'offline':
      return [`Sin conexión · datos de ${n.minutesAgo < 1 ? 'recién' : `hace ${formatMinutes(n.minutesAgo)}`}`, null];
    case 'rain':
      return n.plan.hasRainVariant
        ? [`Va a llover a las ${hourLabel(n.plan.at)}`, '¿Paso al plan de lluvia?']
        : [`Va a llover a las ${hourLabel(n.plan.at)} · ${n.plan.blockTitle}`, null];
    case 'proposals':
      return [`${SCOUT.name} propone ${n.count} ${n.count === 1 ? 'cambio' : 'cambios'}`, 'Ver'];
  }
}

export function InlineNotice({ notice, onPress, onDismiss }: Props) {
  const s = STYLE[notice.kind];
  const [main, action] = noticeText(notice);
  return (
    <View style={[styles.row, { backgroundColor: s.bg }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole={notice.kind === 'offline' ? 'alert' : 'button'}
        accessibilityLabel={action ? `${main}. ${action}` : main}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <s.Icon color={s.fg} size={20} />
        <Text style={[styles.text, { color: s.fg }]} numberOfLines={1}>
          {main}
          {action ? ' · ' : null}
          {action ? <Text style={styles.action}>{action}</Text> : null}
        </Text>
      </Pressable>
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Cerrar aviso" style={styles.close} hitSlop={4}>
          <CloseIcon color={s.fg} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, minHeight: MIN_TOUCH },
  main: { flex: 1, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  pressed: { opacity: 0.7 },
  text: { flex: 1, fontSize: font.small, fontWeight: '600' },
  action: { fontWeight: '800', textDecorationLine: 'underline' },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
