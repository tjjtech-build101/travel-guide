// Selectores puros del Plan (sin React ni red): filtros, orden por franja, tramos paralelos, "Ocupado".
// Tests: selectors.test.ts (correr con `pnpm --filter mobile test:plan`).
import type { BlockVisibleRow, DayRow, LegRow, ProposalOp, TimeFlex, TripRole } from '@build101/shared';

import { collapseChoices, pendingChoiceGroups } from './choices';
import { TIME_FLEX_LABEL, TYPE_LABEL } from './labels';

export type PlanFilter = 'all' | 'group' | 'mine';

export type PlanBlock = BlockVisibleRow & { participant_ids: string[] };

export type PlanLeg = LegRow & { days: DayRow[]; member_ids: string[] };

export type PlanMember = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: TripRole;
};

export type PlanOverview = { legs: PlanLeg[]; members: PlanMember[] };

/** Campos que se leen de un bloque fantasma (op add de una propuesta pendiente). */
export type GhostBlock = {
  title: string;
  type: string;
  start_time: string | null;
  end_time: string | null;
  time_flex: TimeFlex | null;
  place_name: string | null;
  day_id: string | null;
  leg_id: string | null;
  participant_ids: string[];
};

export type PendingProposal = { id: string; ops: ProposalOp[] };

export type LegGroup = { id: string; legs: PlanLeg[]; parallel: boolean; dates: string[] };

export type ParallelColumn = { leg: PlanLeg; day: DayRow; blocks: PlanBlock[]; ghosts: GhostBlock[] };

export type PlanRow =
  | { kind: 'group'; key: string; group: LegGroup; activeLegIds: string[]; parallelView: boolean }
  | { kind: 'day'; key: string; leg: PlanLeg; day: DayRow; parallel: boolean }
  | { kind: 'block'; key: string; block: PlanBlock; leg: PlanLeg }
  /** PRD 31: lugar del día con opciones (mismo choice_group); blocks[0] = la recomendada. */
  | { kind: 'choice'; key: string; group: string; blocks: PlanBlock[]; leg: PlanLeg }
  | { kind: 'ghost'; key: string; ghost: GhostBlock; proposalId: string; leg: PlanLeg }
  | { kind: 'dayEmpty'; key: string; leg: PlanLeg; day: DayRow; reason: 'empty' | 'filtered' }
  | { kind: 'parallelDay'; key: string; date: string; columns: ParallelColumn[] }
  | { kind: 'ideas'; key: string; leg: PlanLeg; count: number; expanded: boolean }
  | { kind: 'idea'; key: string; block: PlanBlock; leg: PlanLeg };

export type PlanSections = {
  rows: PlanRow[];
  groups: LegGroup[];
  /** Índice de la primera fila de cada tramo (para "tocar un tramo hace scroll"). */
  legRowIndex: Record<string, number>;
  /** Índice de la fila de cada día visible. */
  dayRowIndex: Record<string, number>;
};

// ───────────────────────── Horas

/** "16:00:00" | "16:00" → minutos desde 00:00 (o null). */
export function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

/** "11:00–13:30", "16:00", o la franja ("Mañana", "Cuando sea"). */
export function timeLabel(b: { start_time: string | null; end_time: string | null; time_flex: TimeFlex | null }): string {
  const s = hhmm(b.start_time);
  const e = hhmm(b.end_time);
  if (s && e) return `${s}–${e}`;
  if (s) return s;
  const flex = b.time_flex ?? 'any';
  return flex === 'fixed' ? TIME_FLEX_LABEL.any : TIME_FLEX_LABEL[flex];
}

/** "2 h 45", "45 min", "2 h". */
export function durationLabel(min: number | null | undefined): string {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

// ───────────────────────── Orden y filtros

const FLEX_RANK: Record<TimeFlex, number> = { morning: 1, afternoon: 2, evening: 3, fixed: 4, any: 5 };

/** Primero los que tienen start_time; después por franja (mañana, tarde, noche); `any` al final; empate por sort_order. */
export function compareBlocks(
  a: { start_time: string | null; time_flex: TimeFlex | null; sort_order: number | null },
  b: { start_time: string | null; time_flex: TimeFlex | null; sort_order: number | null },
): number {
  const at = toMin(a.start_time);
  const bt = toMin(b.start_time);
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at !== null && bt === null) return -1;
  if (at === null && bt !== null) return 1;
  if (at === null && bt === null) {
    const r = FLEX_RANK[a.time_flex ?? 'any'] - FLEX_RANK[b.time_flex ?? 'any'];
    if (r) return r;
  }
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

/** Todo = todo lo visible · Del grupo = ≥ 2 participantes · Lo mío = soy participante. */
export function matchesFilter(b: { participant_ids: string[] }, filter: PlanFilter, me: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'group') return b.participant_ids.length >= 2;
  return b.participant_ids.includes(me);
}

export function isMine(b: { participant_ids: string[]; created_by: string | null }, me: string): boolean {
  return b.participant_ids.includes(me) || b.created_by === me;
}

/** Privado ajeno: se muestra "Ocupado", sin detalle y no se puede tocar. */
export function isBusy(b: { masked: boolean }): boolean {
  return b.masked;
}

