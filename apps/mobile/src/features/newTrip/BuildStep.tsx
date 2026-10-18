// Paso 4 · ¿Cómo lo armamos? Con la forma elegida: "Armémoslo juntos" (menú por tramo, mode menu) o
// "Armalo vos" (días armados directo, mode auto).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDateRange } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, font, radius, space } from '../../ui/theme';
import { startPlan } from './flow';
import { ErrorBox, StepShell } from './parts';
import { ShapeTimeline } from './ShapesStep';
import { chosenShape, useNewTripStore } from './store';

export function BuildStep() {
  const shape = useNewTripStore(chosenShape);
  const back = useNewTripStore((s) => s.back);
  const loading = useNewTripStore((s) => s.loading);
  const planError = useNewTripStore((s) => s.error.plan);
  // El modo del último toque (spinner y "Reintentar" correctos).
  const [busyMode, setBusyMode] = useState<'menu' | 'auto' | null>(null);

  const go = (mode: 'menu' | 'auto') => {
    setBusyMode(mode);
    void startPlan(mode);
  };

  return (
    <StepShell
      step={4}
      title="¿Cómo lo armamos?"
      onBack={back}
      footer={
        shape ? (
          <>
            <Button
              label="Armémoslo juntos"
              onPress={() => go('menu')}
              loading={loading === 'plan' && busyMode === 'menu'}
              disabled={loading === 'plan'}
              accessibilityHint="Te muestro un menú por ciudad y el grupo elige qué entra"
            />
            <Button
              label="Armalo vos"
              variant="secondary"
              onPress={() => go('auto')}
              loading={loading === 'plan' && busyMode === 'auto'}
              disabled={loading === 'plan'}
              accessibilityHint="Armo los días directo con lo que me contaste"
            />
          </>
        ) : (
          <Button label="Elegir una forma" onPress={back} />
        )
      }
    >
      {shape ? (
        <>
          <View style={styles.card}>
            <Text style={styles.title}>{shape.title || shape.label}</Text>
            <Text style={styles.range}>{formatDateRange(shape.start_date, shape.end_date)}</Text>
            <ShapeTimeline shape={shape} />
          </View>

          <View style={styles.option}>
            <Text style={styles.optionTitle}>Armémoslo juntos</Text>
            <Text style={styles.optionText}>
              Te muestro un menú por ciudad: imperdibles, joyas, comida y escapadas. Cada uno marca lo que le copa y después armo los días con eso.
            </Text>
          </View>
          <View style={styles.option}>
            <Text style={styles.optionTitle}>Armalo vos</Text>
            <Text style={styles.optionText}>Armo los días directo con lo que me contaste. Después cambiás lo que quieras.</Text>
          </View>

          {planError ? (
            <ErrorBox message={`${planError} No se armó nada todavía.`} onRetry={() => go(busyMode ?? 'menu')} retrying={loading === 'plan'} />
          ) : null}
        </>
      ) : (
        <Text style={styles.muted}>Volvé y elegí una de las formas del viaje.</Text>
      )}
    </StepShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, padding: space.md, gap: space.sm },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  range: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  option: { gap: 2 },
  optionTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  optionText: { fontSize: font.small, color: colors.textMuted, lineHeight: 21 },
  muted: { fontSize: font.small, color: colors.textMuted },
});
