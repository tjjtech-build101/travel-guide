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
  type TripAnchor,
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
  DayWindow,
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

/** Llegada internacional (vuelo largo): el primer día rinde ~35 % y se cena temprano. */
export const LONG_HAUL_CAP = 0.35;
export const LONG_HAUL_DINNER = 19 * 60 + 30;
export const JETLAG_NOTE =
  'Llegan de un vuelo largo: día liviano para acomodarse (algo cerca del alojamiento y cena temprano). Tomen luz natural y aguanten despiertos hasta la noche local: así el jet lag dura menos.';

/**
 * Ventanas por fecha (YYYY-MM-DD): arranque según cronotipo; el día de llegada arranca después del traslado
 * (hora real si la tiene; si no, "a la mañana" = 9:00) + duración + 30 min para acomodarse. Con `longHaulArrival`
 * (primer tramo de un viaje que llega de otro continente) el primer día rinde ~35 % y cena temprano, con aviso.
 */
export function dayWindows(
  days: { id: string; date: string }[],
  transfers: { day_id: string | null; start_time: string | null; duration_min: number | null }[],
  chronotype: PlannerGroup['chronotype'],
  opts: { longHaulArrival?: boolean } = {},
): ComposeLeg['dayWindows'] {
  const out: ComposeLeg['dayWindows'] = {};
  for (const d of days) {
    let start = START_BY_CHRONO[chronotype] ?? START_BY_CHRONO.normal;
    for (const t of transfers.filter((x) => x.day_id === d.id)) {
      const from = toMin(t.start_time) ?? 9 * 60;
      start = Math.max(start, from + (t.duration_min ?? 60) + 30);
    }
    out[d.date] = { start_min: Math.min(start, DAY_END - 60), end_min: DAY_END };
  }
  const first = [...days].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (opts.longHaulArrival && first) {
    const w: DayWindow = out[first.date];
    out[first.date] = { ...w, cap_factor: LONG_HAUL_CAP, dinner_min: Math.max(LONG_HAUL_DINNER, w.start_min + 60), note: JETLAG_NOTE };
  }
  return out;
}

// ───────────────────────── Llegada internacional

const CONTINENT: Record<string, string> = {};
const addCountries = (continent: string, names: string) => names.split(',').forEach((n) => (CONTINENT[normText(n)] = continent));
addCountries('sa', 'argentina,uruguay,chile,brasil,brazil,paraguay,bolivia,peru,perú,ecuador,colombia,venezuela,guyana,surinam');
addCountries('na', 'mexico,méxico,estados unidos,usa,eeuu,ee uu,united states,canada,canadá,cuba,guatemala,costa rica,panama,panamá,republica dominicana,puerto rico,honduras,el salvador,nicaragua,jamaica');
addCountries('eu', 'españa,spain,francia,france,italia,italy,portugal,alemania,germany,reino unido,united kingdom,uk,inglaterra,england,escocia,scotland,gales,wales,irlanda,ireland,paises bajos,holanda,netherlands,belgica,bélgica,belgium,suiza,switzerland,austria,grecia,greece,croacia,croatia,polonia,poland,republica checa,chequia,czechia,hungria,hungría,suecia,sweden,noruega,norway,dinamarca,denmark,finlandia,finland,islandia,iceland,turquia,turquía,turkey,rusia,russia');
addCountries('oc', 'australia,nueva zelanda,new zealand,fiyi,fiji,samoa,tonga');
addCountries('as', 'japon,japón,japan,china,corea del sur,south korea,corea,tailandia,thailand,vietnam,india,indonesia,singapur,singapore,malasia,malaysia,filipinas,philippines,emiratos arabes unidos,emiratos,uae,israel,qatar,jordania');
addCountries('af', 'marruecos,morocco,egipto,egypt,sudafrica,sudáfrica,south africa,kenia,kenya,tanzania,tunez,túnez');
/** Orígenes frecuentes sin país ("Buenos Aires") → país. */
const CITY_COUNTRY: Record<string, string> = {};
const addCities = (country: string, names: string) => names.split(',').forEach((n) => (CITY_COUNTRY[normText(n)] = country));
addCities('argentina', 'buenos aires,caba,cordoba,córdoba,rosario,mendoza,la plata,mar del plata,tucuman,tucumán,salta,neuquen,neuquén,bariloche,santa fe,ezeiza');
addCities('uruguay', 'montevideo,punta del este,colonia,salto,paysandu,paysandú');
addCities('chile', 'santiago,santiago de chile,valparaiso,valparaíso');
addCities('brasil', 'sao paulo,são paulo,rio de janeiro,río de janeiro');
addCities('peru', 'lima,cusco');
addCities('colombia', 'bogota,bogotá,medellin,medellín');
addCities('mexico', 'ciudad de mexico,ciudad de méxico,cdmx,guadalajara,monterrey');
addCities('españa', 'madrid,barcelona,valencia,sevilla');

