import { describe, expect, it } from 'vitest';
import { computeRuneReward } from './reward';

describe('computeRuneReward', () => {
  it('pays the base reward on victory', () => {
    expect(computeRuneReward('victory', 500)).toBe(500);
  });

  it('pays nothing on death, regardless of base reward', () => {
    expect(computeRuneReward('death', 500)).toBe(0);
    expect(computeRuneReward('death', 999999)).toBe(0);
  });

  it('a zero base reward pays zero on victory too', () => {
    expect(computeRuneReward('victory', 0)).toBe(0);
  });
});
