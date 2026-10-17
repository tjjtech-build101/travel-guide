import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '../tools/types';
import { mergeFacts, runResearch, type ResearchLLM } from './research';
import { emptyUsage } from './schemas';

/** Db falso: place_library con una fila, registra updates (agent_jobs y place_library). */
function fakeCtx(placeFacts: unknown[] | null) {
  const updates: { table: string; value: Record<string, unknown> }[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
    for (const m of ['eq', 'select', 'maybeSingle', 'single', 'ilike', 'limit']) c[m] = () => c;
    return c;
  };
  const admin = {
    from: (table: string) => ({
      select: () => chain({ data: table === 'place_library' ? { facts: placeFacts } : table === 'profiles' ? { locale: 'es' } : null, error: null }),
      update: (value: Record<string, unknown>) => (updates.push({ table, value }), chain({ error: null })),
      insert: () => chain({ data: { id: 'j1' }, error: null }),
    }),
  };
  return { ctx: { userId: 'u1', actor: 'agent', db: admin, admin } as unknown as ToolCtx, updates };
}

const facts = [
  { text: 'La Puerta de la Ciudadela es de 1746', source_url: 'https://a' },
  { text: 'Dato que la fuente no respalda', source_url: 'https://b' },
];

function fakeLlm(over: Partial<ResearchLLM> = {}): ResearchLLM & { answered: string[][] } {
  const answered: string[][] = [];
  return {
    answered,
    research: async () => ({ facts, usage: emptyUsage() }),
    verify: async ({ fact }) => ({ supported: fact.source_url === 'https://a', usage: emptyUsage() }),
    answer: async ({ facts: f }) => (answered.push(f.map((x) => x.text)), { answer: 'Es de 1746.', usage: emptyUsage() }),
    ...over,
  };
}

describe('research', () => {
  it('mergeFacts no duplica (ignora mayúsculas/tildes) y marca verified', () => {
    const r = mergeFacts([{ text: 'La Ciudadela es de 1746', source_url: 'x', verified: true }], [
      { text: 'la ciudadela es de 1746', source_url: 'y' },
      { text: 'Otro dato', source_url: 'z' },
    ]);
    expect(r.added).toBe(1);
    expect(r.facts.at(-1)).toEqual({ text: 'Otro dato', source_url: 'z', verified: true });
  });

  it('responde SOLO con lo verificado y lo guarda en el lugar', async () => {
    const { ctx, updates } = fakeCtx([]);
    const llm = fakeLlm();
    const r = await runResearch({ jobId: 'j1', input: { question: '¿De qué año es?', place_id: '80000000-0000-0000-0000-000000000001' }, ctx, llm });
    expect(r.facts).toEqual([facts[0]]);
    expect(r.rejected).toBe(1);
    expect(llm.answered).toEqual([[facts[0].text]]);
    expect(r).toMatchObject({ answer: 'Es de 1746.', saved_facts: 1 });
    const place = updates.find((u) => u.table === 'place_library')!.value as { facts: { verified: boolean }[] };
    expect(place.facts).toHaveLength(1);
    expect(updates.filter((u) => u.table === 'agent_jobs').at(-1)!.value.status).toBe('done');
  });

  it('si nada se verifica: answer vacío, no llama a answer ni guarda', async () => {
    const { ctx, updates } = fakeCtx([]);
    const llm = fakeLlm({ verify: async () => ({ supported: false, usage: emptyUsage() }) });
    const r = await runResearch({ jobId: 'j1', input: { question: '¿Quién la diseñó?', place_id: '80000000-0000-0000-0000-000000000001' }, ctx, llm });
    expect(r).toMatchObject({ answer: '', facts: [], rejected: 2, saved_facts: 0 });
    expect(llm.answered).toHaveLength(0);
    expect(updates.some((u) => u.table === 'place_library')).toBe(false);
  });

  it('si la investigación falla, el job queda failed', async () => {
    const { ctx, updates } = fakeCtx(null);
    const llm = fakeLlm({ research: async () => { throw new Error('boom'); } });
    await expect(runResearch({ jobId: 'j1', input: { question: '¿Algo?' }, ctx, llm })).rejects.toThrow('boom');
    expect(updates.filter((u) => u.table === 'agent_jobs').at(-1)!.value).toMatchObject({ status: 'failed' });
  });
});
