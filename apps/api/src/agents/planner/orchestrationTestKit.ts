// Kit de pruebas del planificador colaborativo (PRD 31): un Supabase en memoria (solo el subconjunto del query
// builder que usan las herramientas y los jobs), módulos del planificador falsos y datos de ejemplo.
// Sin red ni Supabase real: la nube de dev puede no tener la migración del PRD 31 aplicada.
import { randomUUID } from 'node:crypto';
import type { CatalogItem, LegOptionRow } from '@build101/shared';
import type { Db } from '../../supabase';
import type { ToolCtx } from '../../tools/types';
import { emptyUsage } from '../schemas';
import type { PlannerModules } from './runtime';
import type { ComposedBlock, ComposeInput, PlannerGroup } from './types';

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

const CASCADE: Record<string, { table: string; fk: string }[]> = {
  trips: [
    { table: 'legs', fk: 'trip_id' },
    { table: 'trip_members', fk: 'trip_id' },
    { table: 'activity_feed', fk: 'trip_id' },
  ],
  legs: [
    { table: 'days', fk: 'leg_id' },
    { table: 'leg_members', fk: 'leg_id' },
    { table: 'blocks', fk: 'leg_id' },
    { table: 'leg_options', fk: 'leg_id' },
  ],
  blocks: [{ table: 'block_participants', fk: 'block_id' }],
  leg_options: [{ table: 'leg_option_reactions', fk: 'option_id' }],
};

const DEFAULTS: Record<string, Row> = {
  blocks: { is_private: false, status: 'confirmed', time_flex: 'any', sort_order: 0, created_by_agent: false, choice_group: null, day_id: null },
  leg_options: { score: 0, for_user_ids: [], reason: null, preselected: false, sort_order: 0 },
};

const get = (r: Row, col: string): unknown => {
  const m = /^(\w+)->>(\w+)$/.exec(col);
  if (m) {
    const v = (r[m[1]] as Row | null | undefined)?.[m[2]];
    return v == null ? null : String(v);
  }
  return r[col];
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Tablas que fallan al leer/escribir (simula columnas o tablas que no existen). */
  failing = new Set<string>();

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  seed(table: string, rows: Row[]): void {
    for (const r of rows) this.rows(table).push(this.withDefaults(table, r));
  }

  withDefaults(table: string, r: Row): Row {
    const now = new Date().toISOString();
    return { id: randomUUID(), created_at: now, updated_at: now, ...(DEFAULTS[table] ?? {}), ...r };
  }

  remove(table: string, pred: Filter): Row[] {
    const all = this.rows(table);
    const gone = all.filter(pred);
    this.tables[table] = all.filter((r) => !pred(r));
    for (const g of gone) for (const c of CASCADE[table] ?? []) this.remove(c.table, (r) => r[c.fk] === g.id);
    return gone;
  }

  from(table: string): Query {
    return new Query(this, table);
  }

  /** Como Db para los handlers (solo el subconjunto implementado). */
  get db(): Db {
    return this as unknown as Db;
  }
}

type Result = { data: unknown; error: { message: string } | null; count?: number | null };

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private filters: Filter[] = [];
  private cols: string | null = null;
  private returning = false;
  private payload: Row | Row[] | null = null;
  private onConflict: string[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private max: number | null = null;
  private singleMode: 'one' | 'maybe' | null = null;
  private head = false;

  constructor(
    private readonly fake: FakeDb,
    private readonly table: string,
  ) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }): this {
    if (this.op === 'select') this.cols = cols;
    else this.returning = true;
    this.cols = cols;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = rows;
    this.onConflict = (opts?.onConflict ?? 'id').split(',').map((s) => s.trim());
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    return this;
  }
  eq(col: string, v: unknown): this {
    this.filters.push((r) => get(r, col) === v);
    return this;
  }
  neq(col: string, v: unknown): this {
    this.filters.push((r) => get(r, col) !== v);
    return this;
  }
  in(col: string, vs: unknown[]): this {
    this.filters.push((r) => vs.includes(get(r, col)));
    return this;
  }
  is(col: string, v: null): this {
    this.filters.push((r) => (get(r, col) ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown): this {
    if (op !== 'is') throw new Error(`FakeDb: not(${op}) sin implementar`);
    this.filters.push((r) => (get(r, col) ?? null) !== v);
    return this;
  }
  gte(col: string, v: string | number): this {
    this.filters.push((r) => (get(r, col) as string | number) >= v);
    return this;
  }
  lte(col: string, v: string | number): this {
    this.filters.push((r) => (get(r, col) as string | number) <= v);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }
  maybeSingle(): this {
    this.singleMode = 'maybe';
    return this;
  }
  single(): this {
    this.singleMode = 'one';
    return this;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, fail);
  }

  private project(r: Row): Row {
    if (!this.cols || this.cols === '*' || this.cols.includes('(')) return { ...r };
    const out: Row = {};
    for (const c of this.cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = r[c] ?? null;
    return out;
  }

  private run(): Result {
    if (this.fake.failing.has(this.table)) return { data: null, error: { message: `relation "${this.table}" does not exist` } };
    const match = (r: Row) => this.filters.every((f) => f(r));
    let rows: Row[];
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      rows = [];
      for (const p of list) {
        const existing =
          this.op === 'upsert' ? this.fake.rows(this.table).find((r) => this.onConflict.every((k) => r[k] === p[k])) : undefined;
        if (existing) {
          Object.assign(existing, p, { updated_at: new Date().toISOString() });
          rows.push(existing);
        } else {
          const row = this.fake.withDefaults(this.table, structuredClone(p));
          this.fake.rows(this.table).push(row);
          rows.push(row);
        }
      }
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === 'update') {
      rows = this.fake.rows(this.table).filter(match);
      for (const r of rows) Object.assign(r, structuredClone(this.payload as Row), { updated_at: new Date().toISOString() });
      if (!this.returning) return { data: null, error: null };
    } else if (this.op === 'delete') {
      rows = this.fake.remove(this.table, match);
      if (!this.returning) return { data: null, error: null };
    } else {
      rows = this.fake.rows(this.table).filter(match);
    }
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col] as string | number;
        const y = b[o.col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
      });
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    if (this.head) return { data: null, error: null, count: rows.length };
    const data = rows.map((r) => this.project(structuredClone(r)));
    if (this.singleMode) {
      if (this.singleMode === 'one' && data.length !== 1) return { data: null, error: { message: `esperaba 1 fila, hubo ${data.length}` } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null, count: data.length };
  }
}
// ───────────────────────── Datos de ejemplo

