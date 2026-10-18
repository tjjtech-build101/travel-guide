// Crear bloque (sheet): paso 1 tipo, paso 2 formulario. Con día → add_block; sin día → add_idea.
import { BLOCK_TYPES, type BlockType } from '@build101/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BlockForm, emptyForm, formToFields, type BlockFormState, type FormErrors } from '../../../features/plan/components/BlockForm';
import { closeSheet, SheetBody, SheetHeader, SheetRoot, SheetMessage } from '../../../features/plan/components/Sheet';
import { TypeIcon } from '../../../features/plan/components/TypeIcon';
import { TYPE_LABEL } from '../../../features/plan/labels';
import { toolErrorMessage, useAddBlock } from '../../../features/plan/mutations';
import { useMe, usePermissions, usePlanOverview } from '../../../features/plan/queries';
import type { PlanLeg } from '../../../features/plan/selectors';
import { Button } from '../../../ui/Button';
import { ErrorNotice } from '../../../ui/ErrorNotice';
import { Text } from '../../../ui/Text';
import { colors, font, radius, space } from '../../../ui/theme';

const TYPE_HINT: Record<BlockType, string> = {
  activity: 'Museo, paseo, show',
  meal: 'Desayuno, almuerzo, cena',
  tour: 'Recorrido guiado',
  transfer: 'Bus, ferry, vuelo',
  lodging: 'Hotel, depto',
  free: 'Tiempo libre',
  meetup: 'Nos juntamos en…',
};

export default function NewBlockSheet() {
  const params = useLocalSearchParams<{ tripId: string; legId?: string; dayId?: string; idea?: string }>();
  const { tripId } = params;
  const overview = usePlanOverview(tripId);
  const perms = usePermissions(tripId);
  const me = useMe();
  const add = useAddBlock(tripId);
  const isIdea = params.idea === '1';

  const legs = overview.data?.legs ?? [];
  const editable = legs.filter((l) => perms.canEditLeg(l.id));
  const leg: PlanLeg | undefined = editable.find((l) => l.id === params.legId) ?? editable[0];

  const [state, setState] = useState<BlockFormState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  if (overview.isPending) {
    return (
      <SheetRoot>
        <SheetHeader title="Agregar" />
        <SheetMessage title="Cargando…" />
      </SheetRoot>
    );
  }
  if (overview.isError && !overview.data) {
    // Falló la carga del viaje: no es un tema de permisos.
    return (
      <SheetRoot>
        <SheetHeader title="Agregar" />
        <SheetBody>
          <ErrorNotice
            error={overview.error}
            doing="cargar el viaje"
            onRetry={() => void overview.refetch()}
            retrying={overview.isFetching}
          />
        </SheetBody>
      </SheetRoot>
    );
  }
  if (!leg) {
    return (
      <SheetRoot>
        <SheetHeader title="Agregar" />
        <SheetMessage title="No podés agregar acá" subtitle="Solo los viajeros de un tramo pueden sumar cosas al plan." />
      </SheetRoot>
    );
  }

  const start = (type: BlockType) => {
    const dayId = isIdea ? null : (leg.days.find((d) => d.id === params.dayId)?.id ?? leg.days[0]?.id ?? null);
    setState(emptyForm({ type, leg, dayId }));
  };

  // Idea: directo al formulario.
  if (!state && isIdea) {
    start('activity');
    return null;
  }

  if (!state) {
    return (
      <SheetRoot>
        <SheetHeader title="¿Qué agregamos?" />
        <SheetBody>
          <View style={styles.grid}>
            {BLOCK_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => start(t)}
                accessibilityRole="button"
                accessibilityLabel={TYPE_LABEL[t]}
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
              >
                <TypeIcon type={t} color={colors.primary} size={28} />
                <Text style={styles.tileTitle}>{TYPE_LABEL[t]}</Text>
                <Text style={styles.tileHint}>{TYPE_HINT[t]}</Text>
              </Pressable>
            ))}
          </View>
        </SheetBody>
      </SheetRoot>
    );
  }

  const save = async () => {
    const { fields, errors: errs } = formToFields(state, me);
    setErrors(errs);
    if (!fields) return;
    const target = legs.find((l) => l.id === state.legId) ?? leg;
    try {
      if (state.dayId === null) {
        const { start_time: _s, end_time: _e, ...rest } = fields;
        await add.mutateAsync({ kind: 'idea', input: { ...rest, trip_id: tripId, leg_id: target.id } });
      } else {
        await add.mutateAsync({ kind: 'block', input: { ...fields, trip_id: tripId, leg_id: target.id, day_id: state.dayId } });
      }
      closeSheet();
    } catch (e) {
      setErrors({ form: toolErrorMessage(e, state.dayId === null ? 'guardar la idea' : 'agregar el bloque') });
    }
  };

  return (
    <SheetRoot>
      <SheetHeader
        title={state.dayId === null ? 'Nueva idea' : `Nuevo: ${TYPE_LABEL[state.type].toLowerCase()}`}
        left={isIdea ? undefined : { label: 'Atrás', onPress: () => setState(null) }}
        right={{ label: 'Guardar', onPress: save, loading: add.isPending }}
      />
      <SheetBody>
        <BlockForm
          state={state}
          onChange={setState}
          errors={errors}
          legs={editable}
          members={overview.data?.members ?? []}
          me={me}
          mode="create"
          canEditLeg={perms.canEditLeg}
        />
        <Button label="Guardar" onPress={save} loading={add.isPending} />
      </SheetBody>
    </SheetRoot>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 96,
    padding: space.md,
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  tileTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  tileHint: { fontSize: font.tiny, color: colors.textMuted },
});
