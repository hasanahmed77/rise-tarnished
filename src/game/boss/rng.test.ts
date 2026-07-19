import { describe, expect, it } from 'vitest';
import { createRng, nextRandom, weightedPick } from './rng';

describe('seeded RNG', () => {
  it('is deterministic: same seed produces the same sequence', () => {
    const a: number[] = [];
    const b: number[] = [];
    let sa = createRng(1234);
    let sb = createRng(1234);
    for (let i = 0; i < 20; i++) {
      const [va, na] = nextRandom(sa);
      const [vb, nb] = nextRandom(sb);
      a.push(va);
      b.push(vb);
      sa = na;
      sb = nb;
    }
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const [v1] = nextRandom(createRng(1));
    const [v2] = nextRandom(createRng(2));
    expect(v1).not.toBe(v2);
  });

  it('produces values in [0, 1)', () => {
    let s = createRng(999);
    for (let i = 0; i < 200; i++) {
      const [v, next] = nextRandom(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      s = next;
    }
  });

  it('weightedPick respects zero-probability options (never picked over many draws)', () => {
    const options = [
      { item: 'never', weight: 0 },
      { item: 'always', weight: 1 },
    ];
    let s = createRng(7);
    for (let i = 0; i < 200; i++) {
      const [picked, next] = weightedPick(options, 1, s);
      expect(picked).toBe('always');
      s = next;
    }
  });

  it('weightedPick returns null when the roll lands in unclaimed weight', () => {
    const options = [{ item: 'sometimes', weight: 0.0001 }];
    let sawNull = false;
    let s = createRng(3);
    for (let i = 0; i < 50; i++) {
      const [picked, next] = weightedPick(options, 1, s);
      if (picked === null) sawNull = true;
      s = next;
    }
    expect(sawNull).toBe(true);
  });
});
