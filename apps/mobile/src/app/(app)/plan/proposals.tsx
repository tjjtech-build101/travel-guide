// Propuestas pendientes (sheet desde el banner, el chip del inicio, los fantasmas del plan y las tarjetas de la llamada):
// quién propone, summary, reason y diff por op con colores (antes → después). Aceptar aplica todo junto
// (decide_proposal, PRD 11) con Deshacer; las vencidas (24 h o un bloque cambió) se ven grises y se descartan.
import { SCOUT, type AgentProposalRow, type DecideProposalResult, type ProposalOp } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SheetBody, SheetHeader, SheetRoot, SheetMessage } from '../../../features/plan/components/Sheet';
import { SparkIcon } from '../../../features/plan/components/TypeIcon';
import { STATUS_LABEL, TIME_FLEX_LABEL, TYPE_LABEL } from '../../../features/plan/labels';
import { toolErrorView } from '../../../features/plan/mutations';
import { changesLabel, splitProposals } from '../../../features/plan/proposals';
import { planKeys, usePendingProposals, usePermissions, usePlanBlocks, usePlanOverview } from '../../../features/plan/queries';
import { hhmm, shortDay, type PlanBlock, type PlanLeg, type PlanMember } from '../../../features/plan/selectors';
import { showToast } from '../../../features/plan/store';
import { callToolOrThrow } from '../../../lib/api';
import { timeAgo } from '../../../lib/format';
import { Avatar } from '../../../ui/Avatar';
import { Button } from '../../../ui/Button';
import { ErrorNotice } from '../../../ui/ErrorNotice';
import { Text } from '../../../ui/Text';
import { colors, font, radius, space } from '../../../ui/theme';

const OP_COLORS = {
  add: { bg: '#E6F4E3', fg: '#2F6B1E', sign: '+' },
  update: { bg: '#FFF4D6', fg: '#7A5200', sign: '~' },
  move: { bg: '#E1EEFB', fg: '#1D4F8A', sign: '→' },
  remove: { bg: '#FBE4E1', fg: '#A8261B', sign: '−' },
} as const;

const FIELD_LABEL: Record<string, string> = {
  title: 'Nombre',
  place_name: 'Lugar',
  status: 'Estado',
  type: 'Tipo',
  notes: 'Notas',
  description: 'Descripción',
  duration_min: 'Duración',
  cost_estimate: 'Costo',
  booking_url: 'Reserva',
  is_private: 'Privado',
  time_flex: 'Franja',
};
/** Claves internas o que ya se muestran de otra forma (horario, día, participantes). */
const HIDDEN = new Set([
  'lat', 'lng', 'google_place_id', 'sort_order', 'participant_ids', 'cost_currency', 'end_time', 'start_time', 'day_id',
  'choice_group', 'tour_id', 'trip_id', 'leg_id', 'created_by', 'created_by_agent', 'plan_variant', 'alerts', 'sources', 'transfer',
]);

type Decision = 'accept' | 'reject';

export default function ProposalsSheet() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const proposals = usePendingProposals(tripId);
  const blocks = usePlanBlocks(tripId);
  const overview = usePlanOverview(tripId);
  const perms = usePermissions(tripId);

  const { fresh, stale } = useMemo(
    () => splitProposals(proposals.data ?? [], blocks.data ?? []),
    [proposals.data, blocks.data],
  );
  const total = fresh.length + stale.length;
  const legs = overview.data?.legs ?? [];
  const members = overview.data?.members ?? [];
  const canDecide = (p: AgentProposalRow) => (p.leg_id ? perms.canEditLeg(p.leg_id) : perms.canPropose);
  const blockedReason = perms.isFollower
    ? 'Los seguidores ven las propuestas pero no las deciden.'
    : 'Solo deciden quienes están en ese tramo del viaje.';

  return (
    <SheetRoot>
      <SheetHeader title={fresh.length ? `Propuestas (${fresh.length})` : 'Propuestas'} />
      {proposals.isPending || blocks.isPending ? (
        <SheetMessage title="Cargando propuestas…" />
      ) : (proposals.isError && !proposals.data) || (blocks.isError && !blocks.data) ? (
        <SheetBody>
          <ErrorNotice
            error={proposals.error ?? blocks.error}
            doing="cargar las propuestas"
            onRetry={() => {
              void proposals.refetch();
              void blocks.refetch();
            }}
            retrying={proposals.isFetching || blocks.isFetching}
          />
        </SheetBody>
      ) : !total ? (
        <SheetMessage
          title="No hay propuestas pendientes"
          subtitle={`Cuando ${SCOUT.name} sugiera cambios en lo compartido, aparecen acá para que el grupo las acepte o las rechace.`}
        />
      ) : (
        <SheetBody>
          {fresh.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              tripId={tripId}
              blocks={blocks.data ?? []}
              legs={legs}
              members={members}
              canDecide={canDecide(p)}
              blockedReason={blockedReason}
            />
          ))}
          {stale.length ? <Text style={styles.section}>Vencidas</Text> : null}
          {stale.map(({ proposal: p, reason }) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              tripId={tripId}
              blocks={blocks.data ?? []}
              legs={legs}
              members={members}
              canDecide={canDecide(p)}
              blockedReason={blockedReason}
              staleReason={reason}
            />
          ))}
        </SheetBody>
      )}
    </SheetRoot>
  );
}

