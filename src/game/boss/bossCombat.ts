// The boss entity's per-tick simulation: drives frame progression from
// data-driven MoveDefs (L3), calls into the L2 decision points (currently
// stubbed to always-NEUTRAL — #9), and resolves hits taken via the shared
// poise core (combat/poise.ts) plus the boss-only posture meter (combat/posture.ts).
//
// Phaser-free (ADR-0001). CombatScene drives this exactly like playerCombat's
// step(): sample state, call step(), render the result.

import {
  applyPostureDamage,
  createPostureState,
  isCriticalWindowOpen,
  tickPosture,
  type PostureState,
} from '../combat/posture';
import { applyUndefendedHit, tickPoiseDecay } from '../combat/poise';
import { MIN_INTER_SEQUENCE_GAP_TICKS } from './moveSchema';
import { clamp } from '../util';
import {
  createSelectionState,
  selectComboBranch,
  selectTopLevel,
  tickSelectionState,
  type SelectionState,
} from './actionSelection';
import {
  BOSS_BASE_MAX_HP,
  BOSS_MOVE_SPEED,
  BOSS_POISE_STAGGER_TICKS,
  BOSS_POISE_THRESHOLD,
  BOSS_PREFERRED_RANGE,
  CRITICAL_HIT_MULTIPLIER,
} from './bossTuning';
import type { MoveDef, MoveTable, PlayerActionTag } from './types';

export type BossPhase = 'startup' | 'active' | 'recovery';

export interface BossActiveMove {
  moveId: string;
  phase: BossPhase;
  tickInPhase: number;
}

export interface BossCombatState {
  x: number;
  facing: 1 | -1;
  hp: number;
  poiseDamage: number;
  posture: PostureState;
  action: BossActiveMove | null;
  staggerTicks: number;
  selection: SelectionState;
}

export function createBossState(x: number, seed: number): BossCombatState {
  return {
    x,
    facing: -1,
    hp: BOSS_BASE_MAX_HP,
    poiseDamage: 0,
    posture: createPostureState(),
    action: null,
    staggerTicks: 0,
    selection: createSelectionState(seed >>> 0),
  };
}

export function isBossStaggered(state: BossCombatState): boolean {
  return state.staggerTicks > 0;
}

export interface BossStepContext {
  table: MoveTable;
  topLevelIds: string[];
  playerX: number;
  minX: number;
  maxX: number;
  /** What the player did against the boss's most recent hit — feeds combo
   * branch conditions (e.g. "only punish if they dodged"). null if the last
   * attack never connected, or nothing's happened yet. */
  lastPlayerAction: PlayerActionTag | null;
}

export type BossEvent =
  | { type: 'move:start'; moveId: string }
  | { type: 'move:active'; moveId: string; move: MoveDef }
  | { type: 'move:end'; moveId: string }
  | { type: 'stagger:start' }
  | { type: 'stagger:end' }
  | { type: 'posture:break' }
  | { type: 'posture:recovered' };

function startMove(state: BossCombatState, moveId: string, events: BossEvent[]): void {
  state.action = { moveId, phase: 'startup', tickInPhase: 0 };
  events.push({ type: 'move:start', moveId });
}

