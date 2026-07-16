// Player-side combat simulation: a commitment-based action state machine
// stepped on the fixed 60-tick clock. Pure and Phaser-free (ADR-0001) — Phaser
// feeds it input each tick and renders the result; all rules live here.
//
// Design: docs/design/COMBAT_SYSTEM.md §2–5. Scope (issue #6): movement + the
// four core actions (light/heavy/dodge/block), dodge i-frames, and hit
// resolution. Stamina *regeneration*, poise/posture, and guard-break stagger
// arrive in #7 — this module exposes the hooks they build on.

import {
  ATTACK_DAMAGE,
  BASE_MAX_HP,
  BASE_MAX_STAMINA,
  BLOCK_DAMAGE_MULT,
  BLOCK_STAMINA_PER_HIT,
  FRAME_DATA,
  LIGHT_CHAIN_RECOVERY_STEP,
  LIGHT_MAX_CHAIN,
  MOVE_SPEED,
  dodgeIframes,
  type ActionId,
} from './frameData';
import type { PlayerBuild } from '../bridge';

export type Phase = 'startup' | 'active' | 'recovery' | 'hold';

export interface ActiveAction {
  id: ActionId;
  phase: Phase;
  /** Ticks elapsed in the current phase. */
  tickInPhase: number;
  /** Length of the current phase in ticks (may be build-adjusted, e.g. dodge). */
  phaseLength: number;
  /** 1-based position in a light-attack chain; 1 for non-light actions. */
  chainIndex: number;
}

export interface PlayerCombatState {
  x: number;
  facing: 1 | -1;
  hp: number;
  stamina: number;
  /** null == idle/free (can move and start actions). */
  action: ActiveAction | null;
}

export interface CombatInput {
  /** Movement intent this tick: -1 left, 0 none, 1 right. */
  moveX: -1 | 0 | 1;
  /** Edge-triggered attack/dodge intents (true only on the press tick). */
  light: boolean;
  heavy: boolean;
  dodge: boolean;
  /** Level-triggered: true for every tick the block key is held. */
  block: boolean;
}

export interface StepContext {
  build: PlayerBuild;
  /** Arena horizontal bounds the player is clamped within. */
  minX: number;
  maxX: number;
}

export type CombatEvent =
  | { type: 'action:start'; id: ActionId; chainIndex: number }
  | { type: 'action:end'; id: ActionId }
  | { type: 'attack:active'; id: 'light' | 'heavy'; chainIndex: number };

export interface StepResult {
  state: PlayerCombatState;
  events: CombatEvent[];
}

export function createPlayerState(x = 0): PlayerCombatState {
  return { x, facing: 1, hp: BASE_MAX_HP, stamina: BASE_MAX_STAMINA, action: null };
}

/** The player is invulnerable during a dodge's active (i-frame) window (§4). */
export function isInvulnerable(state: PlayerCombatState): boolean {
  return state.action?.id === 'dodge' && state.action.phase === 'active';
}

/** True while a completed block stance is up and absorbing hits. */
export function isBlocking(state: PlayerCombatState): boolean {
  return state.action?.id === 'block' && state.action.phase === 'hold';
}

function phaseLengthFor(
  id: ActionId,
  phase: Phase,
  chainIndex: number,
  build: PlayerBuild,
): number {
  const fd = FRAME_DATA[id];
  switch (phase) {
    case 'startup':
      return fd.startup;
    case 'active':
      return id === 'dodge' ? dodgeIframes(build.dexterity) : fd.active;
    case 'recovery':
      return id === 'light'
        ? fd.recovery + (chainIndex - 1) * LIGHT_CHAIN_RECOVERY_STEP
        : fd.recovery;
    case 'hold':
      return Infinity; // held until the block key is released
  }
}

function startAction(
  state: PlayerCombatState,
  id: ActionId,
  chainIndex: number,
  ctx: StepContext,
  events: CombatEvent[],
): void {
  state.stamina -= FRAME_DATA[id].stamina;
  state.action = {
    id,
    phase: 'startup',
    tickInPhase: 0,
    phaseLength: phaseLengthFor(id, 'startup', chainIndex, ctx.build),
    chainIndex,
  };
  events.push({ type: 'action:start', id, chainIndex });
}

function canAfford(state: PlayerCombatState, id: ActionId): boolean {
  return state.stamina >= FRAME_DATA[id].stamina;
}