function ProposalCard({
  proposal: p,
  tripId,
  blocks,
  legs,
  members,
  canDecide,
  blockedReason,
  staleReason,
}: {
  proposal: AgentProposalRow;
  tripId: string;
  blocks: PlanBlock[];
  legs: PlanLeg[];
  members: PlanMember[];
  canDecide: boolean;
  blockedReason: string;
  staleReason?: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Decision | null>(null);
  // El error de decidir se muestra en la tarjeta: un toast quedaría tapado por el sheet.
  const [failure, setFailure] = useState<{ error: unknown; decision: Decision } | null>(null);
  const author = members.find((m) => m.id === p.created_by);
  const authorName = p.by_agent ? SCOUT.name : author?.display_name?.split(' ')[0] || 'Alguien del grupo';
  const ops = p.ops ?? [];
  const dayLabel = (dayId: unknown) => {
    if (dayId === null || dayId === undefined) return 'Banco de ideas';
    for (const l of legs) {
      const d = l.days.find((x) => x.id === dayId);
      if (d) return shortDay(d.date);
    }
    return '';
  };

  const decide = async (decision: Decision) => {
    setBusy(decision);
    setFailure(null);
    try {
      const res = await callToolOrThrow<'decide_proposal', DecideProposalResult>('decide_proposal', { proposal_id: p.id, decision });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (res.data.status === 'accepted') {
        const n = res.data.applied_block_ids.length;
        showToast({ text: `Listo · ${n === 1 ? 'quedó en el plan' : `${n} cambios en el plan`}`, tone: 'success', undoToken: res.undo_token, tripId });
      } else if (res.data.status === 'rejected') {
        showToast({ text: staleReason ? 'Propuesta descartada' : 'Propuesta rechazada', tone: 'info' });
      } else {
        showToast({ text: 'Esa propuesta venció: algo del plan cambió. Pedile al Scout que la arme de nuevo.', tone: 'info' }, 5000);
      }
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setFailure({ error: e, decision });
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: planKeys.proposals(tripId) });
      void qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) });
    }
  };

  return (
    <View style={[styles.card, staleReason ? styles.cardStale : null]}>
      <View style={styles.head}>
        {p.by_agent ? (
          <View style={styles.agent}>
            <SparkIcon color="#fff" size={18} />
          </View>
        ) : (
          <Avatar person={{ id: p.created_by ?? 'x', display_name: author?.display_name ?? null, avatar_url: author?.avatar_url ?? null }} size={32} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.who}>{authorName} propone</Text>
          <Text style={styles.when}>
            {timeAgo(p.created_at)}
            {p.day_id ? ` · ${dayLabel(p.day_id)}` : ''}
          </Text>
        </View>
        <View style={styles.count}>
          <Text style={styles.countText}>{changesLabel(ops.length)}</Text>
        </View>
      </View>
      <Text style={styles.summary}>{p.summary}</Text>
      {p.reason ? <Text style={styles.reason}>{p.reason}</Text> : null}
      <View style={{ gap: space.xs }}>
        {ops.map((op, i) => (
          <OpLine key={i} op={op} blocks={blocks} dayLabel={dayLabel} />
        ))}
      </View>
      {failure ? (
        <ErrorNotice
          compact
          error={failure.error}
          view={toolErrorView(failure.error, failure.decision === 'accept' ? 'aceptar la propuesta' : 'rechazar la propuesta')}
        />
      ) : null}
      {staleReason ? (
        <>
          <Text style={styles.staleText}>Venció: {staleReason}</Text>
          {canDecide ? (
            <Button label="Descartar" variant="secondary" loading={busy === 'reject'} onPress={() => decide('reject')} />
          ) : null}
        </>
      ) : canDecide ? (
        <View style={styles.actions}>
          <Button label="Rechazar" variant="secondary" style={{ flex: 1 }} loading={busy === 'reject'} disabled={busy === 'accept'} onPress={() => decide('reject')} />
          <Button label="Aceptar" style={{ flex: 1 }} loading={busy === 'accept'} disabled={busy === 'reject'} onPress={() => decide('accept')} />
        </View>
      ) : (
        <Text style={styles.blocked}>{blockedReason}</Text>
      )}
    </View>
  );
}

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'status') return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? String(v);
  if (key === 'type') return TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? String(v);
  if (key === 'time_flex') return TIME_FLEX_LABEL[v as keyof typeof TIME_FLEX_LABEL] ?? String(v);
  if (key === 'is_private') return v ? 'Sí' : 'No';
  if (key === 'duration_min') return `${v} min`;
  return String(v);
}

