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
  RECOVER: 0.4,
};

/**
 * behaviorMod for tactics (spec §3/§5): how each signal scales each tactic's
 * score. Clamped to [0.25, 4] (F4). The table is data so tuning is a data
 * change with a unit test.
 */
function tacticBehaviorMod(tactic: ScoredTactic, s: BehaviorSignals, ctx: TacticContext): number {
  let mod = 1;
  switch (tactic) {
    case 'PRESSURE':
      mod *= 1 + s.turtleIndex * 2; // turtling invites pressure
      mod *= 1 + (1 - s.aggression) * 0.5; // passivity too
      break;
    case 'BAIT':
      mod *= 1 + s.dodgeReflex * 3; // panic-rollers get baited
      break;
    case 'REPOSITION':
      mod *= 1 + s.rangeCamping * 2.5; // campers get closed down
      if (ctx.distance > 160) mod *= 1.5;
      break;
    case 'RECOVER':
      mod *= 1 + ctx.bossPoiseFraction * 1.5 + ctx.bossPostureFraction * 1.5;
      break;
    case 'NEUTRAL':
      mod *= 1 + s.dodgeTiming * 0.5; // good dodgers get a faster reset pace
      break;
  }
  return Math.max(0.25, Math.min(4, mod));
}

export interface TacticDecision {
  state: TacticState;
  /** True when the tactic changed this tick. */
  changed: boolean;
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
    return { state, changed: true };
  }

  if (state.ticksInTactic < state.holdTicks) {
    return { state, changed: false };
  }

  // Hold expired: softmax over the scoreable tactics (PUNISH excluded by
  // type). Deterministic given (rng, signals, ctx).
  const signals = getSignals();
  const candidates = Object.keys(BASE_SCORE) as ScoredTactic[];
  const scores = candidates.map((t) => BASE_SCORE[t] * tacticBehaviorMod(t, signals, ctx));
  const maxScore = Math.max(...scores);
  const exps = scores.map((sc) => Math.exp((sc - maxScore) / TACTIC_SOFTMAX_TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0);

  const [rawRoll, rng] = nextRandom(state.rng);
  let roll = rawRoll * total;
  let picked = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i++) {
    roll -= exps[i];
    if (roll <= 0) {
      picked = candidates[i];
      break;
    }
  }

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
  return { state, changed };
}
