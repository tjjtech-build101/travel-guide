// "Traer del banco": elegir una idea del tramo y agendarla en el día (move_block).
import { useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { cap } from '../../../features/plan/components/BlockForm';
import { closeSheet, SheetBody, SheetHeader, SheetRoot, SheetMessage } from '../../../features/plan/components/Sheet';
import { TypeIcon } from '../../../features/plan/components/TypeIcon';
import { TYPE_LABEL } from '../../../features/plan/labels';
import { useMoveBlock } from '../../../features/plan/mutations';
import { usePlanBlocks, usePlanOverview } from '../../../features/plan/queries';
import { compareBlocks, timeLabel } from '../../../features/plan/selectors';
import { formatDay } from '../../../lib/format';
import { Text } from '../../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../../ui/theme';
import { openNewBlock } from '../../../features/plan/nav';
import { Button } from '../../../ui/Button';
import { ErrorNotice } from '../../../ui/ErrorNotice';

export default function BankSheet() {
  const { tripId, legId, dayId } = useLocalSearchParams<{ tripId: string; legId: string; dayId: string }>();
  const blocks = usePlanBlocks(tripId);
  const overview = usePlanOverview(tripId);
  const move = useMoveBlock(tripId);
  const leg = overview.data?.legs.find((l) => l.id === legId);
  const day = leg?.days.find((d) => d.id === dayId);
  const ideas = (blocks.data ?? []).filter((b) => b.leg_id === legId && !b.day_id && !b.masked).sort(compareBlocks);
  const dayName = day ? cap(formatDay(day.date)) : 'este día';

  return (
    <SheetRoot>
      <SheetHeader title={`Traer al ${dayName}`} />
      {blocks.isPending ? (
        <SheetMessage title="Cargando…" />
      ) : blocks.isError && !blocks.data ? (
        // Falló la carga: no decir que el banco está vacío.
        <SheetBody>
          <ErrorNotice
            error={blocks.error}
            doing="cargar las ideas"
            onRetry={() => void blocks.refetch()}
            retrying={blocks.isFetching}
          />
        </SheetBody>
      ) : !ideas.length ? (
        <SheetBody>
          <SheetMessage title="El banco de ideas está vacío" subtitle={`Anotá ideas sin día en ${leg?.city ?? 'este tramo'} y después las agendás.`} />
          <Button
            label="Nueva idea"
            variant="secondary"
            onPress={() => {
              closeSheet();
              openNewBlock(tripId, { legId, idea: true });
            }}
          />
        </SheetBody>
      ) : (
        <SheetBody>
          <Text style={styles.hint}>Tocá una idea para sumarla al {dayName}.</Text>
          <View style={{ gap: space.sm }}>
            {ideas.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={`Agendar ${b.title} el ${dayName}`}
                onPress={() => {
                  move.mutate({ blockId: b.id, dayId, toLabel: `al ${dayName}` });
                  closeSheet();
                }}
              >
                <TypeIcon type={b.type} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{b.title}</Text>
                  <Text style={styles.meta}>
                    {TYPE_LABEL[b.type]} · {timeLabel(b)}
                    {b.place_name ? ` · ${b.place_name}` : ''}
                  </Text>
                </View>
                <Text style={styles.cta}>Agendar</Text>
              </Pressable>
            ))}
          </View>
        </SheetBody>
      )}
    </SheetRoot>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.small, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH + 12,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  title: { fontSize: font.body, fontWeight: '600', color: colors.text },
  meta: { fontSize: font.tiny, color: colors.textMuted },
  cta: { fontSize: font.small, fontWeight: '700', color: colors.primary },
});
