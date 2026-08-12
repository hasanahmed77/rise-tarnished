// L2 — the tactic machine (BOSS_AI.md §3): the boss's *intent* layer, running
// at a 2–8s cadence between L1 phases and L3 action picks. Signals from the
// behavior tracker score the eligible tactics; a seeded softmax picks one.
//
// PUNISH is special: it has trigger priority (interrupts any other tactic's
// *decision*, never an in-flight animation) and is rate-limited by F5 so the
// boss punishes patterns, not every mistake.
//
// Engine-free, deterministic, data-driven scoring.

import { TICKS_PER_SECOND } from '../combat/frameData';
import { nextRandom, type RngState } from './rng';
import type { BehaviorSignals } from './behaviorTracker';
import type { SignalContribution, WeightedModResult } from './decisionLog';
import { topContributions } from './decisionLog';
import type { Tactic } from './types';

/** F5 — max one triggered punish per 4 seconds. */
export const PUNISH_COOLDOWN_TICKS = 4 * TICKS_PER_SECOND;
/** A tactic holds for 2–5s before re-scoring (spec §3 NEUTRAL row; v1 uses one
 * band for all tactics — per-tactic bands are tuning, not structure). */
export const TACTIC_MIN_HOLD_TICKS = 2 * TICKS_PER_SECOND;
export const TACTIC_MAX_HOLD_TICKS = 5 * TICKS_PER_SECOND;
/** Softmax temperature — lower = more decisive. Per-boss tuning later (§10). */
export const TACTIC_SOFTMAX_TEMPERATURE = 0.35;

/** Situational facts the tactic layer reads besides the rolling signals. */
export interface TacticContext {
  distance: number;
  bossPoiseFraction: number; // accumulated poiseDamage / threshold, 0..1+
  bossPostureFraction: number; // posture.value / cap, 0..1
  /** The player is mid-heal or mid-whiffed-heavy within punish range NOW. */
  punishableOpening: boolean;
}

export interface TacticState {
  current: Tactic;
  ticksInTactic: number;
  holdTicks: number;
  punishCooldown: number;
  rng: RngState;
}

export function createTacticState(rng: RngState): TacticState {
  return {
    current: 'NEUTRAL',
    ticksInTactic: 0,
    holdTicks: TACTIC_MIN_HOLD_TICKS,
    punishCooldown: 0,
    rng,
  };
}

/** Tactics that can be *scored into* at a re-decision. PUNISH is excluded by
 * type: it is trigger-only (entered solely via its opening + F5 gate), so a
 * tuner can't mistakenly give it a base score that would silently do nothing. */
type ScoredTactic = Exclude<Tactic, 'PUNISH'>;

/** Base scores per scoreable tactic before behavior weighting. Data, not code. */
const BASE_SCORE: Record<ScoredTactic, number> = {
  NEUTRAL: 1.0,
  PRESSURE: 0.7,
  BAIT: 0.6,
  REPOSITION: 0.5,
  // Raised from 0.4: even with its behaviour terms firing, RECOVER couldn't
  // outscore NEUTRAL, so the boss had no reachable "back off and breathe"
  // state. It needs to be able to win a re-score, not merely exist — but
  // only just. The softmax temperature is low enough (0.35) that a tactic
  // scoring clearly above the field takes ~75% of the fight's time, so this
  // is deliberately set to land RECOVER *level with* NEUTRAL at zero player
  // aggression, not above it: the goal is a boss that lets up, not one that
  // stops fighting. Measured shares are asserted in tactics.test.ts.
  RECOVER: 0.5,
};

/**
 * behaviorMod for tactics (spec §3/§5): how each signal scales each tactic's
 * score. Clamped to [0.25, 4] (F4). The table is data so tuning is a data
 * change with a unit test.
 */