/** País (normalizado) de un origen libre ("Buenos Aires", "Rosario, Argentina", "Uruguay"). null si no sé. */
export function originCountry(origin: string | null | undefined): string | null {
  const t = normText(origin ?? '');
  if (!t) return null;
  const parts = t.split(/[,(]/).map((x) => x.replace(/\)/g, '').trim()).filter(Boolean);
  for (const p of [...parts].reverse()) if (CONTINENT[p]) return p;
  for (const p of parts) if (CITY_COUNTRY[p]) return CITY_COUNTRY[p];
  for (const k of Object.keys(CONTINENT)) if (k.length >= 5 && ` ${t} `.includes(` ${k} `)) return k;
  return null;
}

const LONG_HAUL_RE = /jet ?lag|vuelo (largo|internacional|transoceanico|de \d+ ?h)|\d{2} ?(h|horas) de vuelo|llegada internacional|cruzan el (oceano|pacifico|atlantico)/;

/**
 * ¿El grupo llega de otro continente al primer tramo? Heurística: país de origen distinto al del tramo y en otro
 * continente (Buenos Aires → Montevideo no es jet lag; Buenos Aires → Melbourne sí), o el esqueleto lo dice en
 * assumptions ("vuelo largo", "jet lag"). Si no sé el continente de alguno, alcanza con que el país sea distinto.
 */
export function isLongHaulArrival(origin: string | null | undefined, legCountry: string | null | undefined, assumptions: string[] = []): boolean {
  if (LONG_HAUL_RE.test(normText(assumptions.join(' ')))) return true;
  const from = originCountry(origin);
  const to = originCountry(legCountry);
  if (!from || !to || from === to) return false;
  const [ca, cb] = [CONTINENT[from], CONTINENT[to]];
  if (ca && cb) return ca !== cb;
  return true;
}

// ───────────────────────── Anclas del viaje

type AnchorLike = Partial<Omit<TripAnchor, 'id' | 'name'>> & { id: string; name: string };

/**
 * Anclas de trip_shapes (skeleton, investigadas) + de la entrevista (understanding) → lista única. Si la misma ancla
 * viene de las dos (mismo id, o mismo nombre y fecha), gana la investigada.
 */
export function mergeAnchors(...lists: (AnchorLike[] | null | undefined)[]): TripAnchor[] {
  const out: TripAnchor[] = [];
  const keyOf = (a: TripAnchor) => `${normText(a.name)}|${a.date ?? ''}`;
  for (const list of lists)
    for (const raw of list ?? []) {
      if (!raw?.name?.trim()) continue;
      const a: TripAnchor = {
        id: (raw.id || normText(raw.name)).slice(0, 60),
        name: raw.name.trim().slice(0, 200),
        kind: raw.kind ?? 'other',
        city: raw.city?.trim() || null,
        country: raw.country?.trim() || null,
        date: raw.date ?? null,
        time: raw.time ?? null,
        venue: raw.venue?.trim() || null,
        tickets: raw.tickets ?? 'unknown',
        researched: raw.researched === true,
        sources: (raw.sources ?? []).filter((s) => s && typeof s.url === 'string').map((s) => ({ url: s.url, title: s.title ?? null })),
        note: raw.note?.trim() || null,
      };
      const i = out.findIndex((x) => x.id === a.id || keyOf(x) === keyOf(a));
      if (i < 0) out.push(a);
      else if (a.researched && !out[i].researched) out[i] = a;
    }
  return out.slice(0, 12);
}

const cityMatch = (a: Pick<TripAnchor, 'city'>, legCity: string) => {
  if (!a.city) return false;
  const [x, y] = [normText(a.city), normText(legCity)];
  return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
};

type LegSpan = { id?: string; city: string; start_date: string; end_date: string };

/**
 * Anclas que le tocan a un tramo. Con fecha: la fecha cae en el tramo y la ciudad coincide (o no dice ciudad, o
 * ningún tramo de ese día está en esa ciudad → lo ven desde acá, con nota). Sin fecha confirmada: el tramo de su
 * ciudad (o el primero si no coincide ninguno) — van como idea al banco.
 */
export function anchorsForLeg(anchors: TripAnchor[], leg: LegSpan, allLegs: LegSpan[] = [leg]): TripAnchor[] {
  const legs = allLegs.length ? allLegs : [leg];
  const inSpan = (d: string, l: LegSpan) => d >= l.start_date && d <= l.end_date;
  const first = [...legs].sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const same = (a: LegSpan, b: LegSpan) => (a.id && b.id ? a.id === b.id : a.city === b.city && a.start_date === b.start_date);
  const out: TripAnchor[] = [];
  for (const a of anchors) {
    if (a.date) {
      if (!inSpan(a.date, leg)) continue;
      if (!a.city || cityMatch(a, leg.city)) {
        out.push(a);
        continue;
      }
      const other = legs.some((l) => inSpan(a.date!, l) && cityMatch(a, l.city));
      if (!other)
        out.push({ ...a, note: [a.note, `Es en ${a.city} y ese día están en ${leg.city}: si no llegan, véanlo en un bar o fan zone.`].filter(Boolean).join(' ') });
      continue;
    }
    const home = legs.find((l) => cityMatch(a, l.city)) ?? first;
    if (home && same(home, leg)) out.push(a);
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
