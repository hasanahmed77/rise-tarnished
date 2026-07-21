// Pure terminal-state determination for a fight (#11), engine-agnostic
// (CLAUDE.md: "Combat/stat/FSM logic lives in plain TS modules,
// unit-testable without Phaser"). CombatScene calls this once per tick
// instead of embedding the HP-threshold/tie-break rule directly in a
// Phaser.Scene subclass, so the rule itself has a test independent of
// booting a scene.

import type { FightResult } from './reward';

/** Null while the fight is still going. A simultaneous double-KO (both
 * entities at 0 HP the same tick) favors the player — boss checked first. */
export function determineFightOutcome(bossHp: number, playerHp: number): FightResult | null {
  if (bossHp <= 0) return 'victory';
  if (playerHp <= 0) return 'death';
  return null;
}
