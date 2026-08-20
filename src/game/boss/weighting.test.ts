import { describe, expect, it } from 'vitest';
import {
  applyWeightOverrides,
  behaviorMod,
  margitWeightRules,
  BEHAVIOR_MOD_MAX,
  BEHAVIOR_MOD_MIN,
  type WeightRule,
} from './weighting';
import { NEUTRAL_SIGNALS } from './behaviorTracker';
import { margitMoves } from './margitMoves';

describe('behaviorMod (F4)', () => {
  const delayed = margitMoves['margit.delayed_overhead'];
  const grab = margitMoves['margit.grab'];

  it('is 1 for neutral signals', () => {
    expect(behaviorMod(delayed, NEUTRAL_SIGNALS, margitWeightRules)).toBe(1);
  });

  it('dodge-spam boosts delayed moves (the Margit signature)', () => {
    const spam = { ...NEUTRAL_SIGNALS, dodgeReflex: 1 };
    expect(behaviorMod(delayed, spam, margitWeightRules)).toBe(4); // 1+3, capped exactly at F4 max
    expect(behaviorMod(grab, spam, margitWeightRules)).toBe(1); // untouched
  });

  it('turtling boosts grabs', () => {
    const turtle = { ...NEUTRAL_SIGNALS, turtleIndex: 1 };
    expect(behaviorMod(grab, turtle, margitWeightRules)).toBe(4);
  });

  it('F4: never exceeds 4x or drops below 0.25x, even with absurd rules', () => {
    const extreme: WeightRule[] = [
      { tag: 'delayed', signal: 'dodgeReflex', gain: 100 },
      { tag: 'grab', signal: 'turtleIndex', gain: -100 },
    ];
    const maxed = { ...NEUTRAL_SIGNALS, dodgeReflex: 1, turtleIndex: 1 };
    expect(behaviorMod(delayed, maxed, extreme)).toBe(BEHAVIOR_MOD_MAX);
    expect(behaviorMod(grab, maxed, extreme)).toBe(BEHAVIOR_MOD_MIN);
  });
});

describe('applyWeightOverrides (#64)', () => {
  it('leaves the defaults untouched when there are no overrides', () => {
    expect(applyWeightOverrides(margitWeightRules, {})).toEqual(margitWeightRules);
  });

  it('retunes only the tag an override names, leaving every other rule as-is', () => {
    const merged = applyWeightOverrides(margitWeightRules, { delayed: 1.5 });
    const delayedRule = merged.find((r) => r.tag === 'delayed');
    expect(delayedRule?.gain).toBe(1.5);

    const untouched = merged.filter((r) => r.tag !== 'delayed');
    const originalUntouched = margitWeightRules.filter((r) => r.tag !== 'delayed');
    expect(untouched).toEqual(originalUntouched);
  });

  it('never adds or removes rules — same tags in, same tags out', () => {
    const merged = applyWeightOverrides(margitWeightRules, { delayed: 9, grab: -9 });
    expect(merged.map((r) => r.tag)).toEqual(margitWeightRules.map((r) => r.tag));
    expect(merged).toHaveLength(margitWeightRules.length);
  });

  it('does not mutate the input array', () => {
    const before = margitWeightRules.map((r) => ({ ...r }));
    applyWeightOverrides(margitWeightRules, { delayed: 42 });
    expect(margitWeightRules).toEqual(before);
  });
});
