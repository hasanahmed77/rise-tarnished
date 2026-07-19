import { describe, expect, it } from 'vitest';
import {
  createSelectionState,
  selectComboBranch,
  selectTopLevel,
  tickSelectionState,
} from './actionSelection';
import { createRng } from './rng';
import type { MoveTable } from './types';

const TABLE: MoveTable = {
  a: {
    id: 'a',
    tags: [],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 100],
    frames: { startup: 20, active: 6, recovery: 16 },
    tellFrames: 20,
    damage: 10,
    poiseDamage: 8,
    postureSelfRisk: 0,
    staminaCost: 0,
    cooldownTicks: 10,
    combo: { maxChain: 3, next: [{ move: 'b', weight: 0.7 }] }, // 0.3 = end
  },
  b: {
    id: 'b',
    tags: [],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 100],
    frames: { startup: 14, active: 6, recovery: 20 },
    tellFrames: 18,
    damage: 12,
    poiseDamage: 9,
    postureSelfRisk: 0,
    staminaCost: 0,
    cooldownTicks: 0,
  },
  ranged: {
    id: 'ranged',
    tags: [],
    tactics: ['NEUTRAL'],
    rangeBand: [150, 300],
    frames: { startup: 18, active: 6, recovery: 20 },
    tellFrames: 18,
    damage: 10,
    poiseDamage: 6,
    postureSelfRisk: 0,
    staminaCost: 0,
    cooldownTicks: 10,
  },
};

describe('selectTopLevel', () => {
  it('is deterministic: same seed + same state → same pick', () => {
    const s = createSelectionState(createRng(42));
    const r1 = selectTopLevel(TABLE, ['a', 'b'], 50, s);
    const r2 = selectTopLevel(TABLE, ['a', 'b'], 50, s);
    expect(r1).toEqual(r2);
  });

  it('only considers moves whose range band contains the distance', () => {
    const s = createSelectionState(createRng(1));
    // distance 50 is out of `ranged`'s [150,300] band — must never be picked.
    for (let seed = 0; seed < 50; seed++) {
      const r = selectTopLevel(TABLE, ['a', 'ranged'], 50, { ...s, rng: createRng(seed) });
      if (r.kind === 'move') expect(r.moveId).not.toBe('ranged');
    }
  });

  it('respects cooldowns', () => {
    const s = { ...createSelectionState(createRng(1)), cooldowns: { a: 5 } };
    for (let seed = 0; seed < 50; seed++) {
      const r = selectTopLevel(TABLE, ['a', 'b'], 50, { ...s, rng: createRng(seed) });
      if (r.kind === 'move') expect(r.moveId).not.toBe('a');
    }
  });

  it('reports no-action when nothing is in range (no fallback move exists)', () => {
    const s = createSelectionState(createRng(1));
    const r = selectTopLevel(TABLE, ['ranged'], 50, s); // ranged needs distance >= 150
    expect(r.kind).toBe('no-action');
  });

  it('reports no-action while the F2 gap is active, without consuming RNG', () => {
    const s = { ...createSelectionState(createRng(1)), gapTicksRemaining: 10 };
    const r = selectTopLevel(TABLE, ['a', 'b'], 50, s);
    expect(r.kind).toBe('no-action');
    expect(r.state.rng).toBe(s.rng); // untouched
  });

  it('F8: never lets a move become its own 3rd consecutive pick', () => {
    const s = { ...createSelectionState(createRng(1)), recentMoves: ['b', 'b'] };
    for (let seed = 0; seed < 100; seed++) {
      const r = selectTopLevel(TABLE, ['a', 'b'], 50, { ...s, rng: createRng(seed) });
      if (r.kind === 'move') expect(r.moveId).not.toBe('b');
    }
  });
});

describe('selectComboBranch', () => {
  it('ends the sequence once maxChain is reached, without consuming RNG', () => {
    const s = { ...createSelectionState(createRng(1)), chainDepth: 3 }; // a's maxChain is 3
    const r = selectComboBranch(TABLE, 50, 'a', s);
    expect(r.kind).toBe('sequence-end');
    expect(r.state.chainDepth).toBe(0);
    expect(r.state.rng).toBe(s.rng);
  });

  it('sets the F2 gap when a sequence ends', () => {
    const s = { ...createSelectionState(createRng(1)), chainDepth: 3 };
    const r = selectComboBranch(TABLE, 50, 'a', s);
    expect(r.state.gapTicksRemaining).toBeGreaterThan(0);
  });

  it('only offers branches whose range band contains the current distance', () => {
    const table: MoveTable = {
      ...TABLE,
      a: { ...TABLE.a, combo: { maxChain: 3, next: [{ move: 'ranged', weight: 1 }] } },
    };
    // distance 50 excludes `ranged` entirely → always ends the sequence.
    for (let seed = 0; seed < 30; seed++) {
      const s = { ...createSelectionState(createRng(seed)), chainDepth: 1 };
      const r = selectComboBranch(table, 50, 'a', s);
      expect(r.kind).toBe('sequence-end');
    }
  });
});

describe('tickSelectionState', () => {
  it('decrements cooldowns and the gap, floored at 0', () => {
    const s = {
      ...createSelectionState(createRng(1)),
      cooldowns: { a: 1, b: 5 },
      gapTicksRemaining: 1,
    };
    const next = tickSelectionState(s);
    expect(next.cooldowns.a).toBeUndefined(); // hit 0 → removed
    expect(next.cooldowns.b).toBe(4);
    expect(next.gapTicksRemaining).toBe(0);
    expect(tickSelectionState(next).gapTicksRemaining).toBe(0); // never negative
  });
});
