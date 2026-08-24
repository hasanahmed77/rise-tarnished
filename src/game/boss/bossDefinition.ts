// Strategy pattern: everything that varies from one boss to the next,
// bundled behind one interface. BOSS_AI.md §7 already plans several more
// bosses (Radahn, Malenia, Radagon/Elden Beast) beyond Margit, each with its
// own moveset, tactic weighting, and tuning — but until now nothing in the
// codebase actually represented "a boss" as one thing. CombatScene.startFight()
// imported five separate Margit-specific constants directly, so adding a
// second boss would have meant hunting down and branching every one of those
// call sites. Depending on this interface instead means adding a boss is
// "author a BossDefinition and register it", not "touch combat code".
//
// Deliberately does NOT replace the individual named exports it wraps
// (margitMoves, MARGIT_BOSS_ID, margitWeightRules, ...) — those already have
// their own direct consumers (recap.ts, reweight.ts, botHarness.ts, and their
// tests) with no reason to route through boss *selection* specifically, and
// forcing them to would be churn with no benefit. This is the seam for the
// one place that actually picks a boss to fight, not a replacement for every
// existing import of Margit's own data.

import type { MoveTable } from './types';
import type { WeightRule } from './weighting';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { margitWeightRules } from './weighting';
import { BOSS_BASE_MAX_HP, MARGIT_BOSS_ID, MARGIT_RUNE_REWARD } from './bossTuning';

export interface BossDefinition {
  /** Matches the `bosses.id` row in supabase/migrations — see
   * bossTuning.ts's MARGIT_BOSS_ID for the authority note on this. */
  id: string;
  moves: MoveTable;
  topLevelMoveIds: string[];
  /** L2's default tactic weighting (weighting.ts) — a player's #64
   * between-attempt overrides are merged onto this via
   * applyWeightOverrides(), never baked in here. */
  weightRules: WeightRule[];
  baseMaxHp: number;
  /** Optimistic client-side estimate only — see MARGIT_RUNE_REWARD's own
   * note on why this is never the trusted amount. */
  runeReward: number;
}

export const margitDefinition: BossDefinition = {
  id: MARGIT_BOSS_ID,
  moves: margitMoves,
  topLevelMoveIds: margitTopLevelMoveIds,
  weightRules: margitWeightRules,
  baseMaxHp: BOSS_BASE_MAX_HP,
  runeReward: MARGIT_RUNE_REWARD,
};

/** Every playable boss, keyed by id. One entry today; the shape is what
 * matters — this is what a future boss-select step reads from, and what a
 * second BossDefinition plugs into without CombatScene changing at all. */
export const bossRegistry: Record<string, BossDefinition> = {
  [margitDefinition.id]: margitDefinition,
};