export const U = {
  juan: '00000000-0000-4000-8000-0000000000a1',
  sofi: '00000000-0000-4000-8000-0000000000a2',
  leo: '00000000-0000-4000-8000-0000000000a3',
  tito: '00000000-0000-4000-8000-0000000000a4', // seguidor
};

export function ctxFor(fake: FakeDb, userId: string, actor: 'user' | 'agent' = 'user'): ToolCtx {
  return { userId, actor, db: fake.db, admin: fake.db };
}

/** Viaje con Juan organizador, Sofi y Leo viajeros, Tito seguidor (sin tramos). */
export function seedTrip(fake: FakeDb, tripId = randomUUID()): string {
  fake.seed('trips', [{ id: tripId, title: 'Test', status: 'planning', created_by: U.juan }]);
  fake.seed('profiles', [
    { id: U.juan, display_name: 'Juan Pérez', interests: { comida: 5, historia: 4 }, pace: 'balanced', dietary: [], avoid: [] },
    { id: U.sofi, display_name: 'Sofía Gómez', interests: { arte: 5 }, pace: 'relaxed', dietary: ['vegetariana'], avoid: [] },
    { id: U.leo, display_name: 'Leo', interests: {}, dietary: [], avoid: [] },
    { id: U.tito, display_name: 'Tito', interests: {}, dietary: [], avoid: [] },
  ]);
  fake.seed('trip_members', [
    { trip_id: tripId, user_id: U.juan, role: 'organizer', trip_prefs: null },
    { trip_id: tripId, user_id: U.sofi, role: 'traveler', trip_prefs: null },
    { trip_id: tripId, user_id: U.leo, role: 'traveler', trip_prefs: null },
    { trip_id: tripId, user_id: U.tito, role: 'follower', trip_prefs: null },
  ]);
  return tripId;
}

/** Un tramo con días y miembros. */
export function seedLeg(
  fake: FakeDb,
  tripId: string,
  opts: { city?: string; dates?: string[]; members?: string[] } = {},
): { legId: string; dayIds: string[] } {
  const legId = randomUUID();
  const dates = opts.dates ?? ['2026-10-20', '2026-10-21'];
  fake.seed('legs', [
    { id: legId, trip_id: tripId, city: opts.city ?? 'Montevideo', country: 'Uruguay', lat: -34.9, lng: -56.2, start_date: dates[0], end_date: dates.at(-1), sort_order: 0 },
  ]);
  const dayIds = dates.map(() => randomUUID());
  fake.seed('days', dates.map((date, i) => ({ id: dayIds[i], leg_id: legId, date })));
  fake.seed('leg_members', (opts.members ?? [U.juan, U.sofi]).map((user_id) => ({ leg_id: legId, user_id })));
  return { legId, dayIds };
}

export function item(id: string, over: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id,
    name: id.replace(/-/g, ' '),
    category: 'landmark',
    tier: 'recommended',
    zone: 'Centro',
    google_place_id: `gp-${id}`,
    lat: -34.9,
    lng: -56.2,
    duration_min: 90,
    best_time: 'any',
    indoor: false,
    booking: 'none',
    cost_hint: null,
    interests: [],
    why: 'Vale la pena.',
    tip: null,
    closed_days: [],
    periods: null,
    event_dates: null,
    event_time: null,
    sources: [],
    notability: 0.5,
    rating: null,
    rating_count: null,
    ...over,
  };
}

