// behaviorMod for MOVES (BOSS_AI.md §5): signals → per-move weight
// multipliers, clamped to [0.25×, 4×] of base (fairness F4). The mapping is
// data — a list of (tag, signal, gain) rules per boss — so tuning is a data
// change with a unit test, not a code change. Adaptation shifts *tendencies*;
// it never creates or removes moves (eligibility is L3's job).

import type { BehaviorSignals } from './behaviorTracker';
import type { MoveDef, MoveTag } from './types';
import { clamp } from '../util';

/** F4 clamp bounds. */
export const BEHAVIOR_MOD_MIN = 0.25;
export const BEHAVIOR_MOD_MAX = 4;

export interface WeightRule {
  /** Moves carrying this tag are affected... */
  tag: MoveTag;
  /** ...scaled by this signal... */
  signal: keyof BehaviorSignals;
  /** ...as mod *= 1 + signal × gain. Negative gain suppresses the move. */
  gain: number;
}

/** Margit's mapping (the tutorial boss for "no same tactic twice"). */
export const margitWeightRules: WeightRule[] = [
  { tag: 'delayed', signal: 'dodgeReflex', gain: 3 }, // panic-rolls eat delayed strikes
  { tag: 'grab', signal: 'turtleIndex', gain: 3 }, // blocks don't stop grabs
  { tag: 'gap_closer', signal: 'rangeCamping', gain: 2.5 }, // campers get closed down
  { tag: 'combo_starter', signal: 'aggression', gain: -0.5 }, // trade less with aggressive players
  { tag: 'sweep', signal: 'dodgeTiming', gain: 1 }, // clean dodgers see more mixups
];

export function behaviorMod(move: MoveDef, signals: BehaviorSignals, rules: WeightRule[]): number {
  let mod = 1;
  for (const rule of rules) {
    if (move.tags.includes(rule.tag)) {
      mod *= 1 + signals[rule.signal] * rule.gain;
    }
  }
  return clamp(mod, BEHAVIOR_MOD_MIN, BEHAVIOR_MOD_MAX);
}
