// Piezas de orquestación del planificador colaborativo (PRD 31) que comparten plan_trip y compose_days:
// - PlannerModules: catálogo/grupo/armado/chequeo/cobertura, inyectables (los tests pasan fakes; en prod se
//   cargan lazy de catalog.ts, group.ts, compose.ts, check.ts y coverage.ts).
// - Lecturas del grupo del tramo, picks desde el menú, ventanas del día, clima y escritura de bloques compuestos.
import { randomUUID } from 'node:crypto';
import {
  optionIncluded,
  type CatalogItem,
  type LegOptionReactionRow,
  type LegOptionRow,
  type PlanCoverage,
  type TripUnderstanding,
} from '@build101/shared';
import { insertBlock } from '../../blocks';
import { dbError } from '../../errors';
import { fetchForecast } from '../../google/openMeteo';
import type { Db } from '../../supabase';
import { runTool } from '../../tools/registry';
import type { ToolCtx } from '../../tools/types';
import { legMemberIds } from '../../tools/write';
import { toMin } from '../../schedule';
import type { GroupMemberInput } from './group';
import type {
  CatalogDeps,
  CatalogResult,
  CityRef,
  ComposeDeps,
  ComposedBlock,
  ComposeInput,
  ComposeLeg,
  ComposeOutput,
  LegOptionDraft,
  PickedItem,
  PlanIssue,
  PlannerGroup,
} from './types';

/** Mínimo de ítems del catálogo para usarlo; con menos, el tramo vuelve al relleno por LLM (PRD 01). */
export const MIN_CATALOG_ITEMS = 8;

export type SavedPlaceLite = { name: string; google_place_id: string | null; note: string | null };

/** Firmas que la orquestación espera de los módulos del catálogo y del armado (ver planner/types.ts). */
/** Contexto opcional del chequeo (check.ts): con los ítems sabe horarios, interior/exterior e imperdibles. */
export type CheckCtx = { items?: CatalogItem[]; mustIds?: string[]; scores?: Record<string, number> };

export type PlannerModules = {
  getCatalog: (
    admin: Db,
    city: CityRef,
    deps: CatalogDeps,
    opts?: { signal?: AbortSignal; onProgress?: (text: string) => void },
  ) => Promise<CatalogResult>;
  legEvents: (city: CityRef, dates: string[], deps: CatalogDeps) => Promise<CatalogItem[]>;
  buildPlannerGroup: (args: { members: GroupMemberInput[]; understanding?: TripUnderstanding | null }) => PlannerGroup;
  buildLegOptions: (args: {
    trip_id: string;
    leg_id: string;
    dates: string[];
    items: CatalogItem[];
    events: CatalogItem[];
    group: PlannerGroup;
    saved: SavedPlaceLite[];
  }) => LegOptionDraft[];
  defaultCatalogDeps: () => CatalogDeps;
  composeLeg: (input: ComposeInput, deps: ComposeDeps) => Promise<ComposeOutput>;
  checkPlan: (leg: ComposeLeg, blocks: ComposedBlock[], group: PlannerGroup, ctx?: CheckCtx) => PlanIssue[];
  /** Arregla lo mínimo; issues = avisos legibles que quedaron sin resolver. */
  repairPlan: (
    leg: ComposeLeg,
    blocks: ComposedBlock[],
    issues: PlanIssue[],
    group: PlannerGroup,
    ctx?: CheckCtx,
  ) => { blocks: ComposedBlock[]; issues: string[] };
  /** mustItems = TODOS los imperdibles del menú del tramo (elegidos o no). */
  coverageFor: (
    leg: { id: string; city: string },
    mustItems: { item: CatalogItem; option_id: string | null }[],
    blocks: ComposedBlock[],
    unplaced: ComposeOutput['unplaced'],
  ) => PlanCoverage;
};

let modules: Promise<PlannerModules> | null = null;

