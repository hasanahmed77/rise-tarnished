import { describe, expect, it } from 'vitest';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { validateMoveTable } from './moveSchema';

describe("Margit's move table (data test)", () => {
  it('satisfies the schema and fairness invariants F1/F3/F7 — CI fails on an illegal move', () => {
    const errors = validateMoveTable(margitMoves);
    expect(errors).toEqual([]);
  });

  it('has at least one grab, one delayed move, and one combo chain', () => {
    const tags = Object.values(margitMoves).flatMap((m) => m.tags);
    expect(tags).toContain('grab');
    expect(tags).toContain('delayed');
    expect(Object.values(margitMoves).some((m) => m.combo)).toBe(true);
  });

  it('every comboOnly move is unreachable as a fresh top-level opener', () => {
    for (const id of margitTopLevelMoveIds) {
      expect(margitMoves[id].comboOnly).not.toBe(true);
    }
    expect(margitMoves['margit.reaper_flurry'].comboOnly).toBe(true);
    expect(margitTopLevelMoveIds).not.toContain('margit.reaper_flurry');
  });
});
