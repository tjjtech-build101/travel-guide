// Protagonista "estado" de Ahora v2 (antes / después / sin tramos / sin día) y las piezas comunes de
// todas las tarjetas Hero*: tarjeta, kicker y fila de acciones (máximo 2 botones: primario + secundario).
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '../../../../ui/Button';
import { Text } from '../../../../ui/Text';
import { colors, font, radius, space } from '../../../../ui/theme';

export const HERO_BUTTON = 56;

// ───────────────────────── Piezas comunes

/** Tarjeta grande y limpia. Si recibe onPress, toda la tarjeta abre el detalle. */
export function HeroCard({
  children,
  onPress,
  accessibilityLabel,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  if (!onPress) {
    return <View style={[styles.card, style]}>{children}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Abre el detalle"
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

export function Kicker({ children, color = colors.primary }: { children: string; color?: string }) {
  return <Text style={[styles.kicker, { color }]}>{children}</Text>;
}

export type HeroAction = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; hint?: string };

/** Primario arriba, secundario abajo (una mano: los dos a lo ancho). */
export function HeroActions({ primary, secondary }: { primary: HeroAction; secondary?: HeroAction | null }) {
  return (
    <View style={styles.actions}>
      <Button
        label={primary.label}
        onPress={primary.onPress}
        loading={primary.loading}
        disabled={primary.disabled}
        accessibilityHint={primary.hint}
        style={styles.btn}
      />
      {secondary ? (
        <Button
          label={secondary.label}
          variant="secondary"
          onPress={secondary.onPress}
          loading={secondary.loading}
          disabled={secondary.disabled}
          accessibilityHint={secondary.hint}
          style={styles.btn}
        />
      ) : null}
    </View>
  );
}

export const heroText = StyleSheet.create({
  title: { fontSize: font.h2, lineHeight: 28, fontWeight: '700', color: colors.text },
  place: { fontSize: font.body, color: colors.textMuted },
  meta: { fontSize: font.small, fontWeight: '600', color: colors.textMuted },
});

// ───────────────────────── HeroState

export type HeroStateKind = 'before' | 'after' | 'noLegs' | 'noDay';

type Props = {
  state: HeroStateKind;
  /** Solo before: días hasta el arranque. */
  daysUntil?: number;
  /** before: simula el reloj al día 1 a las 10:00. */
  onPreviewDay1?: () => void;
  /** before / after / noDay: abre el plan. */
  onOpenPlan?: () => void;
  /** noLegs: crear el primer tramo. */
  onAddLeg?: () => void;
};

function copy(state: HeroStateKind, daysUntil?: number): { kicker: string; title: string; body: string } {
  switch (state) {
    case 'before': {
      const d = daysUntil ?? 0;
      const when = d <= 0 ? 'Arranca hoy' : d === 1 ? 'Arranca mañana' : `Faltan ${d} días`;
      return { kicker: 'ANTES DEL VIAJE', title: when, body: 'Mirá cómo se va a ver tu primer día.' };
    }
    case 'after':
      return { kicker: 'VIAJE TERMINADO', title: '¡Qué viaje!', body: 'Ya volviste. El plan queda guardado para cuando quieras.' };
    case 'noLegs':
      return { kicker: 'SIN DESTINOS', title: 'Todavía no hay destinos', body: 'Sumá una ciudad y armamos el día.' };
    case 'noDay':
      return { kicker: 'HOY', title: 'Hoy no hay nada en el plan', body: 'Día libre. Si querés, armamos algo.' };
  }
}

export function HeroState({ state, daysUntil, onPreviewDay1, onOpenPlan, onAddLeg }: Props) {
  const c = copy(state, daysUntil);
  let primary: HeroAction | null = null;
  let secondary: HeroAction | null = null;
  if (state === 'before') {
    if (onPreviewDay1) primary = { label: 'Ver mi día 1', onPress: onPreviewDay1, hint: 'Muestra Ahora como si fuera el día 1' };
    if (onOpenPlan) secondary = { label: 'Ver el plan', onPress: onOpenPlan };
  } else if (state === 'noLegs') {
    if (onAddLeg) primary = { label: 'Agregar destino', onPress: onAddLeg };
  } else if (onOpenPlan) {
    primary = { label: 'Ver el plan', onPress: onOpenPlan };
  }
  // Sin primario, el secundario sube.
  if (!primary && secondary) {
    primary = secondary;
    secondary = null;
  }
  return (
    <HeroCard>
      <Kicker>{c.kicker}</Kicker>
      <Text style={heroText.title} accessibilityRole="header">
        {c.title}
      </Text>
      <Text style={heroText.place}>{c.body}</Text>
      {primary ? <HeroActions primary={primary} secondary={secondary} /> : null}
    </HeroCard>
  );
}

// ───────────────────────── PreviewChip

/** "Vista previa del día 1 · Volver a hoy": aparece mientras se simula el día 1. */
export function PreviewChip({ onExit, label = 'Vista previa del día 1' }: { onExit: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onExit}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Volver a hoy`}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      hitSlop={8}
    >
      <Text style={styles.chipText} numberOfLines={1}>
        {label} · <Text style={styles.chipLink}>Volver a hoy</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.sm,
  },
  pressed: { opacity: 0.85 },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1.2 },
  actions: { gap: space.sm, marginTop: space.md },
  btn: { minHeight: HERO_BUTTON, borderRadius: radius.lg },
  chip: {
    alignSelf: 'center',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
  },
  chipText: { fontSize: font.tiny, fontWeight: '700', color: colors.primaryText },
  chipLink: { fontSize: font.tiny, fontWeight: '800', color: colors.khaki, textDecorationLine: 'underline' },
});
