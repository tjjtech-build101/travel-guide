// Detalle de bloque (sheet al 60 %, expandible): ver, editar (update_block), mover (move_block), borrar (remove_block).
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertChips, StatusBadge, transferLabel } from '../../../../features/plan/components/BlockCard';
import {
  BlockForm,
  cap,
  diffPatch,
  formFromBlock,
  formToFields,
  type BlockFormState,
  type FormErrors,
} from '../../../../features/plan/components/BlockForm';
import { Chip, FieldLabel, TimeField, normalizeTime } from '../../../../features/plan/components/Controls';
import { closeSheet, SheetBody, SheetHeader, SheetRoot, SheetMessage } from '../../../../features/plan/components/Sheet';
import { LockIcon, TypeIcon } from '../../../../features/plan/components/TypeIcon';
import { STATUS_LABEL, TYPE_LABEL } from '../../../../features/plan/labels';
import { confirm } from '../../../../features/plan/menu';
import { toolErrorMessage, useMoveBlock, useRemoveBlock, useUpdateBlock } from '../../../../features/plan/mutations';
import { useMe, usePermissions, usePlanBlocks, usePlanOverview } from '../../../../features/plan/queries';
import { durationLabel, timeLabel, type PlanBlock } from '../../../../features/plan/selectors';
import { formatDay } from '../../../../lib/format';
import { Avatar } from '../../../../ui/Avatar';
import { Button } from '../../../../ui/Button';
import { colors, font, radius, space } from '../../../../ui/theme';
import { BLOCK_STATUS } from '@build101/shared';

type Mode = 'view' | 'edit' | 'move';

export default function BlockSheet() {
  const { blockId, tripId, schedule, edit } = useLocalSearchParams<{ blockId: string; tripId: string; schedule?: string; edit?: string }>();
  const blocks = usePlanBlocks(tripId);
  const overview = usePlanOverview(tripId);
  const perms = usePermissions(tripId);
  const me = useMe();
  const block = blocks.data?.find((b) => b.id === blockId);
  const [mode, setMode] = useState<Mode>(schedule ? 'move' : edit ? 'edit' : 'view');

  if (blocks.isPending || overview.isPending) {
    return (
      <SheetRoot>
        <SheetHeader title="Bloque" />
        <SheetMessage title="Cargando…" />
      </SheetRoot>
    );
  }
  if (!block || !overview.data) {
    return (
      <SheetRoot>
        <SheetHeader title="Bloque" />
        <SheetMessage title="Este bloque ya no está" subtitle="Puede que alguien lo haya borrado o movido." />
      </SheetRoot>
    );
  }
  if (block.masked) {
    return (
      <SheetRoot>
        <SheetHeader title="Ocupado" />
        <SheetMessage title="Ocupado" subtitle={timeLabel(block)} />
      </SheetRoot>
    );
  }

  const canEdit = perms.canEditBlock(block);
  if (mode === 'edit' && canEdit) return <EditMode block={block} tripId={tripId} onDone={() => setMode('view')} />;
  if (mode === 'move' && canEdit) return <MoveMode block={block} tripId={tripId} onCancel={() => (schedule ? closeSheet() : setMode('view'))} />;
  return <ViewMode block={block} tripId={tripId} me={me} canEdit={canEdit} onEdit={() => setMode('edit')} onMove={() => setMode('move')} />;
}

// ───────────────────────── Ver

