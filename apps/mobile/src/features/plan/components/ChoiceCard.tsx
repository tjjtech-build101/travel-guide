// Lugar del día "elegí 1 de N" (PRD 31): una sola tarjeta con las opciones del mismo choice_group.
// La primera (menor sort_order) va marcada "Recomendada". "Elegir" → choose_option; las otras pasan a ideas.
import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';
import { TYPE_LABEL } from '../labels';
import { timeLabel, type PlanBlock } from '../selectors';
import { SparkIcon, TypeIcon } from './TypeIcon';

type Props = {
  blocks: PlanBlock[];
  legColor: string;
  canChoose: boolean;
  /** Id del bloque que se está eligiendo (spinner). */
  choosing: string | null;
  onChoose: (b: PlanBlock) => void;
  onPress: (b: PlanBlock) => void;
};

/** "Por qué" de la opción: lo que la API dejó en description (o notes). */
function whyOf(b: PlanBlock): string | null {
  return b.description?.trim() || b.notes?.trim() || null;
}

export const ChoiceCard = memo(function ChoiceCard({ blocks, legColor, canChoose, choosing, onChoose, onPress }: Props) {
  const first = blocks[0];
  return (
    <View style={[styles.card, { borderLeftColor: legColor }]} accessibilityLabel={`Elegí una de ${blocks.length} opciones, ${timeLabel(first)}`}>
      <View style={styles.head}>
        <SparkIcon color={colors.primary} />
        <Text style={styles.title}>Elegí una</Text>
        <Text style={styles.time}>{timeLabel(first)}</Text>
      </View>
      {blocks.map((b, i) => {
        const why = whyOf(b);
        return (
          <View key={b.id} style={[styles.option, i > 0 && styles.optionSep]}>
            <Pressable
              style={styles.optionBody}
              onPress={() => onPress(b)}
              accessibilityRole="button"
              accessibilityLabel={`${TYPE_LABEL[b.type]} ${b.title}${i === 0 ? ', recomendada' : ''}`}
            >
              <View style={styles.row}>
                <TypeIcon type={b.type} color={colors.textMuted} size={18} />
                <Text style={styles.optTitle} numberOfLines={2}>
                  {b.title}
                </Text>
                {i === 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Recomendada</Text>
                  </View>
                ) : null}
              </View>
              {b.place_name && b.place_name !== b.title ? (
                <Text style={styles.place} numberOfLines={1}>
                  {b.place_name}
                </Text>
              ) : null}
              {why ? (
                <Text style={styles.why} numberOfLines={3}>
                  {why}
                </Text>
              ) : null}
            </Pressable>
            {canChoose ? (
              <Pressable
                onPress={() => onChoose(b)}
                disabled={!!choosing}
                accessibilityRole="button"
                accessibilityLabel={`Elegir ${b.title}`}
                style={({ pressed }) => [styles.choose, i === 0 && styles.chooseMain, pressed && { opacity: 0.8 }, !!choosing && choosing !== b.id && { opacity: 0.5 }]}
              >
                {choosing === b.id ? (
                  <ActivityIndicator color={i === 0 ? colors.primaryText : colors.primary} />
                ) : (
                  <Text style={[styles.chooseText, i === 0 && { color: colors.primaryText }]}>Elegir</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  title: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  time: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  optionSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionBody: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  optTitle: { flexShrink: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  badge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.successBg },
  badgeText: { fontSize: font.tiny, fontWeight: '800', color: colors.success },
  place: { fontSize: font.small, color: colors.textMuted },
  why: { fontSize: font.small, color: colors.text },
  choose: {
    minHeight: MIN_TOUCH,
    minWidth: 84,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooseMain: { backgroundColor: colors.primary },
  chooseText: { fontSize: font.small, fontWeight: '700', color: colors.primary },
});
