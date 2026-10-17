import { describe, expect, it } from 'vitest';
import { wmoIcon } from './weather';

describe('wmoIcon', () => {
  it('mapea códigos conocidos', () => {
    expect(wmoIcon(0)).toBe('sun');
    expect(wmoIcon(63)).toBe('rain');
    expect(wmoIcon(95)).toBe('storm');
  });

  it('código desconocido → cloud (default seguro)', () => {
    expect(wmoIcon(999)).toBe('cloud');
  });
});