/** Catálogo de Montevideo: 3 imperdibles + 9 recomendados. */
export function catalogItems(city = 'mvd'): CatalogItem[] {
  return [
    item(`${city}-mercado-del-puerto`, { name: 'Mercado del Puerto', tier: 'must', category: 'market' }),
    item(`${city}-teatro-solis`, { name: 'Teatro Solís', tier: 'must' }),
    item(`${city}-rambla`, { name: 'Rambla de Montevideo', tier: 'must' }),
    ...Array.from({ length: 9 }, (_, i) => item(`${city}-lugar-${i}`, { name: `Lugar ${city} ${i}` })),
  ];
}

export function fakeGroup(): PlannerGroup {
  return {
    members: [],
    weights: {},
    avoid: [],
    must: [],
    dietary: [],
    pace: 'balanced',
    chronotype: 'normal',
    budget: null,
    hasKids: false,
    firstTime: true,
    stepFree: false,
  };
}

export type ModuleCalls = {
  getCatalog: string[];
  compose: {
    leg: string;
    picks: string[];
    instruction: string | null | undefined;
    anchors?: string[];
    dayWindows?: ComposeInput['leg']['dayWindows'];
  }[];
};

/**
 * Módulos falsos: catálogo fijo (o error por ciudad), menú = must (preseleccionados) + recomendados, armado = 1
 * actividad por pick repartida en los días + una cena "elegí 1 de 2" por día.
 */
export function fakeModules(opts: { failCity?: string; smallCity?: string } = {}): { m: PlannerModules; calls: ModuleCalls } {
  const calls: ModuleCalls = { getCatalog: [], compose: [] };
  const m: PlannerModules = {
    async getCatalog(_admin, city) {
      calls.getCatalog.push(city.city);
      if (city.city === opts.failCity) throw new Error('Google sin key');
      const items = city.city === opts.smallCity ? catalogItems().slice(0, 3) : catalogItems(city.city.slice(0, 3).toLowerCase());
      return { items, lodging_zones: [], cached: false, usage: emptyUsage() };
    },
    async legEvents() {
      return [];
    },
    buildPlannerGroup: () => fakeGroup(),
    buildLegOptions: ({ trip_id, leg_id, items }) =>
      items.map((it, i) => ({
        trip_id,
        leg_id,
        item: it,
        section: it.tier === 'must' ? 'must' : 'for_you',
        score: it.tier === 'must' ? 0.9 : 0.5,
        for_user_ids: [],
        reason: null,
        preselected: it.tier === 'must' || i < 5,
        sort_order: i,
      })),
    defaultCatalogDeps: () => ({
      research: async () => ({ items: [], lodging_zones: [], usage: emptyUsage() }),
      searchPlaces: async () => [],
      placeHours: async () => null,
      now: () => new Date(),
    }),
    async composeLeg(input) {
      calls.compose.push({
        leg: input.leg.city,
        picks: input.picks.map((p) => p.item.id),
        instruction: input.instruction,
        anchors: (input.anchors ?? []).map((a) => a.id),
        dayWindows: input.leg.dayWindows,
      });
      const days = input.leg.days;
      const blocks: ComposedBlock[] = input.picks.map((p, i) => ({
        type: 'activity',
        title: p.item.name,
        google_place_id: p.item.google_place_id ?? undefined,
        place_name: p.item.name,
        lat: p.item.lat ?? undefined,
        lng: p.item.lng ?? undefined,
        time_flex: 'morning',
        duration_min: p.item.duration_min,
        day_id: days[i % days.length].id,
        choice_key: null,
        item_id: p.item.id,
        option_id: p.option_id,
      }));
      for (const d of days) {
        for (const n of [1, 2]) {
          blocks.push({ type: 'meal', title: `Cena ${n}`, time_flex: 'evening', day_id: d.id, choice_key: `cena-${d.id}`, item_id: null, option_id: null });
        }
      }
      return { blocks, unplaced: [], issues: [] };
    },
    checkPlan: () => [],
    repairPlan: (_leg, blocks) => ({ blocks, issues: [] }),
    coverageFor: (leg, mustItems, blocks) => {
      const inPlan = new Set(blocks.filter((b) => b.day_id && b.item_id).map((b) => b.item_id));
      const missing = mustItems.filter((x) => !inPlan.has(x.item.id)).map((x) => ({ option_id: x.option_id, item_id: x.item.id, name: x.item.name, reason: 'no entró' }));
      return { leg_id: leg.id, city: leg.city, must_total: mustItems.length, must_covered: mustItems.length - missing.length, missing, choices: 0 };
    },
  };
  return { m, calls };
}

/** Siembra un menú (leg_options) para un tramo y devuelve las filas. */
export function seedOptions(fake: FakeDb, tripId: string, legId: string, items = catalogItems()): LegOptionRow[] {
  const rows = items.map((it, i) => ({
    id: randomUUID(),
    trip_id: tripId,
    leg_id: legId,
    item: it,
    section: it.tier === 'must' ? 'must' : 'for_you',
    score: 0.5,
    for_user_ids: [],
    reason: null,
    preselected: it.tier === 'must',
    sort_order: i,
  }));
  fake.seed('leg_options', rows);
  return rows as unknown as LegOptionRow[];
}
