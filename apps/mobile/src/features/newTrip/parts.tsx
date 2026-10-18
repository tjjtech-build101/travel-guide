// Piezas comunes de las fases de "Nuevo viaje": marco con atrás + pie fijo y el Scout que conduce cada paso,
// fila de fechas, aviso de error con reintento y el ícono de modo de traslado.
import type { TransferMode } from '@build101/shared';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { formatDay } from '../../lib/format';
import type { ScoutMode, ScoutPose } from '../../scout/ScoutRig';
import { ErrorNotice } from '../../ui/ErrorNotice';
import { ScoutSays } from '../../ui/ScoutSays';
import { Button } from '../../ui/Button';
import { BackIcon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { Chip } from '../plan/components/Controls';

export function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DATES = Array.from({ length: 120 }, (_, i) => isoIn(i));

/** Lo que dice el Scout arriba de una fase (cambia con el estado: pensando mientras carga, etc.). */
export type StepScout = { text: string; pose?: ScoutPose; mode?: ScoutMode };

/** Marco de cada fase: paso N de 4, atrás, el Scout que conduce, contenido con scroll y pie fijo con las acciones. */
export function StepShell({
  step,
  title,
  onBack,
  scout,
  children,
  footer,
}: {
  step: number;
  title: string;
  onBack?: () => void;
  scout?: StepScout;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            {onBack ? (
              <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Atrás" hitSlop={8} style={styles.back}>
                <BackIcon color={colors.primary} size={22} />
              </Pressable>
            ) : null}
            <View style={styles.flex}>
              <Text style={styles.kicker} accessibilityLabel={`Paso ${step} de 4`}>
                PASO {step} DE 4
              </Text>
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
            </View>
          </View>
          {scout ? <ScoutSays text={scout.text} pose={scout.pose} mode={scout.mode} size={78} /> : null}
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Fila horizontal de fechas (hoy + 120 días). Tocar la elegida la saca. */
export function DateRow({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
      {DATES.map((d) => (
        <Chip key={d} label={formatDay(d)} selected={value === d} onPress={() => onChange(value === d ? null : d)} />
      ))}
    </ScrollView>
  );
}

/**
 * Error de una fase: la causa real (con `error`, vía ErrorNotice), Reintentar y siempre una salida ("Armalo igual").
 * Sin `error` (no hay falla, solo nada para mostrar) queda el aviso simple con `message`.
 */
export function ErrorBox({
  error,
  doing,
  message,
  onRetry,
  retrying,
  fallback,
}: {
  error?: unknown;
  /** Qué se estaba haciendo ("entender el viaje"), para el texto. */
  doing?: string;
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
  fallback?: { label: string; onPress: () => void; loading?: boolean };
}) {
  if (error != null) {
    return <ErrorNotice error={error} doing={doing} onRetry={onRetry} retrying={retrying} secondary={fallback} />;
  }
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <View style={styles.errorActions}>
        <Button label="Reintentar" variant="danger" onPress={onRetry} loading={retrying} style={styles.flex} />
        {fallback ? (
          <Button label={fallback.label} variant="secondary" onPress={fallback.onPress} loading={fallback.loading} style={styles.flex} />
        ) : null}
      </View>
    </View>
  );
}

/** Error chico debajo del contenido. Con `error`: la causa real (sin botones, salvo "Volver a entrar"). */
export function InlineError({ message, error, doing }: { message?: string; error?: unknown; doing?: string }) {
  if (error != null) return <ErrorNotice error={error} doing={doing} />;
  return (
    <Text style={styles.inlineError} accessibilityRole="alert">
      {message}
    </Text>
  );
}

/** Ícono chico por modo de traslado (react-native-svg, como ui/icons). */
export function ModeIcon({ mode, color = colors.textMuted, size = 16 }: { mode: TransferMode; color?: ColorValue; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  switch (mode) {
    case 'flight':
      return (
        <Svg {...common}>
          <Path d="M10.5 13.5L3 11l1.5-1.5 7 1L16 6a2 2 0 0 1 3 3l-4.5 4.5 1 7L14 22l-2.5-7.5" />
        </Svg>
      );
    case 'ferry':
      return (
        <Svg {...common}>
          <Path d="M3 17c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0M5 14l1-5h12l1 5M9 9V5h6v4" />
        </Svg>
      );
    case 'bus':
      return (
        <Svg {...common}>
          <Rect x={4} y={3} width={16} height={15} rx={3} />
          <Path d="M4 11h16M7 18v3M17 18v3" />
          <Circle cx={8} cy={14.5} r={0.5} />
          <Circle cx={16} cy={14.5} r={0.5} />
        </Svg>
      );
    case 'car':
      return (
        <Svg {...common}>
          <Path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v2M17 19v2" />
        </Svg>
      );
    case 'transit':
      return (
        <Svg {...common}>
          <Rect x={6} y={3} width={12} height={14} rx={3} />
          <Path d="M6 10h12M8 21l2-4M16 21l-2-4" />
        </Svg>
      );
    default:
      return (
        <Svg {...common}>
          <Circle cx={13} cy={4} r={1.5} />
          <Path d="M9 21l2-6 3 3v3M11 15l1-6-3 2-1 3M12 9l3 2 2 1" />
        </Svg>
      );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl, backgroundColor: colors.bg, flexGrow: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -space.md },
  kicker: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 1, color: colors.textMuted },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  dateRow: { gap: space.sm, paddingVertical: space.xs },
  error: { backgroundColor: colors.dangerBg, borderColor: colors.danger, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  errorText: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
  errorActions: { flexDirection: 'row', gap: space.sm },
  inlineError: { fontSize: font.small, color: colors.danger, fontWeight: '600' },
});