/** Carga lazy de los módulos reales (si no existen o fallan, el caller cae al relleno por LLM). */
export function loadPlannerModules(): Promise<PlannerModules> {
  modules ??= (async (): Promise<PlannerModules> => {
    const [catalog, catalogLlm, group, compose, check, coverage] = await Promise.all([
      import('./catalog'),
      import('./catalogLlm'),
      import('./group'),
      import('./compose'),
      import('./check'),
      import('./coverage'),
    ]);
    const ns = { ...catalogLlm, ...catalog, ...group, ...compose, ...check, ...coverage };
    return {
      getCatalog: ns.getCatalog,
      legEvents: ns.legEvents,
      buildPlannerGroup: ns.buildPlannerGroup,
      buildLegOptions: ns.buildLegOptions,
      defaultCatalogDeps: ns.defaultCatalogDeps,
      composeLeg: ns.composeLeg,
      checkPlan: ns.checkPlan,
      repairPlan: ns.repairPlan,
      coverageFor: ns.coverageFor,
    };
  })().catch((err) => {
    modules = null; // reintentar la próxima vez
    throw err;
  });
  return modules;
}

// ───────────────────────── Puro

export const normText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * "Sí o sí" de la conversación (heurística barata, sin LLM): el nombre del lugar aparece en lo que dijo el
 * usuario. Solo nombres de ≥ 5 letras para no matchear "Bar" o "Playa".
 */
export function mentionedInConversation(item: Pick<CatalogItem, 'name'>, conversation: { role: string; text: string }[]): boolean {
  const name = normText(item.name);
  if (name.length < 5) return false;
  return conversation.some((m) => m.role === 'user' && normText(m.text).includes(name));
}

/** Imperdibles del menú (para la cobertura). */
export function mustOptions(options: LegOptionRow[]): { item: CatalogItem; option_id: string }[] {
  return options.filter((o) => o.section === 'must').map((o) => ({ item: o.item, option_id: o.id }));
}

