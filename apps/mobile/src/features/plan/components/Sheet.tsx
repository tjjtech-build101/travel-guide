// Estructura común de los sheets del Plan (formSheet nativo): encabezado con acciones + contenido scrolleable.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../../../ui/Text';
import { colors, font, MIN_TOUCH, space } from '../../../ui/theme';

export function closeSheet() {
  if (router.canGoBack()) router.back();
}

export function SheetHeader({
  title,
  left = { label: 'Cerrar', onPress: closeSheet },
  right,
}: {
  title: string;
  left?: { label: string; onPress: () => void } | null;
  right?: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean } | null;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {left ? (
          <Pressable onPress={left.onPress} accessibilityRole="button" hitSlop={8} style={styles.btn}>
            <Text style={styles.leftText}>{left.label}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.side, { alignItems: 'flex-end' }]}>
        {right ? (
          <Pressable
            onPress={right.onPress}
            disabled={right.disabled || right.loading}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!right.disabled, busy: !!right.loading }}
            hitSlop={8}
            style={styles.btn}
          >
            {right.loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.rightText, right.disabled && { opacity: 0.4 }]}>{right.label}</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Raíz del sheet: un único ScrollView con el header pegado arriba (stickyHeaderIndices).
 * En el formSheet nativo de iOS, un header hermano del ScrollView no se dibuja en la primera presentación.
 */
export function SheetRoot({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl * 2 }}
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
}

export function SheetBody({ children }: { children: ReactNode }) {
  return <View style={styles.content}>{children}</View>;
}

export function SheetMessage({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.messageSub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingTop: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  side: { width: 96 },
  btn: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: font.body, fontWeight: '700', color: colors.text },
  leftText: { fontSize: font.body, color: colors.primary },
  rightText: { fontSize: font.body, color: colors.primary, fontWeight: '700' },
  content: { padding: space.lg, gap: space.lg },
  message: { padding: space.xl, alignItems: 'center', gap: space.sm },
  messageTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text, textAlign: 'center' },
  messageSub: { fontSize: font.small, color: colors.textMuted, textAlign: 'center' },
});