function range(s: unknown, e: unknown): string {
  const a = hhmm(typeof s === 'string' ? s : null);
  const b = hhmm(typeof e === 'string' ? e : null);
  return a && b ? `${a}–${b}` : a || b || '';
}

function endFrom(start: unknown, durationMin: unknown): string | null {
  if (typeof start !== 'string' || typeof durationMin !== 'number') return null;
  const [h, m] = start.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + durationMin);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const when = (day: string, time: string) => [day, time].filter(Boolean).join(' ');

function OpLine({ op, blocks, dayLabel }: { op: ProposalOp; blocks: PlanBlock[]; dayLabel: (id: unknown) => string }) {
  const c = OP_COLORS[op.op];
  const target = 'block_id' in op ? blocks.find((b) => b.id === op.block_id) : undefined;
  const name = target ? (target.masked ? 'Un bloque privado' : target.title) : 'Un bloque que ya no está';
  const lines: string[] = [];
  let sub: string | null = null;

  if (op.op === 'add') {
    const b = op.block as Record<string, unknown>;
    const t = range(b.start_time, b.end_time ?? endFrom(b.start_time, b.duration_min));
    lines.push(String(b.title ?? 'Nuevo bloque'));
    sub = [when(dayLabel(b.day_id ?? null), t), typeof b.place_name === 'string' ? b.place_name : null].filter(Boolean).join(' · ') || null;
  } else if (op.op === 'update') {
    const patch = op.patch ?? {};
    lines.push(name);
    if ('start_time' in patch || 'end_time' in patch) {
      const before = range(target?.start_time, target?.end_time) || 'sin hora';
      const after = range(patch.start_time ?? target?.start_time, patch.end_time ?? target?.end_time) || 'sin hora';
      lines.push(`Horario: ${before} → ${after}`);
    }
    if ('day_id' in patch) lines.push(`Día: ${dayLabel(target?.day_id ?? null)} → ${dayLabel(patch.day_id)}`);
    for (const [k, v] of Object.entries(patch)) {
      if (HIDDEN.has(k)) continue;
      const prev = target ? (target as unknown as Record<string, unknown>)[k] : undefined;
      lines.push(`${FIELD_LABEL[k] ?? k}: ${fmtValue(k, prev)} → ${fmtValue(k, v)}`);
    }
  } else if (op.op === 'move') {
    const patch = op.patch ?? {};
    const from = when(dayLabel(target?.day_id ?? null), range(target?.start_time, target?.end_time));
    const toDay = 'day_id' in patch ? dayLabel(patch.day_id) : dayLabel(target?.day_id ?? null);
    const to = when(toDay, hhmm(typeof patch.start_time === 'string' ? patch.start_time : null));
    lines.push(name);
    sub = `${from || '—'} → ${to || '—'}`;
  } else {
    lines.push(name);
    sub = target ? when(dayLabel(target.day_id), range(target.start_time, target.end_time)) || null : null;
  }

  return (
    <View style={[styles.op, { backgroundColor: c.bg }]}>
      <Text style={[styles.opSign, { color: c.fg }]}>{c.sign}</Text>
      <View style={{ flex: 1 }}>
        {lines.map((l, i) => (
          <Text key={i} style={[i === 0 ? styles.opTitle : styles.opText, { color: c.fg }, op.op === 'remove' && styles.strike]}>
            {l}
          </Text>
        ))}
        {sub ? <Text style={[styles.opText, { color: c.fg }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: font.small, fontWeight: '700', color: colors.textMuted, marginTop: space.sm },
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  cardStale: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  agent: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ghost, alignItems: 'center', justifyContent: 'center' },
  who: { fontSize: font.small, fontWeight: '700', color: colors.text },
  when: { fontSize: font.tiny, color: colors.textMuted },
  count: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: colors.surface },
  countText: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  summary: { fontSize: font.body, fontWeight: '700', color: colors.text },
  reason: { fontSize: font.small, color: colors.textMuted },
  op: { flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.sm },
  opSign: { fontSize: font.body, fontWeight: '800', width: 16, textAlign: 'center' },
  opTitle: { fontSize: font.small, fontWeight: '700' },
  opText: { fontSize: font.small, fontWeight: '500' },
  strike: { textDecorationLine: 'line-through' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  staleText: { fontSize: font.small, color: colors.textMuted, fontStyle: 'italic' },
  blocked: { fontSize: font.small, color: colors.textMuted, textAlign: 'center' },
});