function ViewMode({
  block,
  tripId,
  me,
  canEdit,
  onEdit,
  onMove,
}: {
  block: PlanBlock;
  tripId: string;
  me: string;
  canEdit: boolean;
  onEdit: () => void;
  onMove: () => void;
}) {
  const overview = usePlanOverview(tripId);
  const update = useUpdateBlock(tripId);
  const move = useMoveBlock(tripId);
  const remove = useRemoveBlock(tripId);
  const members = overview.data?.members ?? [];
  const leg = overview.data?.legs.find((l) => l.id === block.leg_id);
  const day = leg?.days.find((d) => d.id === block.day_id);
  const transfer = transferLabel(block);
  const sources = (Array.isArray(block.sources) ? block.sources : []) as { url?: string; title?: string; source_url?: string }[];
  const privateMine = block.is_private && (block.participant_ids.includes(me) || block.created_by === me);

  return (
    <SheetRoot>
      <SheetHeader title={TYPE_LABEL[block.type]} right={canEdit ? { label: 'Editar', onPress: onEdit } : null} />
      <SheetBody>
        <View style={{ gap: space.sm }}>
          <View style={styles.kindRow}>
            <TypeIcon type={block.type} color={colors.textMuted} size={18} />
            <Text style={styles.kind}>{TYPE_LABEL[block.type]}</Text>
            <StatusBadge status={block.status} />
            {privateMine ? (
              <View style={styles.private}>
                <LockIcon color={colors.textMuted} size={12} />
                <Text style={styles.privateText}>Privado</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title}>{block.title}</Text>
          <Text style={styles.when}>
            {day ? `${cap(formatDay(day.date))} · ` : 'Banco de ideas · '}
            {timeLabel(block)}
            {block.duration_min ? ` (${durationLabel(block.duration_min)})` : ''}
          </Text>
          {leg ? <Text style={styles.meta}>{leg.city}</Text> : null}
        </View>

        {block.alerts?.length ? (
          <View style={{ gap: space.xs }}>
            <FieldLabel>Alertas</FieldLabel>
            <AlertChips alerts={block.alerts} max={10} />
          </View>
        ) : null}

        {block.place_name ? <Info label="Lugar" value={block.place_name} /> : null}
        {transfer ? (
          <Info
            label="Traslado"
            value={`${transfer}${block.transfer?.from || block.transfer?.to ? ` · ${block.transfer?.from ?? '?'} → ${block.transfer?.to ?? '?'}` : ''}`}
          />
        ) : null}
        {block.description ? <Info label="Descripción" value={block.description} /> : null}
        {block.notes ? <Info label="Notas" value={block.notes} /> : null}
        {block.cost_estimate != null ? (
          <Info label="Costo estimado" value={`${block.cost_estimate} ${block.cost_currency ?? ''}`.trim()} />
        ) : null}

        <View style={{ gap: space.sm }}>
          <FieldLabel>Quiénes van</FieldLabel>
          {block.participant_ids.length ? (
            block.participant_ids.map((id) => {
              const p = members.find((m) => m.id === id) ?? { id, display_name: null, avatar_url: null };
              return (
                <View key={id} style={styles.person}>
                  <Avatar person={p} size={28} />
                  <Text style={styles.personName}>{id === me ? `${p.display_name ?? 'Vos'} (vos)` : (p.display_name ?? 'Alguien')}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.meta}>Nadie todavía</Text>
          )}
        </View>

        {canEdit ? (
          <View style={{ gap: space.sm }}>
            <FieldLabel>Estado</FieldLabel>
            <View style={styles.wrap}>
              {BLOCK_STATUS.map((st) => (
                <Chip
                  key={st}
                  label={STATUS_LABEL[st]}
                  selected={block.status === st}
                  onPress={() => block.status !== st && update.mutate({ blockId: block.id, patch: { status: st } })}
                />
              ))}
            </View>
          </View>
        ) : null}

        {block.booking_url ? (
          <Button label="Abrir reserva" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(block.booking_url!)} />
        ) : null}
        {sources.length ? (
          <View style={{ gap: space.xs }}>
            <FieldLabel>Fuentes</FieldLabel>
            {sources.map((s, i) => {
              const url = s.url ?? s.source_url;
              return url ? (
                <Pressable key={i} onPress={() => WebBrowser.openBrowserAsync(url)} accessibilityRole="link">
                  <Text style={styles.link} numberOfLines={1}>
                    {s.title ?? url}
                  </Text>
                </Pressable>
              ) : null;
            })}
          </View>
        ) : null}

        {canEdit ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Button label={block.day_id ? 'Mover a otro día' : 'Agendar'} variant="secondary" onPress={onMove} />
            {block.day_id ? (
              <Button
                label="Mandar a ideas"
                variant="secondary"
                loading={move.isPending}
                onPress={() => {
                  move.mutate({ blockId: block.id, dayId: null, toLabel: 'al banco de ideas' });
                  closeSheet();
                }}
              />
            ) : null}
            <Button
              label="Borrar"
              variant="danger"
              onPress={() =>
                confirm('¿Borrar este bloque?', `“${block.title}” se borra para todos. Vas a poder deshacerlo.`, 'Borrar', () => {
                  remove.mutate({ blockId: block.id });
                  closeSheet();
                })
              }
            />
          </View>
        ) : (
          <Text style={styles.meta}>Solo los viajeros de este tramo pueden editarlo.</Text>
        )}
      </SheetBody>
    </SheetRoot>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <FieldLabel>{label}</FieldLabel>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

// ───────────────────────── Editar

function EditMode({ block, tripId, onDone }: { block: PlanBlock; tripId: string; onDone: () => void }) {
  const overview = usePlanOverview(tripId);
  const perms = usePermissions(tripId);
  const me = useMe();
  const update = useUpdateBlock(tripId);
  const [state, setState] = useState<BlockFormState>(() => formFromBlock(block));
  const [errors, setErrors] = useState<FormErrors>({});
  const legs = overview.data?.legs ?? [];

  const save = async () => {
    const { fields, errors: errs } = formToFields(state, me);
    setErrors(errs);
    if (!fields) return;
    const patch = diffPatch(block, fields);
    if (!Object.keys(patch).length) return onDone();
    try {
      await update.mutateAsync({ blockId: block.id, patch });
      onDone();
    } catch (e) {
      // El caché ya volvió al valor anterior (rollback); el formulario conserva lo que escribió.
      setErrors({ form: toolErrorMessage(e) });
    }
  };

  return (
    <SheetRoot>
      <SheetHeader
        title={`Editar ${TYPE_LABEL[block.type].toLowerCase()}`}
        left={{ label: 'Cancelar', onPress: onDone }}
        right={{ label: 'Guardar', onPress: save, loading: update.isPending }}
      />
      <SheetBody>
        <BlockForm
          state={state}
          onChange={setState}
          errors={errors}
          legs={legs}
          members={overview.data?.members ?? []}
          me={me}
          mode="edit"
          original={block}
          canEditLeg={perms.canEditLeg}
        />
        <Button label="Guardar" onPress={save} loading={update.isPending} />
      </SheetBody>
    </SheetRoot>
  );
}

// ───────────────────────── Mover / agendar

function MoveMode({ block, tripId, onCancel }: { block: PlanBlock; tripId: string; onCancel: () => void }) {
  const overview = usePlanOverview(tripId);
  const move = useMoveBlock(tripId);
  const leg = overview.data?.legs.find((l) => l.id === block.leg_id);
  const [dayId, setDayId] = useState<string | null>(() => (block.day_id ? null : (leg?.days[0]?.id ?? null)));
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => leg?.days ?? [], [leg]);
  const isIdea = !block.day_id;

  const submit = () => {
    const t = time.trim() ? normalizeTime(time) : undefined;
    if (time.trim() && !t) return setError('Hora inválida (ej. 15:30)');
    const target = days.find((d) => d.id === dayId);
    if (dayId === block.day_id && !t) return onCancel();
    move.mutate({
      blockId: block.id,
      dayId,
      startTime: t ?? undefined,
      toLabel: target ? `al ${formatDay(target.date)}` : 'al banco de ideas',
    });
    closeSheet();
  };

  return (
    <SheetRoot>
      <SheetHeader
        title={isIdea ? 'Agendar idea' : 'Mover a otro día'}
        left={{ label: 'Cancelar', onPress: onCancel }}
        right={{ label: isIdea ? 'Agendar' : 'Mover', onPress: submit, disabled: dayId === undefined }}
      />
      <SheetBody>
        <Text style={styles.title}>{block.title}</Text>
        <View>
          <FieldLabel>Día</FieldLabel>
          <View style={styles.wrap}>
            {days.map((d) => (
              <Chip key={d.id} label={cap(formatDay(d.date))} selected={dayId === d.id} onPress={() => setDayId(d.id)} />
            ))}
            {!isIdea ? <Chip label="Banco de ideas" selected={dayId === null} onPress={() => setDayId(null)} /> : null}
          </View>
        </View>
        {dayId ? (
          <TimeField
            label={block.start_time ? `Hora (ahora ${timeLabel(block)})` : 'Hora (opcional)'}
            value={time}
            onChange={(v) => {
              setTime(v);
              setError(null);
            }}
            error={error}
          />
        ) : null}
        <Text style={styles.meta}>
          {dayId ? 'Si no ponés hora, lo ubicamos según su horario y corremos lo que venga después.' : 'Queda en el banco de ideas del tramo.'}
        </Text>
        <Button label={isIdea ? 'Agendar' : 'Mover'} onPress={submit} />
      </SheetBody>
    </SheetRoot>
  );
}

const styles = StyleSheet.create({
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  kind: { fontSize: font.small, fontWeight: '700', color: colors.textMuted },
  private: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  privateText: { fontSize: font.tiny, color: colors.textMuted, fontWeight: '600' },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  when: { fontSize: font.body, fontWeight: '600', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  value: { fontSize: font.body, color: colors.text },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  personName: { fontSize: font.body, color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  link: { fontSize: font.small, color: colors.primary, textDecorationLine: 'underline' },
  box: { borderRadius: radius.md },
});
