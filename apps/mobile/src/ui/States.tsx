// Estados obligatorios de toda pantalla: vacío, cargando y error. Nunca pantalla vacía.
// Vacío y error muestran al Scout en una pose (mapa / pensando); `pose={null}` lo oculta.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { describeError } from '../lib/errors';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { ScoutRig, type ScoutPose } from '../scout/ScoutRig';
import { Text } from './Text';
import { colors, font, radius, space } from './theme';

export function Skeleton({ width = '100%', height = 16, style }: { width?: DimensionValue; height?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.skeleton, opacity }, style]} />;
}

export function SkeletonCard() {
  return (
    <View style={styles.card} accessibilityLabel="Cargando">
      <Skeleton width="70%" height={22} />
      <Skeleton width="45%" height={16} style={{ marginTop: space.md }} />
      <Skeleton width="55%" height={16} style={{ marginTop: space.sm }} />
      <View style={{ flexDirection: 'row', marginTop: space.lg, gap: space.xs }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={32} height={32} style={{ borderRadius: 16 }} />
        ))}
      </View>
    </View>
  );
}

function ScoutPoseImage({ pose }: { pose: ScoutPose | null }) {
  if (!pose) return null;
  // Error: el Scout "piensa" (cejas y boca de hmm); vacío: la pose tranquila que pidan.
  return <ScoutRig width={120} pose={pose} mode={pose === 'think' ? 'thinking' : 'idle'} style={styles.scout} />;
}

/**
 * Pantalla de error. `message` = qué no se pudo ("No pudimos cargar tus viajes"); `error` = la causa (se explica
 * abajo con lib/errors: sin conexión, sin créditos, sesión vencida…). Sin `error` queda como antes.
 */
export function ErrorState({
  message,
  detail,
  error,
  doing,
  onRetry,
  pose,
}: {
  message: string;
  detail?: string;
  error?: unknown;
  /** Qué estaba haciendo ("cargar el plan"), para el texto de la causa. */
  doing?: string;
  onRetry?: () => void;
  pose?: ScoutPose | null;
}) {
  if (error !== undefined && error !== null) {
    const v = describeError(error, { doing });
    return (
      <View style={styles.center}>
        <ScoutPoseImage pose={pose === undefined ? v.pose : pose} />
        <Text style={styles.title}>{message}</Text>
        <ErrorNotice error={error} view={v} onRetry={onRetry} style={styles.notice} />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <ScoutPoseImage pose={pose === undefined ? 'think' : pose} />
      <Text style={styles.title}>{message}</Text>
      {__DEV__ && detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {onRetry ? <Button label="Reintentar" onPress={onRetry} style={{ marginTop: space.lg, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  children,
  pose = 'map',
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  pose?: ScoutPose | null;
}) {
  return (
    <View style={styles.center}>
      <ScoutPoseImage pose={pose} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children ? <View style={{ marginTop: space.lg, alignSelf: 'stretch', gap: space.sm }}>{children}</View> : null}
    </View>
  );
}

export function LoadingList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  scout: { marginBottom: space.md },
  notice: { alignSelf: 'stretch', marginTop: space.lg },
  title: { fontSize: font.h3, fontWeight: '600', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: font.body, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
  detail: { fontSize: font.tiny, color: colors.danger, textAlign: 'center', marginTop: space.sm, fontFamily: 'Menlo' },
});