// ───────────────────────── Tramos paralelos

function sortLegs(legs: PlanLeg[]): PlanLeg[] {
  return [...legs].sort(
    (a, b) => a.start_date.localeCompare(b.start_date) || a.sort_order - b.sort_order || a.id.localeCompare(b.id),
  );
}

/** Agrupa tramos que se superponen en fechas (tramos paralelos = grupo con > 1 tramo). */
export function groupLegs(legs: PlanLeg[]): LegGroup[] {
  const groups: LegGroup[] = [];
  let current: PlanLeg[] = [];
  let end = '';
  const flush = () => {
    if (!current.length) return;
    const dates = [...new Set(current.flatMap((l) => l.days.map((d) => d.date)))].sort();
    groups.push({ id: current.map((l) => l.id).join('+'), legs: current, parallel: current.length > 1, dates });
  };
  for (const leg of sortLegs(legs)) {
    if (current.length && leg.start_date <= end) {
      current.push(leg);
      if (leg.end_date > end) end = leg.end_date;
    } else {
      flush();
      current = [leg];
      end = leg.end_date;
    }
  }
  flush();
  return groups;
}

/** Fechas con más de un tramo. */
export function parallelDates(legs: PlanLeg[]): string[] {
  const count = new Map<string, number>();
  for (const l of legs) for (const d of l.days) count.set(d.date, (count.get(d.date) ?? 0) + 1);
  return [...count.entries()].filter(([, n]) => n > 1).map(([d]) => d).sort();
}

/** Rama de una fecha: la elegida, si no la del usuario (leg_member), si no la primera. */
export function branchFor(date: string, group: LegGroup, branchByDate: Record<string, string>, me: string): PlanLeg | null {
  const withDate = group.legs.filter((l) => l.days.some((d) => d.date === date));
  if (!withDate.length) return null;
  const chosen = withDate.find((l) => l.id === branchByDate[date]);
  if (chosen) return chosen;
  return withDate.find((l) => l.member_ids.includes(me)) ?? withDate[0];
}

/** Fija la rama `legId` para todas las fechas del grupo donde ese tramo tiene días. */
export function selectBranch(branchByDate: Record<string, string>, group: LegGroup, legId: string): Record<string, string> {
  const leg = group.legs.find((l) => l.id === legId);
  if (!leg) return branchByDate;
  const next = { ...branchByDate };
  for (const d of leg.days) next[d.date] = legId;
  return next;
}

// ───────────────────────── Propuestas

export function ghostFromOp(op: ProposalOp): GhostBlock | null {
  if (op.op !== 'add') return null;
  const b = op.block as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : null);
  return {
    title: str('title') ?? 'Sin título',
    type: str('type') ?? 'activity',
    start_time: str('start_time'),
    end_time: str('end_time'),
    time_flex: (str('time_flex') as TimeFlex | null) ?? null,
    place_name: str('place_name'),
    day_id: str('day_id'),
    leg_id: str('leg_id'),
    participant_ids: Array.isArray(b.participant_ids) ? (b.participant_ids as string[]) : [],
  };
}

function ghostsByDay(proposals: PendingProposal[]): Map<string, { ghost: GhostBlock; proposalId: string }[]> {
  const map = new Map<string, { ghost: GhostBlock; proposalId: string }[]>();
  for (const p of proposals) {
    for (const op of p.ops ?? []) {
      const g = ghostFromOp(op);
      if (!g?.day_id) continue;
      map.set(g.day_id, [...(map.get(g.day_id) ?? []), { ghost: g, proposalId: p.id }]);
    }
  }
  return map;
}

// ───────────────────────── Secciones

export type BuildPlanInput = {
  legs: PlanLeg[];
  blocks: PlanBlock[];
  filter: PlanFilter;
  branchByDate: Record<string, string>;
  me: string;
  parallelView?: boolean;
  expandedIdeas?: Record<string, boolean>;
  proposals?: PendingProposal[];
};

