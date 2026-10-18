// Supabase en memoria para tests unitarios (sin red). Cubre lo que usan las herramientas de Ahora v2:
// select/insert/update/delete con eq/neq/is/in/gte/order/limit y maybeSingle/single. No es para producción.
import type { Db } from '../supabase';

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

const get = (r: Row, key: string): unknown => {
  const m = /^(\w+)->>(\w+)$/.exec(key);
  if (!m) return r[key];
  const v = (r[m[1]] as Row | null | undefined)?.[m[2]];
  return v == null ? null : String(v);
};

export function fakeDb(tables: Record<string, Row[]> = {}): Db & { tables: Record<string, Row[]> } {
  let seq = 0;
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let limitN: number | null = null;
    let returning = false;
    const q = {
      select: () => ((returning = op !== 'select'), q),
      insert: (v: Row | Row[]) => ((op = 'insert'), (payload = v), q),
      update: (v: Row) => ((op = 'update'), (payload = v), q),
      delete: () => ((op = 'delete'), q),
      eq: (k: string, v: unknown) => (filters.push((r) => get(r, k) === v), q),
      neq: (k: string, v: unknown) => (filters.push((r) => get(r, k) !== v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (get(r, k) ?? null) === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(get(r, k))), q),
      gte: (k: string, v: string) => (filters.push((r) => String(get(r, k) ?? '') >= v), q),
      contains: () => q,
      order: () => q,
      limit: (n: number) => ((limitN = n), q),
      run(): { data: unknown; error: null } {
        const rows = tables[table];
        if (op === 'insert') {
          const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
            id: `${table}-${++seq}`,
            created_at: new Date().toISOString(),
            ...r,
          }));
          rows.push(...list);
          return { data: returning ? list : null, error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, payload);
          return { data: returning ? hit : null, error: null };
        }
        if (op === 'delete') {
          tables[table] = rows.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        return { data: limitN == null ? hit : hit.slice(0, limitN), error: null };
      },
      maybeSingle: async () => {
        const { data } = q.run();
        return { data: (data as Row[] | null)?.[0] ?? null, error: null };
      },
      single: async () => q.maybeSingle(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(q.run()).then(res, rej),
    };
    return q;
  };
  return { from, tables } as unknown as Db & { tables: Record<string, Row[]> };
}