function tacticBehaviorModDetailed(
  tactic: ScoredTactic,
  s: BehaviorSignals,
  ctx: TacticContext,
): WeightedModResult {
  let mod = 1;
  const contributions: SignalContribution[] = [];
  /** Apply one term and record it. Every `mod *=` below goes through here, so
   * the log cannot describe a term the score didn't actually apply (#55). */
  const apply = (signal: string, value: number, effect: number) => {
    mod *= effect;
    contributions.push({ signal, value, effect });
  };

  switch (tactic) {
    case 'PRESSURE':
      apply('turtleIndex', s.turtleIndex, 1 + s.turtleIndex * 2); // turtling invites pressure
      // NOTE: deliberately does NOT escalate on low `aggression`. It used to
      // (`1 + (1 - aggression) * 0.5`) and that closed a feedback loop against
      // the player: no opening → attack rate falls → aggression falls →
      // PRESSURE scores higher → boss crowds to range 45 → still no opening.
      // With the softmax this decisive, PRESSURE then won ~every re-score and
      // the fight never let up. `turtleIndex` above already covers deliberate
      // defence, and it reads *blocking* — a chosen action. Low aggression is
      // ambiguous ("passive by choice" vs "given no room"), so escalating on
      // it makes the ambiguity self-reinforcing. Same shape as the
      // rangeCamping loop called out in bossCombat.ts's TACTIC_TARGET_RANGE.
      break;
    case 'BAIT':
      apply('dodgeReflex', s.dodgeReflex, 1 + s.dodgeReflex * 3); // panic-rollers get baited
      break;
    case 'REPOSITION':
      apply('rangeCamping', s.rangeCamping, 1 + s.rangeCamping * 2.5); // campers get closed down
      if (ctx.distance > 160) apply('distance', ctx.distance, 1.5);
      break;
    case 'RECOVER': {
      // ONE factor over a SUM of the two damage terms — not two factors. Split
      // into `apply` calls per term this would become (1+a)(1+b) and silently
      // re-tune the boss, so the shared factor is applied once and the two
      // terms are attributed individually for ranking only.
      const damageTaken = 1 + ctx.bossPoiseFraction * 1.5 + ctx.bossPostureFraction * 1.5;
      mod *= damageTaken;
      contributions.push(
        {
          signal: 'bossPoise',
          value: ctx.bossPoiseFraction,
          effect: 1 + ctx.bossPoiseFraction * 1.5,
        },
        {
          signal: 'bossPosture',
          value: ctx.bossPostureFraction,
          effect: 1 + ctx.bossPostureFraction * 1.5,
        },
      );
      // The mirror of PRESSURE's removed term, and the reason the fight has a
      // pulse: when the player's attack rate is low, the boss eases off and
      // gives them room. Gating relief solely on damage the boss has taken
      // (the two terms above) meant relief only arrived as a reward for
      // already winning — exactly backwards when a player is being smothered.
      // Self-correcting: land hits and aggression climbs, this term decays,
      // and pressure returns on its own.
      apply('aggression', s.aggression, 1 + (1 - s.aggression) * 1.0);
      break;
    }
    case 'NEUTRAL':
      apply('dodgeTiming', s.dodgeTiming, 1 + s.dodgeTiming * 0.5); // faster reset pace
      break;
  }
  return { mod: Math.max(0.25, Math.min(4, mod)), contributions };
}

export interface TacticDecision {
  state: TacticState;
  /** True when the tactic changed this tick. */
  changed: boolean;
  /**
   * The top-2 terms behind the newly-picked tactic (#55, BOSS_AI.md §8).
   * Only populated on the tick a change happens — a hold costs nothing.
   *
   * Empty for a PUNISH entry, and that is the accurate answer rather than a
   * gap: PUNISH is trigger-only (§3), entered from an opening plus the F5
   * gate, never scored. There is no signal to name, and inventing one is the
   * exact failure #13's recap has to avoid.
   */
  because: SignalContribution[];
}

/**
 * Advance one tick. Re-scores when the hold expires; PUNISH pre-empts any
 * decision immediately when its trigger fires (and F5 allows).
 *
 * `getSignals` is a thunk: signal reduction over the tracker window is only
 * paid on the ticks that actually re-score (every 2–5s), not at 60Hz.
 */
export function tickTactic(
  prev: TacticState,
  getSignals: () => BehaviorSignals,
  ctx: TacticContext,
): TacticDecision {
  const state: TacticState = { ...prev };
  state.ticksInTactic += 1;
  state.punishCooldown = Math.max(0, state.punishCooldown - 1);

  // PUNISH trigger priority (§3), rate-limited (F5). It replaces the current
  // *intent* immediately; L3 still never interrupts an in-flight boss move.
  if (ctx.punishableOpening && state.punishCooldown === 0 && state.current !== 'PUNISH') {
    state.current = 'PUNISH';
    state.ticksInTactic = 0;
    state.holdTicks = TACTIC_MIN_HOLD_TICKS;
    state.punishCooldown = PUNISH_COOLDOWN_TICKS;
    return { state, changed: true, because: [] };
  }

  if (state.ticksInTactic < state.holdTicks) {
    return { state, changed: false, because: [] };
  }

  // Hold expired: softmax over the scoreable tactics (PUNISH excluded by
  // type). Deterministic given (rng, signals, ctx).
  const signals = getSignals();
  const candidates = Object.keys(BASE_SCORE) as ScoredTactic[];
  // Detailed once per candidate; `.mod` is what scores. Reusing the same
  // objects for the winner's `because` means the logged reason is literally
  // the arithmetic that won, not a second pass over the same inputs.
  const details = candidates.map((t) => tacticBehaviorModDetailed(t, signals, ctx));
  const scores = candidates.map((t, i) => BASE_SCORE[t] * details[i].mod);
  const maxScore = Math.max(...scores);
  const exps = scores.map((sc) => Math.exp((sc - maxScore) / TACTIC_SOFTMAX_TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0);

  const [rawRoll, rng] = nextRandom(state.rng);
  let roll = rawRoll * total;
  let pickedIndex = candidates.length - 1;
  for (let i = 0; i < candidates.length; i++) {
    roll -= exps[i];
    if (roll <= 0) {
      pickedIndex = i;
      break;
    }
  }
  const picked = candidates[pickedIndex];

  // Hold duration for the new tactic: deterministic draw in [min, max].
  const [holdRoll, rng2] = nextRandom(rng);
  const holdTicks = Math.floor(
    TACTIC_MIN_HOLD_TICKS + holdRoll * (TACTIC_MAX_HOLD_TICKS - TACTIC_MIN_HOLD_TICKS),
  );

  const changed = picked !== state.current;
  state.current = picked;
  state.ticksInTactic = 0;
  state.holdTicks = holdTicks;
  state.rng = rng2;
  // Only ranked when the intent actually changed — a re-score that lands on
  // the same tactic is not a decision worth a log line (#55's bounding rule).
  return {
    state,
    changed,
    because: changed ? topContributions(details[pickedIndex].contributions) : [],
  };
}
