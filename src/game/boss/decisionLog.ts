// The per-decision event log (BOSS_AI.md §8) — #55, the prerequisite #13's
// recap is built on.
//
// §8's promise is that the recap can be *specific by construction*: "you died
// to margit.delayed_overhead, selected because dodgeReflex=0.82" → "Margit read
// your panic-rolls." That only holds if the reason travelling with each
// decision is the reason the scoring actually used, so the contribution data
// here is produced by the same expression that produces the score (see
// weighting.ts / tactics.ts) rather than reconstructed afterwards. A recap
// grounded in a re-derivation that drifted would be worse than no recap.
//
// Engine-free and allocation-light: this module is pure data + one sort. The
// sim *describes* its decisions (ADR-0001's pure core); CombatScene records
// them, because the tick counter and the player's hp/stamina live in the shell,
// not in the boss's own state — the boss AI reads player *behaviour*, never
// player stats, and #55 does not change that.

/** One signal's share of a single decision's score. */
export interface SignalContribution {
  /**
   * The tracker signal (`dodgeReflex`, `turtleIndex`, …) or situational fact
   * (`bossPoise`, `bossPosture`, `distance`) that moved the score.
   */
  signal: string;
  /** Its value at the moment of the decision. Tracker signals are 0..1. */
  value: number;
  /**
   * The multiplicative factor this term applied to the option's score.
   * `1` means it was present but inert; `>1` pushed the option up, `<1` down.
   */
  effect: number;
}

/** What a behaviour-weighted score computation reports. */
export interface WeightedModResult {
  /** The final clamped multiplier — the ONLY value scoring may read. */
  mod: number;
  /** Every term that participated, in application order, pre-ranking. */
  contributions: SignalContribution[];
}

export type DecisionLayer = 'tactic' | 'action';

/**
 * §8 asks for the "top-2 contributing signals". Two is enough to make a recap
 * concrete without turning the prompt into a scoring dump — and a decision
 * driven by three roughly-equal terms has no crisp reason to report anyway.
 */
export const BECAUSE_SIGNAL_COUNT = 2;

/**
 * Hard cap on decisions retained per attempt. The log is bounded by *emitting
 * on decisions rather than ticks* — L2 re-scores every tick but only changes
 * intent every 2-5s, and L3 picks a move every second or so, so a 3-minute
 * fight produces tens of events, not ~10,800. This cap is the backstop for a
 * pathological attrition fight, so one row can never grow unbounded and one
 * prompt can never blow its context. Asserted in decisionLog.test.ts.
 */
export const MAX_LOGGED_DECISIONS = 400;

/** The player facts worth replaying a decision against. Recorded by the scene:
 * the boss sim cannot see hp or stamina, deliberately. */
export interface PlayerSnapshot {
  hp: number;
  stamina: number;
  /** Distance to the boss at the decision tick. */
  distance: number;
  /** The player's committed action id, or null if free. */
  action: string | null;
}

/** One L2 or L3 decision, exactly as BOSS_AI.md §8 specifies it. */
export interface DecisionEvent {
  tick: number;
  layer: DecisionLayer;
  /** The tactic name (L2) or move id (L3) that was chosen. */
  chose: string;
  /**
   * The top-2 terms behind `chose`, strongest first. Empty is meaningful and
   * honest: a PUNISH trigger fires on an opening rather than a signal, and a
   * combo link is picked from authored weights, so neither has a signal to
   * name. The recap must say "it read the opening", not invent a signal.
   */
  becauseSignals: SignalContribution[];
  playerStateSnapshot: PlayerSnapshot;
}

/**
 * Rank contributions by how far they moved the score away from neutral and
 * keep the strongest `n`.
 *
 * Inert terms (`effect === 1`) are dropped rather than padded in: a signal
 * sitting at zero did not contribute, and listing it would invite the recap to
 * claim it mattered. Ties break on signal name so the output is total-ordered
 * and the log stays byte-reproducible for a given seed — replay (§8's second
 * free win) is worthless if the log itself is only mostly deterministic.
 */
export function topContributions(
  contributions: SignalContribution[],
  n: number = BECAUSE_SIGNAL_COUNT,
): SignalContribution[] {
  return contributions
    .filter((c) => c.effect !== 1)
    .slice()
    .sort((a, b) => {
      const byStrength = Math.abs(b.effect - 1) - Math.abs(a.effect - 1);
      return byStrength !== 0 ? byStrength : a.signal.localeCompare(b.signal);
    })
    .slice(0, n);
}
