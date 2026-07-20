// L3 — action selection (BOSS_AI.md §4). Given the current move table, range
// to the player, and selection state, decide what the boss does next.
//
// Fairness is enforced by construction here: F3 (chain cap), F7 (grabs never
// combo — guaranteed by data, not re-checked here), F8 (no 3rd consecutive
// repeat). F1/F2's static shape is validated by moveSchema.ts; F2's *runtime*
// enforcement (the gap itself) lives here via gapTicksRemaining.
//
// L2 tactic filtering (#9) is not implemented yet — every move in the phase's
// top-level table is considered regardless of `tactics`, matching Sprint 2's
// documented scope.

import { MIN_INTER_SEQUENCE_GAP_TICKS } from './moveSchema';
import { weightedPick, type RngState } from './rng';
import type { MoveTable, PlayerActionTag, Tactic } from './types';
import { behaviorMod, type WeightRule } from './weighting';
import type { BehaviorSignals } from './behaviorTracker';

export interface SelectionState {
  rng: RngState;
  cooldowns: Record<string, number>;
  /** 0 = not mid-sequence (idle, ready for a fresh top-level pick). */
  chainDepth: number;
  /** Most-recent-last selection history, capped — only the last 2 matter for F8. */
  recentMoves: string[];
  /** F2: ticks remaining before a NEW sequence may start. Chain continuations
   * ignore this — the gap is between sequences, not between a sequence's own hits. */
  gapTicksRemaining: number;
}

const RECENT_HISTORY_CAP = 4;

export function createSelectionState(rng: RngState): SelectionState {
  return { rng, cooldowns: {}, chainDepth: 0, recentMoves: [], gapTicksRemaining: 0 };
}

/** Advance cooldowns and the inter-sequence gap by one tick. */
export function tickSelectionState(state: SelectionState): SelectionState {
  const cooldowns: Record<string, number> = {};
  for (const [id, ticks] of Object.entries(state.cooldowns)) {
    if (ticks > 1) cooldowns[id] = ticks - 1;
  }
  return { ...state, cooldowns, gapTicksRemaining: Math.max(0, state.gapTicksRemaining - 1) };
}

function inRange(band: [number, number], distance: number): boolean {
  return distance >= band[0] && distance <= band[1];
}

/** F8 — would picking `id` be this move's 3rd consecutive appearance? */
function wouldViolateF8(id: string, recentMoves: string[]): boolean {
  const last = recentMoves.slice(-2);
  return last.length === 2 && last[0] === id && last[1] === id;
}

function recordPick(state: SelectionState, id: string, cooldownTicks: number): SelectionState {
  return {
    ...state,
    cooldowns: { ...state.cooldowns, [id]: cooldownTicks },
    recentMoves: [...state.recentMoves, id].slice(-RECENT_HISTORY_CAP),
  };
}

export type SelectionResult =
  | { kind: 'move'; moveId: string; state: SelectionState }
  | { kind: 'sequence-end'; state: SelectionState }
  /** Mid-gap (F2) or nothing eligible: no decision this tick, just approach. */
  | { kind: 'no-action'; state: SelectionState };

/** The adaptation inputs to a top-level pick (BOSS_AI.md §4-§5). Optional so
 * the pipeline degrades to flat weights when no tracker/tactic exists (tests,
 * future bosses before their weighting data is authored). */
export interface SelectionWeighting {
  tactic: Tactic;
  signals: BehaviorSignals;
  rules: WeightRule[];
}

/**
 * A fresh top-level pick — called when the boss is idle and not continuing a
 * combo (lastMoveId is null, or the last move had no `combo` field).
 *
 * With `weighting` present, the §4 pipeline runs in full: the eligible set is
 * intersected with moves expressing the current tactic (falling back to the
 * un-filtered eligible set when the intersection is empty, per the spec's
 * fallback rule), and each move's weight is base(1) × behaviorMod (F4-clamped).
 */
export function selectTopLevel(
  table: MoveTable,
  topLevelIds: string[],
  distance: number,
  state: SelectionState,
  weighting?: SelectionWeighting,
): SelectionResult {
  if (state.gapTicksRemaining > 0) {
    return { kind: 'no-action', state };
  }

  const eligible = topLevelIds.filter((id) => {
    const move = table[id];
    return (
      inRange(move.rangeBand, distance) &&
      (state.cooldowns[id] ?? 0) === 0 &&
      !wouldViolateF8(id, state.recentMoves)
    );
  });

  if (eligible.length === 0) {
    return { kind: 'no-action', state };
  }

  // Tactic filter (§4): prefer moves expressing the current intent; if none
  // do, fall back to the whole eligible set rather than stalling.
  let pool = eligible;
  if (weighting) {
    const tacticMatched = eligible.filter((id) => table[id].tactics.includes(weighting.tactic));
    if (tacticMatched.length > 0) pool = tacticMatched;
  }

  const options = pool.map((id) => ({
    item: id,
    weight: weighting ? behaviorMod(table[id], weighting.signals, weighting.rules) : 1,
  }));
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);

  const [picked, nextRng] = weightedPick(options, totalWeight, state.rng);
  const chosen = picked!; // pool is non-empty and weights sum exactly to totalWeight
  const withRng = { ...state, rng: nextRng };
  return {
    kind: 'move',
    moveId: chosen,
    state: { ...recordPick(withRng, chosen, table[chosen].cooldownTicks), chainDepth: 1 },
  };
}

/**
 * A combo branch decision — called when `lastMoveId`'s recovery just ended
 * and it declares a `combo`. If chainDepth already hit maxChain, or nothing
 * eligible, the sequence ends (F3, by construction).
 *
 * `lastPlayerAction` is what the player did against `lastMoveId`'s own hit
 * (dodge/block/null) — it's what a link's `condition` checks (e.g. "only
 * branch to the punish if they dodged"). Distinct from the behavior tracker's
 * rolling signals: this is the single most-recent concrete outcome.
 */
export function selectComboBranch(
  table: MoveTable,
  distance: number,
  lastMoveId: string,
  state: SelectionState,
  lastPlayerAction: PlayerActionTag | null,
): SelectionResult {
  const lastMove = table[lastMoveId];
  const combo = lastMove.combo;
  if (!combo || state.chainDepth >= combo.maxChain) {
    return {
      kind: 'sequence-end',
      state: { ...state, chainDepth: 0, gapTicksRemaining: MIN_INTER_SEQUENCE_GAP_TICKS },
    };
  }

  const eligible = combo.next.filter((link) => {
    const move = table[link.move];
    return (
      move !== undefined &&
      inRange(move.rangeBand, distance) &&
      (state.cooldowns[link.move] ?? 0) === 0 &&
      !wouldViolateF8(link.move, state.recentMoves) &&
      (!link.condition || link.condition.playerAction === lastPlayerAction)
    );
  });

  // Weights are authored as fractions of 1; unclaimed mass (filtered-out
  // links, or the sequence's own designed "end" probability) means "stop".
  const [picked, nextRng] = weightedPick(
    eligible.map((l) => ({ item: l.move, weight: l.weight })),
    1,
    state.rng,
  );
  const withRng = { ...state, rng: nextRng };

  if (picked === null) {
    return {
      kind: 'sequence-end',
      state: { ...withRng, chainDepth: 0, gapTicksRemaining: MIN_INTER_SEQUENCE_GAP_TICKS },
    };
  }
  return {
    kind: 'move',
    moveId: picked,
    state: {
      ...recordPick(withRng, picked, table[picked].cooldownTicks),
      chainDepth: state.chainDepth + 1,
    },
  };
}
