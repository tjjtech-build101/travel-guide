import type { NowBriefSnapshotT } from '@build101/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearBriefCache, nowBrief, sanitizeBrief, type BriefLlm } from './nowBrief';

const snap: NowBriefSnapshotT = { local_time: '13:24', hero: 'leave', next: { title: 'Almuerzo' }, leave_in_min: 6, walk_min: 8 };
const args = { language: 'es', snapshot: snap };

beforeEach(() => clearBriefCache());
afterEach(() => vi.useRealTimers());

describe('now_brief', () => {
  it('usa la frase de Claude y la cachea', async () => {
    const llm = vi.fn<BriefLlm>(async () => '"Salí en 6 min: Almuerzo queda a 8 min a pie."');
    const a = await nowBrief(args, { llm });
    expect(a).toEqual({ text: 'Salí en 6 min: Almuerzo queda a 8 min a pie.', source: 'llm' });
    const b = await nowBrief(args, { llm });
    expect(b.source).toBe('llm');
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0][0].model).toBe('claude-haiku-5-5');
  });

  it('sin key / sin saldo → reglas, y no vuelve a intentar enseguida', async () => {
    const llm = vi.fn<BriefLlm>(async () => {
      throw new Error('Anthropic no está configurado');
    });
    const a = await nowBrief(args, { llm });
    expect(a).toEqual({ text: 'Salí en 6 min para Almuerzo: son 8 min a pie.', source: 'rules' });
    await nowBrief({ ...args, snapshot: { ...snap, leave_in_min: 5 } }, { llm });
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('timeout de 4 s → reglas', async () => {
    vi.useFakeTimers();
    const llm: BriefLlm = () => new Promise(() => {});
    const p = nowBrief(args, { llm });
    await vi.advanceTimersByTimeAsync(4000);
    expect((await p).source).toBe('rules');
  });

  it('una frase con números inventados se descarta', async () => {
    const llm: BriefLlm = async () => 'Salí en 3 min, son 12 cuadras.';
    expect((await nowBrief(args, { llm })).source).toBe('rules');
  });
});

describe('sanitizeBrief', () => {
  it('saca comillas y espacios; acepta números del snapshot (también "7" de -7)', () => {
    expect(sanitizeBrief('  «Vas 7 min tarde.» ', { ...snap, leave_in_min: -7 })).toBe('Vas 7 min tarde.');
  });
  it('vacía o larguísima → null', () => {
    expect(sanitizeBrief('   ', snap)).toBeNull();
    expect(sanitizeBrief('x'.repeat(200), snap)).toBeNull();
  });
});