export function step(
  prev: BossCombatState,
  ctx: BossStepContext,
): { state: BossCombatState; events: BossEvent[] } {
  const state: BossCombatState = {
    ...prev,
    action: prev.action ? { ...prev.action } : null,
    posture: { ...prev.posture },
  };
  const events: BossEvent[] = [];

  // Passive per-tick decay (mirrors playerCombat.step). Cooldowns and the F2
  // gap advance unconditionally, every tick, regardless of what the boss is
  // doing — a move mid-execution, staggered, or collapsed all still cost real
  // time (cooldowns are wall-clock timers, not "boss is free to act" timers).
  state.poiseDamage = tickPoiseDecay(state.poiseDamage);
  const postureTick = tickPosture(state.posture);
  state.posture = postureTick.state;
  if (postureTick.event === 'critical-expired') events.push({ type: 'posture:recovered' });
  state.selection = tickSelectionState(state.selection);

  if (state.staggerTicks > 0) {
    state.staggerTicks -= 1;
    if (state.staggerTicks === 0) events.push({ type: 'stagger:end' });
    return { state, events };
  }

  // Collapsed from a posture break: frozen, immune to further interruption,
  // takes only the eventual critical hit (resolveBossHit handles that).
  if (isCriticalWindowOpen(state.posture)) {
    return { state, events };
  }

  const distance = Math.abs(ctx.playerX - state.x);

  if (state.action === null) {
    const result = selectTopLevel(ctx.table, ctx.topLevelIds, distance, state.selection);
    state.selection = result.state;
    if (result.kind === 'move') {
      startMove(state, result.moveId, events);
    } else {
      approach(state, ctx, distance);
    }
    return { state, events };
  }

  const move = ctx.table[state.action.moveId];
  const action = state.action;
  action.tickInPhase += 1;

  const phaseLength =
    action.phase === 'startup'
      ? move.frames.startup
      : action.phase === 'active'
        ? move.frames.active
        : move.frames.recovery;

  if (action.tickInPhase < phaseLength) {
    return { state, events };
  }

  if (action.phase === 'startup') {
    action.phase = 'active';
    action.tickInPhase = 0;
    events.push({ type: 'move:active', moveId: action.moveId, move });
    return { state, events };
  }

  if (action.phase === 'active') {
    action.phase = 'recovery';
    action.tickInPhase = 0;
    return { state, events };
  }

  // Recovery just finished: decide the next branch point (combo continuation
  // or a fresh top-level pick) — the L3 decision at the natural seam.
  const finishedId = action.moveId;
  state.action = null;
  events.push({ type: 'move:end', moveId: finishedId });

  // A single move with no `combo` field is a one-move sequence — it still
  // owes the F2 gap before the next sequence may start, same as a chain that
  // ran out of branches.
  const branch = move.combo
    ? selectComboBranch(ctx.table, distance, finishedId, state.selection, ctx.lastPlayerAction)
    : {
        kind: 'sequence-end' as const,
        state: {
          ...state.selection,
          chainDepth: 0,
          gapTicksRemaining: MIN_INTER_SEQUENCE_GAP_TICKS,
        },
      };
  state.selection = branch.state;

  if (branch.kind === 'move') {
    startMove(state, branch.moveId, events);
  } else {
    approach(state, ctx, distance);
  }

  return { state, events };
}

function approach(state: BossCombatState, ctx: BossStepContext, distance: number): void {
  if (distance > BOSS_PREFERRED_RANGE) {
    const dir = ctx.playerX >= state.x ? 1 : -1;
    state.facing = dir;
    state.x = clamp(state.x + dir * BOSS_MOVE_SPEED, ctx.minX, ctx.maxX);
  } else {
    state.facing = ctx.playerX >= state.x ? 1 : -1;
  }
}

export interface BossHitResolution {
  state: BossCombatState;
  wasCritical: boolean;
  poiseBroken: boolean;
  events: BossEvent[];
}

/**
 * Resolve a player attack landing on the boss. Pure — CombatScene supplies
 * the numbers (including any punish bonus from the move being punished
 * mid-recovery); this function only knows poise/posture/critical mechanics.
 */
export function resolveBossHit(
  prev: BossCombatState,
  incoming: { hp: number; poise: number; postureDamage: number },
): BossHitResolution {
  const state: BossCombatState = {
    ...prev,
    posture: { ...prev.posture },
    action: prev.action ? { ...prev.action } : null,
  };
  const events: BossEvent[] = [];

  if (isCriticalWindowOpen(state.posture)) {
    state.hp = Math.max(0, state.hp - incoming.hp * CRITICAL_HIT_MULTIPLIER);
    return { state, wasCritical: true, poiseBroken: false, events };
  }

  const hit = applyUndefendedHit(state, incoming, BOSS_POISE_THRESHOLD);
  state.hp = hit.hp;
  state.poiseDamage = hit.poiseDamage;

  if (hit.poiseBroken) {
    state.staggerTicks = BOSS_POISE_STAGGER_TICKS;
    state.action = null;
    // An interrupt ends the sequence early, same as running out of combo
    // branches or finishing a no-combo move — it still owes the F2 gap
    // before a fresh sequence may start (fairness invariant, not just a
    // between-sequences courtesy for moves that finish cleanly).
    state.selection = {
      ...state.selection,
      chainDepth: 0,
      gapTicksRemaining: MIN_INTER_SEQUENCE_GAP_TICKS,
    };
    events.push({ type: 'stagger:start' });
  }

  const posture = applyPostureDamage(state.posture, incoming.postureDamage);
  state.posture = posture.state;
  if (posture.event === 'break') events.push({ type: 'posture:break' });

  return { state, wasCritical: false, poiseBroken: hit.poiseBroken, events };
}