/** Try to begin a new action from the given input. Returns true if one started. */
function tryStartFromInput(
  state: PlayerCombatState,
  input: CombatInput,
  ctx: StepContext,
  events: CombatEvent[],
): boolean {
  // Priority: dodge > heavy > light > block (dodge is the panic-out option).
  if (input.dodge && canAfford(state, 'dodge')) {
    startAction(state, 'dodge', 1, ctx, events);
    return true;
  }
  if (input.heavy && canAfford(state, 'heavy')) {
    startAction(state, 'heavy', 1, ctx, events);
    return true;
  }
  if (input.light && canAfford(state, 'light')) {
    startAction(state, 'light', 1, ctx, events);
    return true;
  }
  if (input.block) {
    startAction(state, 'block', 1, ctx, events);
    return true;
  }
  return false;
}

function advancePhase(
  state: PlayerCombatState,
  input: CombatInput,
  ctx: StepContext,
  events: CombatEvent[],
): void {
  const action = state.action!;

  // Block hold persists until the key is released; releasing enters recovery.
  if (action.phase === 'hold') {
    if (!input.block) {
      action.phase = 'recovery';
      action.tickInPhase = 0;
      action.phaseLength = phaseLengthFor(action.id, 'recovery', action.chainIndex, ctx.build);
    }
    return;
  }

  action.tickInPhase += 1;
  if (action.tickInPhase < action.phaseLength) return;

  // Current phase finished — advance to the next.
  const next: Record<Exclude<Phase, 'hold'>, Phase | 'end'> = {
    startup: action.id === 'block' ? 'hold' : 'active',
    active: 'recovery',
    recovery: 'end',
  };
  const target = next[action.phase as Exclude<Phase, 'hold'>];

  if (target === 'end') {
    const finished = action.id;
    state.action = null;
    events.push({ type: 'action:end', id: finished });
    return;
  }

  action.phase = target;
  action.tickInPhase = 0;
  action.phaseLength = phaseLengthFor(action.id, target, action.chainIndex, ctx.build);
  if (target === 'active' && (action.id === 'light' || action.id === 'heavy')) {
    events.push({ type: 'attack:active', id: action.id, chainIndex: action.chainIndex });
  }
}

/**
 * Advance the simulation by one tick.
 *
 * Free (idle) → movement and new actions are allowed. Mid-action → the player
 * is committed; the only exception is chaining a light attack during its
 * recovery.
 */
export function step(prev: PlayerCombatState, input: CombatInput, ctx: StepContext): StepResult {
  const state: PlayerCombatState = { ...prev, action: prev.action ? { ...prev.action } : null };
  const events: CombatEvent[] = [];

  if (state.action === null) {
    if (!tryStartFromInput(state, input, ctx, events)) {
      // Idle: free movement.
      if (input.moveX !== 0) {
        state.facing = input.moveX > 0 ? 1 : -1;
        state.x = Math.max(ctx.minX, Math.min(ctx.maxX, state.x + input.moveX * MOVE_SPEED));
      }
    }
    return { state, events };
  }

  // Light-attack chaining: a light press during a light's recovery starts the
  // next chain step (bounded by LIGHT_MAX_CHAIN and stamina), extending pressure.
  if (
    state.action.id === 'light' &&
    state.action.phase === 'recovery' &&
    input.light &&
    state.action.chainIndex < LIGHT_MAX_CHAIN &&
    canAfford(state, 'light')
  ) {
    startAction(state, 'light', state.action.chainIndex + 1, ctx, events);
    return { state, events };
  }

  advancePhase(state, input, ctx, events);
  return { state, events };
}

export type HitResult = 'dodged' | 'blocked' | 'hit';

export interface IncomingHit {
  hp: number;
  poise: number;
}

export interface HitResolution {
  state: PlayerCombatState;
  result: HitResult;
  /** HP actually lost after i-frames/blocking. */
  hpLost: number;
  /** True when a block emptied the stamina bar (guard break — stagger is #7). */
  guardBroken: boolean;
}

/** Resolve an incoming attack against the player's current defensive state. */
export function resolveIncomingHit(
  prev: PlayerCombatState,
  incoming: IncomingHit,
  _build: PlayerBuild,
): HitResolution {
  const state: PlayerCombatState = { ...prev, action: prev.action ? { ...prev.action } : null };

  if (isInvulnerable(state)) {
    return { state, result: 'dodged', hpLost: 0, guardBroken: false };
  }

  if (isBlocking(state)) {
    const hpLost = incoming.hp * BLOCK_DAMAGE_MULT;
    state.hp = Math.max(0, state.hp - hpLost);
    state.stamina = Math.max(0, state.stamina - BLOCK_STAMINA_PER_HIT);
    return { state, result: 'blocked', hpLost, guardBroken: state.stamina === 0 };
  }

  state.hp = Math.max(0, state.hp - incoming.hp);
  return { state, result: 'hit', hpLost: incoming.hp, guardBroken: false };
}

export { ATTACK_DAMAGE };
