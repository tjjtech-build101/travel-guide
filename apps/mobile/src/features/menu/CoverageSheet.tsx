// Hoja "Imperdibles que quedaron afuera" (PRD 31): por tramo, el motivo y dos salidas: sumarlo a ideas o verlo en el menú.
import type { PlanCoverage } from '@build101/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../ui/Text';
import { colors, font, MIN_TOUCH, radius, space } from '../../ui/theme';
import { SheetBody, SheetHeader, SheetMessage, SheetRoot } from '../plan/components/Sheet';
import { toolErrorMessage, useAddBlock } from '../plan/mutations';
import { coverageTotals, ideaFromItem } from './model';
import { useLegOptions } from './queries';

type Props = { visible: boolean; onClose: () => void; tripId: string; coverage: PlanCoverage[] };

export function CoverageSheet({ visible, onClose, tripId, coverage }: Props) {
  const options = useLegOptions(tripId);
  const add = useAddBlock(tripId);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const totals = coverageTotals(coverage);
  const byOption = useMemo(() => new Map((options.data ?? []).map((o) => [o.id, o])), [options.data]);
  const byItem = useMemo(() => new Map((options.data ?? []).map((o) => [`${o.leg_id}|${o.item.id}`, o])), [options.data]);

  const goMenu = (legId: string) => {
    onClose();
    router.push({ pathname: '/trip/[tripId]/menu', params: { tripId, legId } });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SheetRoot>
        <SheetHeader title={`${totals.mustCovered}/${totals.mustTotal} imperdibles`} left={{ label: 'Cerrar', onPress: onClose }} />
        {totals.missing === 0 ? (
          <SheetMessage title="Entraron todos los imperdibles" subtitle="Cada uno quedó en algún día del plan." />
        ) : (
          <SheetBody>
            <Text style={styles.intro}>Estos quedaron afuera. Podés guardarlos en ideas para agendarlos cuando quieras.</Text>
            {coverage
              .filter((c) => c.missing.length)
              .map((c) => (
                <View key={c.leg_id} style={styles.leg}>
                  <Text style={styles.legTitle} accessibilityRole="header">
                    {c.city} · {c.must_covered}/{c.must_total}
                  </Text>
                  {c.missing.map((m) => {
                    const opt = (m.option_id && byOption.get(m.option_id)) || byItem.get(`${c.leg_id}|${m.item_id}`) || null;
                    const key = `${c.leg_id}|${m.item_id}`;
                    const busy = add.isPending && add.variables?.kind === 'idea' && add.variables.input.title === (opt?.item.name ?? m.name);
                    return (
                      <View key={key} style={styles.item}>
                        <Text style={styles.name}>{m.name}</Text>
                        <Text style={styles.reason}>{m.reason}</Text>
                        <View style={styles.actions}>
                          <Pressable
                            disabled={added[key] || add.isPending}
                            onPress={() =>
                              add.mutate(
                                { kind: 'idea', input: ideaFromItem(tripId, c.leg_id, m.name, opt?.item ?? null) },
                                {
                                  onSuccess: () => setAdded((s) => ({ ...s, [key]: true })),
                                  onError: (e) => Alert.alert('No se pudo sumar a ideas', toolErrorMessage(e)),
                                },
                              )
                            }
                            accessibilityRole="button"
                            style={[styles.btn, styles.btnMain, (added[key] || add.isPending) && { opacity: 0.6 }]}
                          >
                            <Text style={styles.btnMainText}>{added[key] ? 'En ideas ✓' : busy ? 'Sumando…' : 'Sumar a ideas'}</Text>
                          </Pressable>
                          <Pressable onPress={() => goMenu(c.leg_id)} accessibilityRole="button" style={styles.btn}>
                            <Text style={styles.btnText}>Ver en el menú</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
          </SheetBody>
        )}
      </SheetRoot>
    </Modal>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: font.small, color: colors.textMuted },
  leg: { gap: space.sm },
  legTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  item: { backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md, gap: space.xs },
  name: { fontSize: font.body, fontWeight: '700', color: colors.text },
  reason: { fontSize: font.small, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  btn: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
  btnMain: { backgroundColor: colors.primary },
  btnMainText: { fontSize: font.small, fontWeight: '700', color: colors.primaryText },
  btnText: { fontSize: font.small, fontWeight: '700', color: colors.primary },
});
