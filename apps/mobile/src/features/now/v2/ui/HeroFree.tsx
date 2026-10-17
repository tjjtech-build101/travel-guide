// Protagonista "libre": cuánto tiempo hay, hasta 3 ideas para el hueco y dos acciones.
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Skeleton } from '../../../../ui/States';
import { Text } from '../../../../ui/Text';
import { BookIcon, MapIcon, PlanIcon } from '../../../../ui/icons';
import { colors, font, radius, space } from '../../../../ui/theme';
import { formatMinutes } from '../../selectors';
import type { GapSuggestion } from '../types';
import { HeroActions, HeroCard, heroText, Kicker } from './HeroState';

export type AddState = 'adding' | 'added';

type Props = {
  /** null = sin nada más hoy ("la tarde libre"). */
  gapMin: number | null;
  /** Hora local del próximo bloque ("18:00"). */
  untilLabel?: string | null;
  suggestions: GapSuggestion[];
  loading?: boolean;
  /** Estado de "Agregar" por id de sugerencia. */
  addState?: Record<string, AddState | undefined>;
  onAdd: (s: GapSuggestion) => void;
  onSuggestionPress?: (s: GapSuggestion) => void;
  onPlanDay: () => void;
  planning?: boolean;
  onNearbyTour: () => void;
};

export function freeTitle(gapMin: number | null): string {
  return gapMin == null ? 'Tenés la tarde libre' : `Tenés ${formatMinutes(gapMin)} libres`;
}

const SOURCE_LABEL: Record<GapSuggestion['source'], string> = { idea: 'Idea guardada', place: 'Cerca', event: 'Evento de hoy' };

function SourceIcon({ source }: { source: GapSuggestion['source'] }) {
  const c = colors.khakiText;
  if (source === 'idea') return <BookIcon color={c} size={20} />;
  if (source === 'event') return <PlanIcon color={c} size={20} />;
  return <MapIcon color={c} size={20} />;
}

function Row({
  s,
  state,
  onAdd,
  onPress,
}: {
  s: GapSuggestion;
  state?: AddState;
  onAdd: () => void;
  onPress?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={`${SOURCE_LABEL[s.source]}: ${s.title}. ${s.why}`}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <SourceIcon source={s.source} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {s.title}
          </Text>
          <Text style={styles.rowWhy} numberOfLines={1}>
            {s.why}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onAdd}
        disabled={!!state}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={state === 'added' ? `${s.title} agregado` : `Agregar ${s.title} al plan`}
        accessibilityState={{ disabled: !!state, busy: state === 'adding' }}
        style={({ pressed }) => [styles.add, state === 'added' && styles.added, pressed && styles.pressed]}
      >
        {state === 'adding' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.addText, state === 'added' && styles.addedText]}>{state === 'added' ? 'Listo' : 'Agregar'}</Text>
        )}
      </Pressable>
    </View>
  );
}

function SkeletonRows() {
  return (
    <View accessibilityLabel="Buscando ideas" style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={36} height={36} style={{ borderRadius: 18 }} />
          <View style={styles.rowText}>
            <Skeleton width="65%" height={16} />
            <Skeleton width="45%" height={12} style={{ marginTop: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function HeroFree({
  gapMin,
  untilLabel,
  suggestions,
  loading,
  addState,
  onAdd,
  onSuggestionPress,
  onPlanDay,
  planning,
  onNearbyTour,
}: Props) {
  const items = suggestions.slice(0, 3);
  return (
    <HeroCard>
      <Kicker>LIBRE</Kicker>
      <Text style={heroText.title} accessibilityRole="header">
        {freeTitle(gapMin)}
      </Text>
      {untilLabel ? <Text style={heroText.meta}>Hasta las {untilLabel}</Text> : null}
      {loading ? (
        <SkeletonRows />
      ) : items.length ? (
        <View style={styles.list}>
          {items.map((s) => (
            <Row
              key={s.id}
              s={s}
              state={addState?.[s.id]}
              onAdd={() => onAdd(s)}
              onPress={onSuggestionPress ? () => onSuggestionPress(s) : undefined}
            />
          ))}
        </View>
      ) : null}
      <HeroActions
        primary={{ label: 'Armame la tarde', onPress: onPlanDay, loading: planning, hint: 'El Scout te propone un plan' }}
        secondary={{ label: 'Tour acá, ahora', onPress: onNearbyTour, hint: 'Un tour corto por donde estás' }}
      />
    </HeroCard>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  list: { marginTop: space.xs },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.khakiLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  rowWhy: { fontSize: font.tiny, color: colors.textMuted, marginTop: 1 },
  add: {
    minWidth: 84,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  added: { borderColor: colors.successBg, backgroundColor: colors.successBg },
  addText: { fontSize: font.small, fontWeight: '700', color: colors.primary },
  addedText: { color: colors.success },
});
