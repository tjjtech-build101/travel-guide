// Tarjeta de error con la causa real: etiqueta de quién falló, título, qué pasó, qué hacer y botones.
// El texto lo arma lib/errors (describeError). En desarrollo muestra además el detalle técnico.
import { router } from 'expo-router';
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { describeError, type ErrorTone, type ErrorView } from '../lib/errors';
import { Button } from './Button';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export const TONE: Record<ErrorTone, { bg: string; border: string; accent: string }> = {
  danger: { bg: colors.dangerBg, border: '#F1C3BB', accent: colors.danger },
  warning: { bg: colors.khakiLight, border: colors.khaki, accent: colors.bronzeText },
  info: { bg: colors.surface, border: colors.border, accent: colors.primary },
};

type Props = {
  error: unknown;
  /** Qué estaba haciendo la persona ("armar el viaje"): se usa en el texto. */
  doing?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Botón extra (p. ej. "Armalo igual"). */
  secondary?: { label: string; onPress: () => void; loading?: boolean };
  /** Sin botones ni pista: una línea compacta (para listas o banners chicos). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Ya descripto (si lo armó quien llama). */
  view?: ErrorView;
};

export function ErrorNotice({ error, doing, onRetry, retrying, secondary, compact, style, view }: Props) {
  const v = view ?? describeError(error, { doing });
  const t = TONE[v.tone];
  const showRetry = !!onRetry && (v.retryable || v.code === 'unknown');
  return (
    <View
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }, compact && styles.compact, style]}
      accessibilityRole="alert"
      accessibilityLabel={[v.title, v.body, v.hint].filter(Boolean).join('. ')}
    >
      <View style={[styles.stripe, { backgroundColor: t.accent }]} />
      {v.tag ? (
        <View style={[styles.tag, { borderColor: t.accent }]}>
          <Text style={[styles.tagText, { color: t.accent }]}>{v.tag}</Text>
        </View>
      ) : null}
      <Text style={styles.title}>{v.title}</Text>
      <Text style={styles.body} numberOfLines={compact ? 2 : undefined}>
        {v.body}
      </Text>
      {!compact && v.hint ? <Text style={[styles.hint, { color: t.accent }]}>{v.hint}</Text> : null}
      {__DEV__ && v.detail ? (
        <Text style={styles.detail} numberOfLines={4} selectable>
          {v.code} · {v.detail}
        </Text>
      ) : null}
      {!compact && (showRetry || secondary || v.action) ? (
        <View style={styles.actions}>
          {showRetry ? <Button label="Reintentar" onPress={onRetry} loading={retrying} style={styles.flex} /> : null}
          {v.action === 'settings' ? (
            <Button label="Abrir Ajustes" variant="secondary" onPress={() => void Linking.openSettings()} style={styles.flex} />
          ) : null}
          {v.action === 'login' ? (
            <Button label="Volver a entrar" variant="secondary" onPress={() => router.replace('/login')} style={styles.flex} />
          ) : null}
          {secondary ? (
            <Button label={secondary.label} variant="secondary" onPress={secondary.onPress} loading={secondary.loading} style={styles.flex} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    paddingLeft: space.lg + 4,
    gap: space.xs,
    overflow: 'hidden',
  },
  compact: { padding: space.md, paddingLeft: space.md + 4 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  tag: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    marginBottom: 2,
  },
  tagText: { fontSize: font.tiny, fontWeight: '700' },
  title: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  body: { fontSize: font.body, color: colors.text, lineHeight: 23 },
  hint: { fontSize: font.small, fontWeight: '600', marginTop: 2 },
  detail: { fontSize: font.tiny, color: colors.textMuted, fontFamily: 'Menlo', marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  flex: { flexGrow: 1, flexBasis: 140 },
});
