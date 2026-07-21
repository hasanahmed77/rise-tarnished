import { describe, expect, it } from 'vitest';
import { determineFightOutcome } from './outcome';

describe('determineFightOutcome', () => {
  it('returns null while both entities have HP remaining', () => {
    expect(determineFightOutcome(400, 100)).toBeNull();
    expect(determineFightOutcome(1, 1)).toBeNull();
  });

  it('returns victory when the boss reaches 0 HP', () => {
    expect(determineFightOutcome(0, 100)).toBe('victory');
  });

  it('returns death when the player reaches 0 HP', () => {
    expect(determineFightOutcome(400, 0)).toBe('death');
  });

  it('a simultaneous double-KO favors the player (boss checked first)', () => {
    expect(determineFightOutcome(0, 0)).toBe('victory');
  });
});
