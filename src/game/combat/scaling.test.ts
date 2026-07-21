import { describe, expect, it } from 'vitest';
import { scaledDamage, softcap } from './scaling';

describe('softcap', () => {
  it('is linear s/cap below the cap', () => {
    expect(softcap(0, 40)).toBe(0);
    expect(softcap(10, 40)).toBeCloseTo(0.25);
    expect(softcap(20, 40)).toBeCloseTo(0.5);
  });

  it('returns exactly 1 at the cap', () => {
    expect(softcap(40, 40)).toBe(1);
    expect(softcap(45, 45)).toBe(1);
  });

  it('grows at a diminished 0.3/cap rate past the cap', () => {
    // 45 + 45 over a cap of 45 → 1 + 0.3 * 1 = 1.3
    expect(softcap(90, 45)).toBeCloseTo(1.3);
    // one point past the cap is worth 0.3/45, not 1/45
    expect(softcap(46, 45) - softcap(45, 45)).toBeCloseTo(0.3 / 45);
  });

  it('clamps negative stats to 0', () => {
    expect(softcap(-5, 40)).toBe(0);
  });

  it('rejects a non-positive cap', () => {
    expect(() => softcap(10, 0)).toThrow();
  });
});

describe('scaledDamage', () => {
  it('returns the raw weapon base at stat 0', () => {
    expect(scaledDamage(14, 1.5, 0, 45)).toBe(14);
  });

  it('returns weaponBase × (1 + coeff) exactly at the cap', () => {
    expect(scaledDamage(14, 1.5, 45, 45)).toBeCloseTo(14 * 2.5);
  });

  it('scales monotonically with the stat', () => {
    const low = scaledDamage(14, 1.5, 10, 45);
    const mid = scaledDamage(14, 1.5, 45, 45);
    const high = scaledDamage(14, 1.5, 60, 45);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('applies a type modifier multiplicatively', () => {
    expect(scaledDamage(14, 1.5, 45, 45, 2)).toBeCloseTo(14 * 2.5 * 2);
  });
});
