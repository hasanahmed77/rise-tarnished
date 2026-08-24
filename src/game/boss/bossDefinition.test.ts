// bossDefinition.ts bundles boss selection behind one interface (Strategy
// pattern) — these tests exist to prove the bundle stays a thin composition
// of the real, already-tested Margit data rather than a copy that could
// silently drift from it.

import { describe, expect, it } from 'vitest';
import { bossRegistry, margitDefinition } from './bossDefinition';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { margitWeightRules } from './weighting';
import { BOSS_BASE_MAX_HP, MARGIT_BOSS_ID, MARGIT_RUNE_REWARD } from './bossTuning';

describe('margitDefinition', () => {
  it('references the real exports rather than copies of them', () => {
    // Identity (===), not deep equality: a copy could drift from the
    // source of truth silently; a reference can't.
    expect(margitDefinition.moves).toBe(margitMoves);
    expect(margitDefinition.topLevelMoveIds).toBe(margitTopLevelMoveIds);
    expect(margitDefinition.weightRules).toBe(margitWeightRules);
  });

  it('mirrors the scalar tuning constants', () => {
    expect(margitDefinition.id).toBe(MARGIT_BOSS_ID);
    expect(margitDefinition.baseMaxHp).toBe(BOSS_BASE_MAX_HP);
    expect(margitDefinition.runeReward).toBe(MARGIT_RUNE_REWARD);
  });
});

describe('bossRegistry', () => {
  it('looks up margitDefinition by its own id', () => {
    expect(bossRegistry[margitDefinition.id]).toBe(margitDefinition);
  });

  it('has exactly one entry today', () => {
    expect(Object.keys(bossRegistry)).toEqual([margitDefinition.id]);
  });
});
