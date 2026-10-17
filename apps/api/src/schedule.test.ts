import { describe, expect, it } from 'vitest';
import { compareBlocks, insertIndex, recomputeTimes, type SchedBlock } from './schedule';

const blk = (id: string, start: string | null, end: string | null, flex: SchedBlock['time_flex'] = 'any'): SchedBlock => ({
  id,
  title: id,
  start_time: start,
  end_time: end,
  duration_min: null,
  time_flex: flex,
  lat: -34.9,
  lng: -56.2,
  alerts: null,
});

describe('recomputeTimes', () => {
  it('corre bloques flexibles pisados y avisa tarde en los fixed', async () => {
    const day = [
      blk('a', '09:00:00', '11:00:00', 'fixed'),
      blk('moved', '10:00:00', '12:00:00'),
      blk('c', '11:30:00', '12:30:00'),
      blk('d', '13:00:00', '14:00:00', 'fixed'),
      blk('e', '18:00:00', '19:00:00'),
    ];
    const ch = await recomputeTimes(day, 1, async () => 10);
    expect(ch.get('moved')).toEqual({ start_time: '11:10:00', end_time: '13:10:00' });
    expect(ch.get('c')).toEqual({ start_time: '13:20:00', end_time: '14:20:00' });
    expect(ch.get('d')?.alerts?.[0]).toEqual({ kind: 'late', text: 'Llegás 90 min tarde a d' });
    expect(ch.has('e')).toBe(false); // con hueco, no se corre
  });

  it('no toca bloques antes de fromIndex ni el ancla', async () => {
    const day = [blk('a', '09:00:00', '12:00:00'), blk('b', '10:00:00', '11:00:00')];
    expect((await recomputeTimes(day, 1, async () => 0, 1)).size).toBe(0);
  });
});

describe('orden', () => {
  it('compareBlocks: start_time (nulls al final) y sort_order', () => {
    const list = [
      { start_time: null, sort_order: 0 },
      { start_time: '10:00:00', sort_order: 5 },
      { start_time: '10:00:00', sort_order: 1 },
    ].sort(compareBlocks);
    expect(list.map((b) => b.sort_order)).toEqual([1, 5, 0]);
  });

  it('insertIndex por posición o por hora', () => {
    const day = [{ start_time: '09:00:00' }, { start_time: '12:00:00' }];
    expect(insertIndex(day, { position: 0 })).toBe(0);
    expect(insertIndex(day, { position: 99 })).toBe(2);
    expect(insertIndex(day, { start_time: '10:00' })).toBe(1);
    expect(insertIndex(day, {})).toBe(2);
  });
});
