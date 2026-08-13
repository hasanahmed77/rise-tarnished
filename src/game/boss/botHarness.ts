// The player-bot simulation harness (#14, BOSS_AI.md §9's "crown jewel"):
// scripted, deterministic player behaviors that drive the pure boss sim
// directly, no rendering and no real PlayerCombatState. This is legitimate
// because the entire adaptation mechanism (behaviorTracker → tactics/L2 →
// weighting/L3) only ever reads `BossStepContext.observed` and
// `lastPlayerAction` — never the player's own combat state — so a bot only
// has to produce believable *telemetry*, exactly the same shape CombatScene
// itself derives from a real fight.
//
// This module is the single definition each bot's behavior; both the
// fairness suite (fairness.property.test.ts, #10) and the adaptation-proof
// suite (adaptation.property.test.ts, #14) drive the same bots through it,
// so "what does a roll-spammer do" can't quietly drift between the two.

import type { BossCombatState, BossStepContext } from './bossCombat';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { margitWeightRules } from './weighting';

export type BotName = 'roll-spammer' | 'turtle' | 'camper' | 'masher' | 'idle';

export const ALL_BOTS: BotName[] = ['roll-spammer', 'turtle', 'camper', 'masher', 'idle'];

/**
 * The `BossStepContext` a bot produces on one tick. Pure — a function of the
 * bot's identity, where in the fight this is, the boss's current state, and
 * whether the boss just started a move (the trigger a roll-spammer reacts
 * to). No hidden state, so a caller's loop owns nothing but `justSawMoveStart`
 * and the boss state itself.
 *
 * Each bot is written to saturate the ONE signal its name promises and
 * nothing else, so a test asserting "roll-spammer raises dodgeReflex" is
 * actually exercising that path and not accidentally also turtling:
 *  - **roll-spammer**: dodges the instant the boss commits to a move,
 *    regardless of whether it's a real threat — the textbook panic roll
 *    (dodgeReflex, BOSS_AI.md §5).
 *  - **turtle**: blocks every tick, stands still (turtleIndex).
 *  - **camper**: stays 200 units out — beyond CAMPING_DISTANCE (140) but
 *    inside flying_thrust's gap-closer band — and never blocks or dodges
 *    (rangeCamping).
 *  - **masher**: attacks on a fixed cadence and is periodically caught in a
 *    synthetic punishable window, exercising PUNISH/F5 rather than any
 *    tracker signal.
 *  - **idle**: does nothing — the control case fairness checks lean on.
 */
export function botStepContext(
  bot: BotName,
  tickIndex: number,
  boss: BossCombatState,
  justSawMoveStart: boolean,
): BossStepContext {
  const playerX = bot === 'camper' ? boss.x + 200 : 250;
  return {
    table: margitMoves,
    topLevelIds: margitTopLevelMoveIds,
    playerX,
    minX: 40,
    maxX: 900,
    lastPlayerAction: bot === 'roll-spammer' ? 'dodge' : bot === 'turtle' ? 'block' : null,
    weightRules: margitWeightRules,
    observed: {
      playerBlocking: bot === 'turtle',
      dodgeStarted: bot === 'roll-spammer' && justSawMoveStart,
      attackStarted: bot === 'masher' && tickIndex % 30 === 0,
      punishableOpening: bot === 'masher' && tickIndex % 90 < 40,
    },
  };
}
