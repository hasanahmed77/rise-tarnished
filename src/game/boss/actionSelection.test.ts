import { describe, expect, it } from 'vitest';
import {
  createSelectionState,
  selectComboBranch,
  selectTopLevel,
  tickSelectionState,
} from './actionSelection';
import { createRng } from './rng';
import { NEUTRAL_SIGNALS } from './behaviorTracker';
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

  it('tactic filter restricts the pool to moves expressing the current intent', () => {
    const table: MoveTable = {
      ...TABLE,
      a: { ...TABLE.a, tactics: ['PRESSURE'] },
      b: { ...TABLE.b, tactics: ['NEUTRAL'] },
    };
    const weighting = { tactic: 'PRESSURE' as const, signals: NEUTRAL_SIGNALS, rules: [] };
    for (let seed = 0; seed < 50; seed++) {
      const s = { ...createSelectionState(createRng(seed)) };
      const r = selectTopLevel(table, ['a', 'b'], 50, s, weighting);
      expect(r).toMatchObject({ kind: 'move', moveId: 'a' }); // only PRESSURE-tagged
    }
  });

  it('falls back to the full eligible pool when no move expresses the tactic (§4)', () => {
    // Neither move lists RECOVER — the filter empties, the fallback must fire
    // (not stall into no-action).
    const weighting = { tactic: 'RECOVER' as const, signals: NEUTRAL_SIGNALS, rules: [] };
    const picks = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const s = createSelectionState(createRng(seed));
      const r = selectTopLevel(TABLE, ['a', 'b'], 50, s, weighting);
      expect(r.kind).toBe('move');
      if (r.kind === 'move') picks.add(r.moveId);
    }
    expect(picks).toEqual(new Set(['a', 'b'])); // whole pool reachable
  });

  it('behaviorMod skews the pick distribution under the weighted path', () => {
    const table: MoveTable = {
      ...TABLE,
      a: { ...TABLE.a, tags: ['delayed'], cooldownTicks: 0 },
    };
    const rules = [{ tag: 'delayed' as const, signal: 'dodgeReflex' as const, gain: 3 }];
    const spam = { ...NEUTRAL_SIGNALS, dodgeReflex: 1 };
    let aWeighted = 0;
    let aFlat = 0;
    for (let seed = 0; seed < 200; seed++) {
      const s = createSelectionState(createRng(seed));
      const w = selectTopLevel(table, ['a', 'b'], 50, s, {
        tactic: 'NEUTRAL',
        signals: spam,
        rules,
      });
      const f = selectTopLevel(table, ['a', 'b'], 50, s);
      if (w.kind === 'move' && w.moveId === 'a') aWeighted += 1;
      if (f.kind === 'move' && f.moveId === 'a') aFlat += 1;
    }
    expect(aWeighted).toBeGreaterThan(aFlat); // 4x weight → picked far more often
  });
});

describe('selectComboBranch', () => {
  it('ends the sequence once maxChain is reached, without consuming RNG', () => {
    const s = { ...createSelectionState(createRng(1)), chainDepth: 3 }; // a's maxChain is 3
    const r = selectComboBranch(TABLE, 50, 'a', s, null);
    expect(r.kind).toBe('sequence-end');
    expect(r.state.chainDepth).toBe(0);
    expect(r.state.rng).toBe(s.rng);
  });

  it('sets the F2 gap when a sequence ends', () => {
    const s = { ...createSelectionState(createRng(1)), chainDepth: 3 };
    const r = selectComboBranch(TABLE, 50, 'a', s, null);
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
      const r = selectComboBranch(table, 50, 'a', s, null);
      expect(r.kind).toBe('sequence-end');
    }
  });

  it('never offers a branch link whose target is on cooldown', () => {
    const s = { ...createSelectionState(createRng(1)), chainDepth: 1, cooldowns: { b: 5 } };
    for (let seed = 0; seed < 50; seed++) {
      const r = selectComboBranch(TABLE, 50, 'a', { ...s, rng: createRng(seed) }, null);
      if (r.kind === 'move') expect(r.moveId).not.toBe('b');
    }
  });

  it('only offers a conditioned link when lastPlayerAction matches, and always offers unconditioned ones', () => {
    const table: MoveTable = {
      ...TABLE,
      a: {
        ...TABLE.a,
        combo: {
          maxChain: 3,
          next: [{ move: 'b', weight: 1, condition: { playerAction: 'dodge' } }],
        },
      },
    };
    const s = { ...createSelectionState(createRng(1)), chainDepth: 1 };

    // Wrong/no last action: the conditioned link is never eligible → always ends.
    for (let seed = 0; seed < 20; seed++) {
      const r = selectComboBranch(table, 50, 'a', { ...s, rng: createRng(seed) }, null);
      expect(r.kind).toBe('sequence-end');
    }
    for (let seed = 0; seed < 20; seed++) {
      const r = selectComboBranch(table, 50, 'a', { ...s, rng: createRng(seed) }, 'block');
      expect(r.kind).toBe('sequence-end');
    }

    // Matching action: eligible, and since it's the only option, always picked.
    const r = selectComboBranch(table, 50, 'a', s, 'dodge');
    expect(r).toMatchObject({ kind: 'move', moveId: 'b' });
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
