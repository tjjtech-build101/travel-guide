import { describe, expect, it } from 'vitest';
import type { ToolCtx } from '../tools/types';
import { answerFromMemory, runResearch, type ResearchLLM } from './research';
import { emptyUsage } from './schemas';

/** Db falso: place_library con una fila (o ninguna), registra updates (agent_jobs y place_library). */
function fakeCtx(place: { id: string; name: string; facts: unknown[] } | null) {
  const updates: { table: string; value: Record<string, unknown> }[] = [];
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
    for (const m of ['eq', 'select', 'maybeSingle', 'single', 'ilike', 'limit']) c[m] = () => c;
    return c;
  };
  const admin = {
    from: (table: string) => ({
      select: (cols: string) => {
        if (table === 'profiles') return chain({ data: { locale: 'es' }, error: null });
        if (table === 'place_library' && cols.includes('name')) return chain({ data: place ? [{ ...place, lat: -34.9, lng: -56.2 }] : [], error: null });
        if (table === 'place_library') return chain({ data: place ? { facts: place.facts } : null, error: null });
        return chain({ data: null, error: null });
      },
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

function fakeLlm(over: Partial<ResearchLLM> = {}): ResearchLLM & { answered: string[][]; researched: number } {
  const state = { answered: [] as string[][], researched: 0 };
  return Object.assign(state, {
    research: async () => (state.researched++, { facts, usage: emptyUsage() }),
    verify: async ({ fact }: { fact: { source_url: string } }) => ({ supported: fact.source_url === 'https://a', quote: 'cita textual', usage: emptyUsage() }),
    answer: async ({ facts: f }: { facts: { text: string }[] }) => (state.answered.push(f.map((x) => x.text)), { answer: 'Es de 1746.', usage: emptyUsage() }),
    fromMemory: async () => ({ answerable: false, answer: '' }),
    ...over,
  }) as ResearchLLM & { answered: string[][]; researched: number };
}

const CIUDADELA = { id: '80000000-0000-0000-0000-000000000001', name: 'Puerta de la Ciudadela', facts: [] as unknown[] };

describe('research', () => {
  it('responde SOLO con lo verificado y lo guarda con cita, fecha, origen y pregunta', async () => {
    const { ctx, updates } = fakeCtx(CIUDADELA);
    const llm = fakeLlm();
    const r = await runResearch({ jobId: 'j1', input: { question: '¿De qué año es?', place_name: 'Puerta de la Ciudadela' }, ctx, llm });
    expect(r.facts).toEqual([{ ...facts[0], quote: 'cita textual' }]);
    expect(r).toMatchObject({ answer: 'Es de 1746.', rejected: 1, saved_facts: 1, place_id: CIUDADELA.id });
    expect(llm.answered).toEqual([[facts[0].text]]);
    const saved = (updates.find((u) => u.table === 'place_library')!.value as { facts: Record<string, unknown>[] }).facts[0];
    expect(saved).toMatchObject({ text: facts[0].text, verified: true, quote: 'cita textual', origin: 'research', question: '¿De qué año es?' });
    expect(typeof saved.verified_at).toBe('string');
    expect(updates.filter((u) => u.table === 'agent_jobs').at(-1)!.value.status).toBe('done');
  });

  it('lugar que no existe: lo crea con ensurePlace y guarda ahí', async () => {
    const { ctx } = fakeCtx(null);
    let ensured = '';
    const r = await runResearch({
      jobId: 'j1',
      input: { question: '¿Qué es?', place_name: 'Faro de Punta Carretas', lat: -34.95, lng: -56.16 },
      ctx,
      llm: fakeLlm(),
      ensure: async (_admin, a) => ((ensured = a.name), { id: 'nuevo', created: true }),
    });
    expect(ensured).toBe('Faro de Punta Carretas');
    expect(r.place_id).toBe('nuevo');
  });

  it('si nada se verifica: answer vacío, no responde ni guarda ni crea lugares', async () => {
    const { ctx, updates } = fakeCtx(null);
    let ensured = false;
    const llm = fakeLlm({ verify: async () => ({ supported: false, quote: '', usage: emptyUsage() }) });
    const r = await runResearch({ jobId: 'j1', input: { question: '¿Quién la diseñó?', place_name: 'X' }, ctx, llm, ensure: async () => ((ensured = true), null) });
    expect(r).toMatchObject({ answer: '', facts: [], rejected: 2, saved_facts: 0 });
    expect(llm.answered).toHaveLength(0);
    expect(ensured).toBe(false);
    expect(updates.some((u) => u.table === 'place_library')).toBe(false);
  });

  it('si la investigación falla, el job queda failed', async () => {
    const { ctx, updates } = fakeCtx(null);
    const llm = fakeLlm({ research: async () => { throw new Error('boom'); } });
    await expect(runResearch({ jobId: 'j1', input: { question: '¿Algo?' }, ctx, llm })).rejects.toThrow('boom');
    expect(updates.filter((u) => u.table === 'agent_jobs').at(-1)!.value).toMatchObject({ status: 'failed' });
  });

  it('memoria: si los facts del lugar responden, contesta sin investigar', async () => {
    const { ctx } = fakeCtx({ ...CIUDADELA, facts: [{ text: 'Es de 1746', source_url: 'https://a', verified: true }] });
    const llm = fakeLlm({ fromMemory: async () => ({ answerable: true, answer: 'Es de 1746.' }) });
    const hit = await answerFromMemory({ question: '¿De qué año es?', place_name: 'Puerta de la Ciudadela' }, ctx, llm);
    expect(hit).toEqual({ cached: true, answer: 'Es de 1746.', facts: [{ text: 'Es de 1746', source_url: 'https://a' }], place_id: CIUDADELA.id });
  });

  it('memoria: sin facts, o si no responden, o sin lugar → null (se investiga)', async () => {
    expect(await answerFromMemory({ question: '¿?', place_name: 'Puerta de la Ciudadela' }, fakeCtx(CIUDADELA).ctx, fakeLlm())).toBeNull();
    const withFacts = fakeCtx({ ...CIUDADELA, facts: [{ text: 'Otro dato', source_url: 'https://a', verified: true }] });
    expect(await answerFromMemory({ question: '¿Quién?', place_name: 'Puerta de la Ciudadela' }, withFacts.ctx, fakeLlm())).toBeNull();
    expect(await answerFromMemory({ question: '¿Qué?' }, fakeCtx(null).ctx, fakeLlm())).toBeNull();
  });
});
