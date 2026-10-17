// Propuestas pendientes (sheet desde el banner): summary, reason, fecha y diff por op con colores.
// Aceptar / Rechazar solo con FEATURES.decideProposal (PRD 11).
import type { AgentProposalRow, ProposalOp } from '@build101/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SheetBody, SheetHeader, SheetRoot, SheetMessage } from '../../../features/plan/components/Sheet';
import { SparkIcon } from '../../../features/plan/components/TypeIcon';
import { STATUS_LABEL, TIME_FLEX_LABEL, TYPE_LABEL } from '../../../features/plan/labels';
import { toolErrorMessage } from '../../../features/plan/mutations';
import { planKeys, usePendingProposals, usePlanBlocks, usePlanOverview } from '../../../features/plan/queries';
import { hhmm, shortDay, type PlanBlock, type PlanLeg } from '../../../features/plan/selectors';
import { showToast } from '../../../features/plan/store';
import { callToolOrThrow } from '../../../lib/api';
import { FEATURES } from '../../../lib/features';
import { timeAgo } from '../../../lib/format';
import { Avatar } from '../../../ui/Avatar';
import { Button } from '../../../ui/Button';
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
const HIDDEN = new Set(['lat', 'lng', 'google_place_id', 'sort_order', 'participant_ids', 'cost_currency', 'end_time', 'start_time', 'day_id']);

export default function ProposalsSheet() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const proposals = usePendingProposals(tripId);
  const blocks = usePlanBlocks(tripId);
  const overview = usePlanOverview(tripId);

  const list = proposals.data ?? [];
  return (
    <SheetRoot>
      <SheetHeader title={list.length ? `Propuestas (${list.length})` : 'Propuestas'} />
      {proposals.isPending ? (
        <SheetMessage title="Cargando…" />
      ) : proposals.isError ? (
        <SheetMessage title="No pudimos cargar las propuestas" subtitle="Probá de nuevo en un rato." />
      ) : !list.length ? (
        <SheetMessage title="No hay propuestas pendientes" subtitle="Cuando el compañero sugiera cambios en lo compartido, aparecen acá." />
      ) : (
        <SheetBody>
          {list.map((p) => (
            <ProposalCard key={p.id} proposal={p} tripId={tripId} blocks={blocks.data ?? []} legs={overview.data?.legs ?? []} />
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
}: {
  proposal: AgentProposalRow;
  tripId: string;
  blocks: PlanBlock[];
  legs: PlanLeg[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const dayLabel = (dayId: unknown) => {
    if (dayId === null) return 'Banco de ideas';
    for (const l of legs) {
      const d = l.days.find((x) => x.id === dayId);
      if (d) return shortDay(d.date);
    }
    return '';
  };

  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(decision);
    try {
      // decide_proposal es del PRD 11; acá solo se llama con el flag prendido.
      await callToolOrThrow('decide_proposal' as never, { proposal_id: p.id, decision } as never);
      showToast({ text: decision === 'accept' ? 'Propuesta aceptada' : 'Propuesta rechazada', tone: 'success' });
    } catch (e) {
      showToast({ text: toolErrorMessage(e, 'No se pudo decidir la propuesta.'), tone: 'error' });
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: planKeys.proposals(tripId) });
      void qc.invalidateQueries({ queryKey: planKeys.blocks(tripId) });
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {p.by_agent ? (
          <View style={styles.agent}>
            <SparkIcon color="#fff" size={18} />
          </View>
        ) : (
          <Avatar person={{ id: p.created_by ?? 'x', display_name: null, avatar_url: null }} size={32} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.who}>{p.by_agent ? 'El compañero' : 'Alguien del grupo'} propone</Text>
          <Text style={styles.when}>{timeAgo(p.created_at)}</Text>
        </View>
      </View>
      <Text style={styles.summary}>{p.summary}</Text>
      {p.reason ? <Text style={styles.reason}>{p.reason}</Text> : null}
      <View style={{ gap: space.xs }}>
        {(p.ops ?? []).map((op, i) => (
          <OpLine key={i} op={op} blocks={blocks} dayLabel={dayLabel} />
        ))}
      </View>
      {FEATURES.decideProposal ? (
        <View style={styles.actions}>
          <Button label="Rechazar" variant="secondary" style={{ flex: 1 }} loading={busy === 'reject'} onPress={() => decide('reject')} />
          <Button label="Aceptar" style={{ flex: 1 }} loading={busy === 'accept'} onPress={() => decide('accept')} />
        </View>
      ) : null}
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
  return a && b ? `${a}–${b}` : a || b || '—';
}

function OpLine({ op, blocks, dayLabel }: { op: ProposalOp; blocks: PlanBlock[]; dayLabel: (id: unknown) => string }) {
  const c = OP_COLORS[op.op];
  const target = 'block_id' in op ? blocks.find((b) => b.id === op.block_id) : undefined;
  const name = target?.title ?? 'Un bloque';
  const lines: string[] = [];

  if (op.op === 'add') {
    const b = op.block as Record<string, unknown>;
    const when = [dayLabel(b.day_id ?? null), hhmm(typeof b.start_time === 'string' ? b.start_time : null)].filter(Boolean).join(' ');
    lines.push(`${String(b.title ?? 'Nuevo bloque')}${when ? ` · ${when}` : ''}`);
  } else if (op.op === 'update') {
    const patch = op.patch ?? {};
    if ('start_time' in patch || 'end_time' in patch) {
      const before = range(target?.start_time, target?.end_time);
      const after = range(patch.start_time ?? target?.start_time, patch.end_time ?? target?.end_time);
      lines.push(`${shortName(name)}: ${before} → ${after}`);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (HIDDEN.has(k)) continue;
      const prev = target ? (target as unknown as Record<string, unknown>)[k] : undefined;
      lines.push(`${FIELD_LABEL[k] ?? k}: ${fmtValue(k, prev)} → ${fmtValue(k, v)}`);
    }
    if (!lines.length) lines.push(`Cambios en ${name}`);
  } else if (op.op === 'move') {
    const patch = op.patch ?? {};
    const t = hhmm(typeof patch.start_time === 'string' ? patch.start_time : null);
    lines.push(`${name} → ${'day_id' in patch ? dayLabel(patch.day_id) : 'otro lugar'}${t ? ` ${t}` : ''}`);
  } else {
    lines.push(name);
  }

  return (
    <View style={[styles.op, { backgroundColor: c.bg }]}>
      <Text style={[styles.opSign, { color: c.fg }]}>{c.sign}</Text>
      <View style={{ flex: 1 }}>
        {lines.map((l, i) => (
          <Text key={i} style={[styles.opText, { color: c.fg }, op.op === 'remove' && styles.strike]}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** "Cena en Jacinto" → "Cena". */
function shortName(title: string): string {
  return title.split(/\s+en\s+/i)[0] || title;
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  agent: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ghost, alignItems: 'center', justifyContent: 'center' },
  who: { fontSize: font.small, fontWeight: '700', color: colors.text },
  when: { fontSize: font.tiny, color: colors.textMuted },
  summary: { fontSize: font.body, fontWeight: '700', color: colors.text },
  reason: { fontSize: font.small, color: colors.textMuted },
  op: { flexDirection: 'row', gap: space.sm, padding: space.sm, borderRadius: radius.sm },
  opSign: { fontSize: font.body, fontWeight: '800', width: 16, textAlign: 'center' },
  opText: { fontSize: font.small, fontWeight: '600' },
  strike: { textDecorationLine: 'line-through' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
});
