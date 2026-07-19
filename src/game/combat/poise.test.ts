import { describe, expect, it } from 'vitest';
import { applyPoiseHit, applyUndefendedHit, tickPoiseDecay } from './poise';
import { POISE_DECAY_PER_TICK } from './frameData';

describe('entity-generic poise', () => {
  it('decays per tick and floors at zero', () => {
    expect(tickPoiseDecay(10)).toBeCloseTo(10 - POISE_DECAY_PER_TICK);
    expect(tickPoiseDecay(0)).toBe(0);
    expect(tickPoiseDecay(POISE_DECAY_PER_TICK / 2)).toBe(0);
  });

  it('accumulates below the threshold without breaking', () => {
    const r = applyPoiseHit(10, 5, 25);
    expect(r).toEqual({ poiseDamage: 15, broken: false });
  });

  it('breaks at exactly the threshold and consumes the accumulator', () => {
    const r = applyPoiseHit(11, 14, 25);
    expect(r).toEqual({ poiseDamage: 0, broken: true });
  });

  it('applies an undefended hit: full HP damage + poise, hp floored at 0', () => {
    const r = applyUndefendedHit({ hp: 20, poiseDamage: 0 }, { hp: 30, poise: 10 }, 25);
    expect(r).toEqual({ hp: 0, poiseDamage: 10, poiseBroken: false });
  });

  it('reports poise break on an undefended hit that breaches the threshold', () => {
    const r = applyUndefendedHit({ hp: 100, poiseDamage: 14 }, { hp: 5, poise: 14 }, 25);
    expect(r).toEqual({ hp: 95, poiseDamage: 0, poiseBroken: true });
  });
});
