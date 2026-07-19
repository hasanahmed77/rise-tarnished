import { describe, expect, it } from 'vitest';
import { MAX_CHAIN_PHASE1, MIN_TELL_FRAMES, validateMoveTable } from './moveSchema';
import type { MoveDef, MoveTable } from './types';

function baseMove(overrides: Partial<MoveDef> = {}): MoveDef {
  return {
    id: 'test.move',
    tags: [],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 100],
    frames: { startup: 20, active: 6, recovery: 16 },
    tellFrames: 20,
    damage: 10,
    poiseDamage: 8,
    postureSelfRisk: 0,
    staminaCost: 0,
    cooldownTicks: 20,
    ...overrides,
  };
}

describe('validateMoveTable', () => {
  it('accepts a legal table', () => {
    const table: MoveTable = { 'test.move': baseMove() };
    expect(validateMoveTable(table)).toEqual([]);
  });

  it('F1: rejects a tell below the minimum', () => {
    const table: MoveTable = { 'test.move': baseMove({ tellFrames: MIN_TELL_FRAMES - 1 }) };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'test.move', rule: 'F1' }));
  });

  it('rejects a tell longer than its own startup window', () => {
    const table: MoveTable = {
      'test.move': baseMove({ frames: { startup: 20, active: 6, recovery: 16 }, tellFrames: 21 }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(
      expect.objectContaining({ moveId: 'test.move', rule: 'structural' }),
    );
  });

  it('F3: rejects a combo chain cap above the phase-1 maximum', () => {
    const table: MoveTable = {
      a: baseMove({
        id: 'a',
        combo: { maxChain: MAX_CHAIN_PHASE1 + 1, next: [{ move: 'a', weight: 0.5 }] },
      }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'a', rule: 'F3' }));
  });

  it('F7: rejects a grab that combo-chains', () => {
    const table: MoveTable = {
      grab: baseMove({
        id: 'grab',
        tags: ['grab'],
        tellFrames: 40,
        combo: { maxChain: 2, next: [{ move: 'grab', weight: 0.5 }] },
      }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'grab', rule: 'F7' }));
  });

  it("F7: rejects a grab whose tell isn't the longest in the table", () => {
    const table: MoveTable = {
      grab: baseMove({ id: 'grab', tags: ['grab'], tellFrames: 20 }),
      other: baseMove({ id: 'other', tellFrames: 25 }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'grab', rule: 'F7' }));
  });

  it('rejects a combo link pointing at an unknown move', () => {
    const table: MoveTable = {
      a: baseMove({ id: 'a', combo: { maxChain: 2, next: [{ move: 'ghost', weight: 0.5 }] } }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'a', rule: 'structural' }));
  });

  it('rejects combo link weights summing above 1', () => {
    const table: MoveTable = {
      a: baseMove({
        id: 'a',
        combo: {
          maxChain: 2,
          next: [
            { move: 'a', weight: 0.7 },
            { move: 'a', weight: 0.7 },
          ],
        },
      }),
    };
    const errors = validateMoveTable(table);
    expect(errors).toContainEqual(expect.objectContaining({ moveId: 'a', rule: 'structural' }));
  });
});