/** Picks del modo auto: preseleccionadas + las que el usuario nombró en la conversación. */
export function autoPicks(options: LegOptionRow[], conversation: { role: string; text: string }[]): PickedItem[] {
  return options
    .map((o) => ({ o, must: mentionedInConversation(o.item, conversation) }))
    .filter(({ o, must }) => o.preselected || must)
    .map(({ o, must }) => ({
      option_id: o.id,
      item: o.item,
      section: o.section,
      must,
      score: o.score,
      for_user_ids: o.for_user_ids ?? [],
      reason: o.reason,
      reactions: [],
    }));
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Picks de compose_days: decisión del grupo (optionIncluded) + afinidad ajustada por reacciones. */
export function picksFromReactions(
  options: LegOptionRow[],
  reactions: Pick<LegOptionReactionRow, 'option_id' | 'user_id' | 'reaction'>[],
): PickedItem[] {
  const by = new Map<string, { user_id: string; reaction: LegOptionReactionRow['reaction'] }[]>();
  for (const r of reactions) {
    const list = by.get(r.option_id) ?? [];
    list.push({ user_id: r.user_id, reaction: r.reaction });
    by.set(r.option_id, list);
  }
  const out: PickedItem[] = [];
  for (const o of options) {
    const rs = by.get(o.id) ?? [];
    if (!optionIncluded(o, rs)) continue;
    const love = rs.filter((r) => r.reaction === 'love').length;
    const no = rs.filter((r) => r.reaction === 'no').length;
    const must = rs.some((r) => r.reaction === 'must');
    out.push({
      option_id: o.id,
      item: o.item,
      section: o.section,
      must,
      score: clamp01(o.score + 0.1 * love - 0.1 * no + (must ? 0.3 : 0)),
      for_user_ids: [...new Set([...(o.for_user_ids ?? []), ...rs.filter((r) => r.reaction !== 'no').map((r) => r.user_id)])],
      reason: o.reason,
      reactions: rs,
    });
  }
  return out;
}

const START_BY_CHRONO = { early: 8 * 60, normal: 9 * 60, night: 10 * 60 + 30 } as const;
const DAY_END = 23 * 60 + 30;

/**
 * Ventanas por día: arranque según cronotipo; el día de llegada arranca después del traslado
 * (hora real si la tiene; si no, "a la mañana" = 9:00) + duración + 30 min para acomodarse.
 */
export function dayWindows(
  days: { id: string; date: string }[],
  transfers: { day_id: string | null; start_time: string | null; duration_min: number | null }[],
  chronotype: PlannerGroup['chronotype'],
): ComposeLeg['dayWindows'] {
  const out: ComposeLeg['dayWindows'] = {};
  for (const d of days) {
    let start = START_BY_CHRONO[chronotype] ?? START_BY_CHRONO.normal;
    for (const t of transfers.filter((x) => x.day_id === d.id)) {
      const from = toMin(t.start_time) ?? 9 * 60;
      start = Math.max(start, from + (t.duration_min ?? 60) + 30);
    }
    out[d.id] = { start_min: Math.min(start, DAY_END - 60), end_min: DAY_END };
  }
  return out;
}

/** ComposedBlock → input de add_block (sin las claves internas del armado). */
export function toAddBlockInput(b: ComposedBlock, trip_id: string, leg_id: string): Record<string, unknown> {
  const { choice_key: _k, item_id: _i, option_id: _o, ...fields } = b;
  const status = fields.status ?? (b.choice_key ? (fields.type === 'lodging' ? 'idea' : 'proposed') : undefined);
  // add_block no acepta null en opcionales: se omiten.
  return Object.fromEntries(Object.entries({ ...fields, status, trip_id, leg_id }).filter(([, v]) => v !== undefined && v !== null));
}

// ───────────────────────── I/O

export type LegGroupData = { group: PlannerGroup; memberIds: string[] };

/** Perfiles + trip_prefs de los miembros de un tramo → PlannerGroup. */
export async function loadLegGroup(
  admin: Db,
  m: Pick<PlannerModules, 'buildPlannerGroup'>,
  tripId: string,
  memberIds: string[],
  understanding: TripUnderstanding | null = null,
): Promise<PlannerGroup> {
  const ids = [...new Set(memberIds)];
  const [{ data: profs, error: e1 }, { data: tm, error: e2 }] = await Promise.all([
    ids.length
      ? admin.from('profiles').select('id,display_name,interests,avoid,dietary,pace,chronotype,budget_level,mobility').in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? admin.from('trip_members').select('user_id,trip_prefs').eq('trip_id', tripId).in('user_id', ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (e1) throw dbError(e1, 'profiles');
  if (e2) throw dbError(e2, 'trip_members');
  const prefs = new Map(((tm ?? []) as { user_id: string; trip_prefs: unknown }[]).map((r) => [r.user_id, r.trip_prefs]));
  const members: GroupMemberInput[] = ((profs ?? []) as Record<string, unknown>[]).map((p) => ({
    user_id: p.id as string,
    display_name: (p.display_name as string | null) ?? null,
    interests: (p.interests as Record<string, number> | null) ?? null,
    avoid: (p.avoid as string[] | null) ?? null,
    dietary: (p.dietary as string[] | null) ?? null,
    pace: (p.pace as string | null) ?? null,
    chronotype: (p.chronotype as string | null) ?? null,
    budget_level: (p.budget_level as string | null) ?? null,
    mobility: p.mobility ?? null,
    trip_prefs: prefs.get(p.id as string) ?? null,
  }));
  return m.buildPlannerGroup({ members, understanding });
}

/** Pronóstico por fecha para el armado (vacío si está fuera de rango o falla: nunca bloquea). */
export async function legWeather(
  center: { lat: number; lng: number } | null,
  dates: string[],
  forecast: typeof fetchForecast = fetchForecast,
): Promise<ComposeLeg['weather']> {
  if (!center || !dates.length) return {};
  try {
    const r = await Promise.race([
      forecast({ lat: center.lat, lng: center.lng, date_from: dates[0], date_to: dates.at(-1)! }),
      new Promise<null>((res) => setTimeout(() => res(null), 4000)),
    ]);
    if (!r || !r.available) return {};
    return Object.fromEntries(
      r.days.filter((d) => dates.includes(d.date)).map((d) => [d.date, { precip_prob: d.precip_prob_max ?? null, temp_max: d.tmax ?? null, sunset_min: null }]),
    );
  } catch {
    return {};
  }
}

export type WrittenComposed = { ids: string[]; choiceGroups: number; failed: number };

/**
 * Escribe los bloques compuestos de UN tramo. Con día: add_block vía runTool con ctx.plan (excepción de plan:
 * políticas y progreso). Sin día (banco de ideas): insert directo como idea del tramo. Los de una misma
 * choice_key (≥ 2 escritos) reciben el mismo blocks.choice_group (uuid nuevo).
 */
export async function writeComposedBlocks(
  planCtx: ToolCtx,
  args: { trip_id: string; leg_id: string; blocks: ComposedBlock[]; newId?: () => string },
): Promise<WrittenComposed> {
  const { admin } = planCtx;
  const newId = args.newId ?? randomUUID;
  const ids: string[] = [];
  const byKey = new Map<string, string[]>();
  let failed = 0;
  let ideaMembers: string[] | null = null;
  for (const b of args.blocks) {
    const input = toAddBlockInput(b, args.trip_id, args.leg_id);
    let id: string | null = null;
    if (b.day_id) {
      const r = await runTool('add_block', input, planCtx);
      if (r.body.ok) {
        const d = r.body.data as { mode?: string; block?: { id: string } };
        if (d.mode === 'applied' && d.block) id = d.block.id;
      } else {
        console.warn(`[planner] add_block «${b.title}»:`, r.body.error.message);
      }
    } else {
      try {
        ideaMembers ??= await legMemberIds(admin, args.leg_id);
        const block = await insertBlock(admin, {
          ...input,
          day_id: null,
          status: 'idea',
          created_by: planCtx.userId,
          created_by_agent: true,
          participant_ids: ideaMembers,
        });
        id = block.id;
      } catch (err) {
        console.warn(`[planner] idea «${b.title}»:`, (err as Error).message);
      }
    }
    if (!id) {
      failed++;
      continue;
    }
    ids.push(id);
    if (b.choice_key) byKey.set(b.choice_key, [...(byKey.get(b.choice_key) ?? []), id]);
  }
  let choiceGroups = 0;
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const { error } = await admin.from('blocks').update({ choice_group: newId() }).in('id', group);
    if (error) console.warn('[planner] choice_group:', error.message);
    else choiceGroups++;
  }
  return { ids, choiceGroups, failed };
}

/** Componer + chequear + reparar un tramo. Devuelve los bloques finales, lo que no entró y los avisos. */
export async function composeAndCheck(
  m: Pick<PlannerModules, 'composeLeg' | 'checkPlan' | 'repairPlan' | 'coverageFor'>,
  input: ComposeInput,
  deps: ComposeDeps,
  extra: { items: CatalogItem[]; mustOptions: { item: CatalogItem; option_id: string | null }[]; excludedReason?: string },
): Promise<{ blocks: ComposedBlock[]; out: ComposeOutput; issues: string[]; coverage: PlanCoverage }> {
  // composeLeg ya corre checkPlan + repairPlan adentro (y lo que saca lo suma a unplaced con motivo).
  const out = await m.composeLeg(input, deps);
  const blocks = out.blocks;
  // Imperdibles que no llegaron al armado (el grupo los sacó del menú): motivo propio.
  const picked = new Set(input.picks.map((p) => p.item.id));
  const excluded = extra.mustOptions
    .filter((o) => !picked.has(o.item.id))
    .map((o) => ({ item: o.item, option_id: o.option_id, reason: extra.excludedReason ?? 'el grupo lo sacó del menú' }));
  const coverage = m.coverageFor(input.leg, extra.mustOptions, blocks, [...out.unplaced, ...excluded]);
  return { blocks, out, issues: [...new Set(out.issues)], coverage };
}