export function buildPlanSections({
  legs,
  blocks,
  filter,
  branchByDate,
  me,
  parallelView = false,
  expandedIdeas = {},
  proposals = [],
}: BuildPlanInput): PlanSections {
  const byDay = new Map<string, PlanBlock[]>();
  const ideasByLeg = new Map<string, PlanBlock[]>();
  // Plan B (lluvia / cerrado) no se mezcla con el plan principal.
  for (const b of blocks) {
    if (b.plan_variant && b.plan_variant !== 'main') continue;
    if (b.day_id) byDay.set(b.day_id, [...(byDay.get(b.day_id) ?? []), b]);
    else ideasByLeg.set(b.leg_id, [...(ideasByLeg.get(b.leg_id) ?? []), b]);
  }
  const ghosts = ghostsByDay(proposals);
  const visibleGhosts = (dayId: string) =>
    (ghosts.get(dayId) ?? []).filter((g) => filter === 'all' || matchesFilter(g.ghost, filter, me));
  const dayBlocks = (dayId: string) => (byDay.get(dayId) ?? []).filter((b) => matchesFilter(b, filter, me)).sort(compareBlocks);

  const rows: PlanRow[] = [];
  const legRowIndex: Record<string, number> = {};
  const dayRowIndex: Record<string, number> = {};
  const groups = groupLegs(legs);

  const pushDay = (leg: PlanLeg, day: DayRow, parallel: boolean) => {
    dayRowIndex[day.id] = rows.length;
    if (legRowIndex[leg.id] === undefined) legRowIndex[leg.id] = rows.length;
    rows.push({ kind: 'day', key: `day-${day.id}`, leg, day, parallel });
    const all = byDay.get(day.id) ?? [];
    const shown = dayBlocks(day.id);
    const choices = pendingChoiceGroups(shown);
    const emitted = new Set<string>();
    for (const b of shown) {
      const options = b.choice_group ? choices.get(b.choice_group) : undefined;
      if (!options) {
        rows.push({ kind: 'block', key: b.id, block: b, leg });
        continue;
      }
      if (emitted.has(b.choice_group!)) continue;
      emitted.add(b.choice_group!);
      rows.push({ kind: 'choice', key: `choice-${b.choice_group}`, group: b.choice_group!, blocks: options, leg });
    }
    const gs = visibleGhosts(day.id);
    for (const [i, g] of gs.entries()) rows.push({ kind: 'ghost', key: `ghost-${g.proposalId}-${i}`, ghost: g.ghost, proposalId: g.proposalId, leg });
    if (!shown.length && !gs.length) {
      rows.push({ kind: 'dayEmpty', key: `empty-${day.id}`, leg, day, reason: all.length ? 'filtered' : 'empty' });
    }
  };

  const pushIdeas = (leg: PlanLeg) => {
    const ideas = (ideasByLeg.get(leg.id) ?? []).filter((b) => matchesFilter(b, filter, me)).sort(compareBlocks);
    const expanded = !!expandedIdeas[leg.id];
    rows.push({ kind: 'ideas', key: `ideas-${leg.id}`, leg, count: ideas.length, expanded });
    if (expanded) for (const b of ideas) rows.push({ kind: 'idea', key: `idea-${b.id}`, block: b, leg });
  };

  for (const group of groups) {
    if (!group.parallel) {
      const leg = group.legs[0];
      legRowIndex[leg.id] = rows.length;
      rows.push({ kind: 'group', key: `group-${group.id}`, group, activeLegIds: [leg.id], parallelView: false });
      for (const day of leg.days) pushDay(leg, day, false);
      pushIdeas(leg);
      continue;
    }

    const groupRow = rows.length;
    const activeIds = new Set<string>();
    rows.push({ kind: 'group', key: `group-${group.id}`, group, activeLegIds: [], parallelView });

    if (parallelView) {
      for (const leg of group.legs) {
        activeIds.add(leg.id);
        legRowIndex[leg.id] = groupRow;
      }
      for (const date of group.dates) {
        const columns: ParallelColumn[] = [];
        for (const leg of group.legs) {
          const day = leg.days.find((d) => d.date === date);
          if (!day) continue;
          columns.push({ leg, day, blocks: collapseChoices(dayBlocks(day.id)), ghosts: visibleGhosts(day.id).map((g) => g.ghost) });
          dayRowIndex[day.id] = rows.length;
        }
        rows.push({ kind: 'parallelDay', key: `pday-${date}`, date, columns });
      }
      for (const leg of group.legs) pushIdeas(leg);
    } else {
      for (const leg of group.legs) legRowIndex[leg.id] = groupRow;
      for (const date of group.dates) {
        const leg = branchFor(date, group, branchByDate, me);
        if (!leg) continue;
        const day = leg.days.find((d) => d.date === date);
        if (!day) continue;
        activeIds.add(leg.id);
        pushDay(leg, day, true);
      }
      for (const leg of group.legs) if (activeIds.has(leg.id)) pushIdeas(leg);
    }
    const header = rows[groupRow];
    if (header.kind === 'group') header.activeLegIds = [...activeIds];
  }

  return { rows, groups, legRowIndex, dayRowIndex };
}

// ───────────────────────── Compartir día

const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** "Dom 18/10". */
export function shortDay(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WD[wd]} ${p.d}/${p.m}`;
}

/** Texto legible para WhatsApp: encabezado + una línea por bloque (privados ajenos como "Ocupado"). */
export function buildDayShareText(leg: Pick<LegRow, 'city'>, day: Pick<DayRow, 'date'>, blocks: PlanBlock[]): string {
  const lines = [...blocks]
    .filter((b) => !b.plan_variant || b.plan_variant === 'main')
    .sort(compareBlocks)
    .map((b) => {
      const time = hhmm(b.start_time) || timeLabel(b);
      if (b.masked) return `${time} Ocupado`;
      const prefix = b.type === 'tour' && !/^tour\b/i.test(b.title) ? `${TYPE_LABEL.tour} ` : '';
      return `${time} ${prefix}${b.title}${b.place_name && !b.title.includes(b.place_name) ? ` (${b.place_name})` : ''}`;
    });
  const header = `${shortDay(day.date)} · ${leg.city}`;
  return [header, ...(lines.length ? lines : ['Día libre'])].join('\n');
}
