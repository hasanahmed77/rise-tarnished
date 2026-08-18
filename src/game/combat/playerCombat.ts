// Player-side combat simulation: a commitment-based action state machine
// stepped on the fixed 60-tick clock. Pure and Phaser-free (ADR-0001) — Phaser
// feeds it input each tick and renders the result; all rules live here.
//
// Design: docs/design/COMBAT_SYSTEM.md §2–5. Scope (issue #6): movement + the
// four core actions (light/heavy/dodge/block), dodge i-frames, and hit
// resolution. Stamina *regeneration*, poise/posture, and guard-break stagger
// arrive in #7 — this module exposes the hooks they build on.

import {
  BASE_POISE,
  BLOCK_DAMAGE_MULT,
  BLOCK_STAMINA_PER_HIT,
  FP_REGEN_DELAY_TICKS,
  FP_REGEN_PER_TICK,
  FRAME_DATA,
  GUARD_BREAK_STAGGER_TICKS,
  INPUT_BUFFER_TICKS,
  LIGHT_CHAIN_RECOVERY_STEP,
  LIGHT_MAX_CHAIN,
  MOVE_SPEED,
  POISE_PER_VITALITY,
  POISE_STAGGER_TICKS,
  SORCERY_POISE_DAMAGE,
  SORCERY_PROJECTILE_HALF_WIDTH,
  SORCERY_PROJECTILE_MAX_TICKS,
  SORCERY_PROJECTILE_SPEED,
  STAMINA_REGEN_DELAY_TICKS,
  STAMINA_REGEN_PER_TICK,
  dodgeIframes,
  maxFp,
  maxHp,
  maxStamina,
  sorceryDamage,
  type ActionId,
} from './frameData';
import { applyUndefendedHit, tickPoiseDecay } from './poise';
import { clamp } from '../util';
import type { PlayerBuild } from '../bridge';

export type Phase = 'startup' | 'active' | 'recovery' | 'hold';

// Fixed phase-transition graph (hoisted out of the per-tick hot path). Block
// routes startup → hold; everything else startup → active → recovery → end.
const NEXT_PHASE: Record<Exclude<Phase, 'hold'>, Phase | 'end'> = {
  startup: 'active',
  active: 'recovery',
  recovery: 'end',
};

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

/** A live sorcery projectile (#40). Travels deterministically in `facing`,
 * carrying the int-scaled damage computed at spawn, until it hits or fizzles.
 * Cross-entity hit resolution is the scene's job (as with melee) via the pure
 * `projectileHits` predicate below. */
export interface Projectile {
  id: number;
  x: number;
  facing: 1 | -1;
  ticksAlive: number;
  /** HP damage locked in at cast time from the caster's intelligence. */
  damage: number;
}

/** Edge-triggered intents — the ones that can be dropped by landing on a
 * tick the player can't act (#20). `block` is level-triggered (held) and
 * never needs buffering: `advancePhase`'s hold-release check reads it live
 * every tick, so there's no single edge to miss. */
type EdgeAction = 'dodge' | 'cast' | 'heavy' | 'light';

/** Ticks remaining in each edge intent's buffer window; 0 = not buffered.
 * Counts down every tick regardless of what the player is doing (mid-action,
 * staggered) — see `updateInputBuffer`'s comment for why that's one rule
 * instead of a special case per boundary. */
export type InputBuffer = Record<EdgeAction, number>;

function emptyInputBuffer(): InputBuffer {
  return { dodge: 0, cast: 0, heavy: 0, light: 0 };
}

export interface PlayerCombatState {
  x: number;
  facing: 1 | -1;
  hp: number;
  stamina: number;
  /** Focus points — the caster's resource (#40). */
  fp: number;
  /** null == idle/free (can move and start actions). */
  action: ActiveAction | null;
  /** Accumulated poise damage; decays over time, staggers past threshold. */
  poiseDamage: number;
  /** Ticks of stagger remaining. While > 0: no actions, no movement, fully
   * vulnerable, and any in-flight action has been interrupted. */
  staggerTicks: number;
  /** Ticks since stamina was last spent (drives the regen delay). */
  ticksSinceStaminaSpend: number;
  /** Ticks since FP was last spent (drives FP regen delay). */
  ticksSinceFpSpend: number;
  /** In-flight sorcery projectiles, advanced each tick. */
  projectiles: Projectile[];
  /** Monotonic id source so the scene can identify a projectile to consume. */
  nextProjectileId: number;
  /** #20 — the input buffer. See InputBuffer's comment. */
  inputBuffer: InputBuffer;
}

export interface CombatInput {
  /** Movement intent this tick: -1 left, 0 none, 1 right. */
  moveX: -1 | 0 | 1;
  /** Edge-triggered attack/dodge/cast intents (true only on the press tick). */
  light: boolean;
  heavy: boolean;
  dodge: boolean;
  cast: boolean;
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
  | { type: 'attack:active'; id: 'light' | 'heavy'; chainIndex: number }
  | { type: 'projectile:spawn'; id: number }
  | { type: 'projectile:fizzle'; id: number }
  | { type: 'stagger:start'; ticks: number; cause: 'poise' | 'guard-break' }
  | { type: 'stagger:end' };

export interface StepResult {
  state: PlayerCombatState;
  events: CombatEvent[];
}

export function createPlayerState(x = 0, build?: PlayerBuild): PlayerCombatState {
  return {
    x,
    facing: 1,
    // Start with full pools for whatever build is fighting; defaults to the
    // base pools when no build is supplied (callers that don't need one).
    hp: maxHp(build?.vitality ?? 0),
    stamina: maxStamina(build?.vitality ?? 0),
    fp: build ? maxFp(build.intelligence) : maxFp(0),
    action: null,
    poiseDamage: 0,
    staggerTicks: 0,
    ticksSinceStaminaSpend: STAMINA_REGEN_DELAY_TICKS,
    ticksSinceFpSpend: FP_REGEN_DELAY_TICKS,
    projectiles: [],
    nextProjectileId: 0,
    inputBuffer: emptyInputBuffer(),
  };
}

/** Poise threshold — how much accumulated poise damage staggers this build (§5/§6). */
export function poiseThreshold(build: PlayerBuild): number {
  return BASE_POISE + build.vitality * POISE_PER_VITALITY;
}

/** True while staggered: locked out of everything and fully vulnerable. */
export function isStaggered(state: PlayerCombatState): boolean {
  return state.staggerTicks > 0;
}

/** The player is invulnerable during a dodge's active (i-frame) window (§4). */
export function isInvulnerable(state: PlayerCombatState): boolean {
  return state.action?.id === 'dodge' && state.action.phase === 'active';
}

/**
 * True while a completed block stance is up and absorbing hits.
 *
 * Note: this is deliberately the `hold` phase only — a hit landing during the
 * block's 3-tick startup lands as a full (undefended) hit. The guard has to be
 * *established* to reduce damage; you can't panic-raise it into an incoming
 * blow. This is intentional Soulslike behaviour, locked by a test.
 */
export function isBlocking(state: PlayerCombatState): boolean {
  return state.action?.id === 'block' && state.action.phase === 'hold';
}

/** True from the moment the guard starts rising until it starts dropping.
 * Wider than isBlocking(): includes startup, because spec §3 pauses stamina
 * regen "while blocking" — raising the guard counts; releasing it (recovery)
 * does not. Distinct predicates because damage absorption and regen pause are
 * different questions with different windows. */
function isGuardEngaged(state: PlayerCombatState): boolean {
  return state.action?.id === 'block' && state.action.phase !== 'recovery';
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
  const fd = FRAME_DATA[id];
  if (fd.stamina > 0) {
    state.stamina -= fd.stamina;
    state.ticksSinceStaminaSpend = 0;
  }
  if (fd.fp > 0) {
    state.fp -= fd.fp;
    state.ticksSinceFpSpend = 0;
  }
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
  const fd = FRAME_DATA[id];
  return state.stamina >= fd.stamina && state.fp >= fd.fp;
}

function isBuffered(state: PlayerCombatState, id: EdgeAction): boolean {
  return state.inputBuffer[id] > 0;
}

/** Consume a buffered intent — cleared only once it actually starts something,
 * so an unaffordable buffered press (e.g. dodge queued on empty stamina)
 * keeps re-checking every remaining tick of its window rather than being
 * thrown away on the first tick it couldn't afford. */
function consumeBuffer(state: PlayerCombatState, id: EdgeAction): void {
  state.inputBuffer[id] = 0;
}

/** Try to begin a new action from the buffered edge intents (#20) — a press
 * that landed while the player couldn't act is remembered for
 * INPUT_BUFFER_TICKS and is exactly as eligible here as one on this exact
 * tick, since `updateInputBuffer` already folded a fresh press into the
 * buffer before this runs. Returns true if one started. */
function tryStartFromInput(
  state: PlayerCombatState,
  input: CombatInput,
  ctx: StepContext,
  events: CombatEvent[],
): boolean {
  // Priority: dodge > cast > heavy > light > block. Dodge stays the panic-out
  // option; cast sits above melee since it's the deliberate, own-key commit.
  if (isBuffered(state, 'dodge') && canAfford(state, 'dodge')) {
    consumeBuffer(state, 'dodge');
    startAction(state, 'dodge', 1, ctx, events);
    return true;
  }
  if (isBuffered(state, 'cast') && canAfford(state, 'cast')) {
    consumeBuffer(state, 'cast');
    startAction(state, 'cast', 1, ctx, events);
    return true;
  }
  if (isBuffered(state, 'heavy') && canAfford(state, 'heavy')) {
    consumeBuffer(state, 'heavy');
    startAction(state, 'heavy', 1, ctx, events);
    return true;
  }
  if (isBuffered(state, 'light') && canAfford(state, 'light')) {
    consumeBuffer(state, 'light');
    startAction(state, 'light', 1, ctx, events);
    return true;
  }
  // block stays level-triggered — no buffer to check, just the live key.
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

  // Current phase finished — advance to the next. Block is the one special case:
  // its startup leads to an (indefinite) hold rather than an active window.
  const target =
    action.phase === 'startup' && action.id === 'block'
      ? 'hold'
      : NEXT_PHASE[action.phase as Exclude<Phase, 'hold'>];

  if (target === 'end') {
    const finished = action.id;
    state.action = null;
    events.push({ type: 'action:end', id: finished });
    return;
  }

  action.phase = target;
  action.tickInPhase = 0;
  action.phaseLength = phaseLengthFor(action.id, target, action.chainIndex, ctx.build);
  if (target === 'active') {
    if (action.id === 'light' || action.id === 'heavy') {
      events.push({ type: 'attack:active', id: action.id, chainIndex: action.chainIndex });
    } else if (action.id === 'cast') {
      spawnProjectile(state, ctx, events);
    }
  }
}

/**
 * Refresh the input buffer for one tick (#20): a fresh edge press (re)arms
 * its full window; otherwise an already-armed window ages down by one.
 *
 * Runs unconditionally — before the stagger check, before the action-state
 * branch — so a press is captured the instant it happens regardless of what
 * else is going on. That's deliberate: the drop this fixes isn't specific to
 * the recovery→idle boundary it was reported against, it's any tick a
 * `JustDown`-style edge gets read while the player can't act on it (mid
 * action, or staggered). One rule that runs every tick is what makes "press
 * dodge the instant hitstun ends" behave the same as "press it the instant
 * recovery ends," rather than two boundaries needing two fixes.
 */
function updateInputBuffer(state: PlayerCombatState, input: CombatInput): void {
  const edges: EdgeAction[] = ['dodge', 'cast', 'heavy', 'light'];
  for (const id of edges) {
    if (input[id]) {
      state.inputBuffer[id] = INPUT_BUFFER_TICKS;
    } else if (state.inputBuffer[id] > 0) {
      state.inputBuffer[id] -= 1;
    }
  }
}

/** Emit a sorcery projectile from the caster's position, damage locked in
 * from intelligence at cast time (§6 curve). */
function spawnProjectile(state: PlayerCombatState, ctx: StepContext, events: CombatEvent[]): void {
  const id = state.nextProjectileId;
  state.nextProjectileId += 1;
  state.projectiles.push({
    id,
    x: state.x,
    facing: state.facing,
    ticksAlive: 0,
    damage: sorceryDamage(ctx.build.intelligence),
  });
  events.push({ type: 'projectile:spawn', id });
}

/** Advance every live projectile one tick; drop those that have travelled
 * their whole lifetime (fizzle). Deterministic — no wall-clock, no RNG — so
 * replay and the fairness suite are unaffected. */
function tickProjectiles(state: PlayerCombatState, events: CombatEvent[]): void {
  if (state.projectiles.length === 0) return;
  const survivors: Projectile[] = [];
  for (const p of state.projectiles) {
    const next: Projectile = {
      ...p,
      x: p.x + p.facing * SORCERY_PROJECTILE_SPEED,
      ticksAlive: p.ticksAlive + 1,
    };
    if (next.ticksAlive > SORCERY_PROJECTILE_MAX_TICKS) {
      events.push({ type: 'projectile:fizzle', id: next.id });
    } else {
      survivors.push(next);
    }
  }
  state.projectiles = survivors;
}

/**
 * Advance the simulation by one tick.
 *
 * Free (idle) → movement and new actions are allowed. Mid-action → the player
 * is committed; the only exception is chaining a light attack during its
 * recovery.
 */
export function step(prev: PlayerCombatState, input: CombatInput, ctx: StepContext): StepResult {
  // Clone the projectiles array (and the input buffer) too: spawn/tick and
  // updateInputBuffer mutate them, and step must never touch the previous
  // tick's state (the sim is value-semantic for replay).
  const state: PlayerCombatState = {
    ...prev,
    action: prev.action ? { ...prev.action } : null,
    projectiles: [...prev.projectiles],
    inputBuffer: { ...prev.inputBuffer },
  };
  const events: CombatEvent[] = [];

  // #20 — captures this tick's edge presses before anything below can drop
  // them by being unable to act. See updateInputBuffer's comment for why
  // this runs first, ahead of even the stagger check.
  updateInputBuffer(state, input);

  // Passive per-tick resources (§3/§5/§6): poise damage decays; stamina and FP
  // regen after their post-spend delays (stamina paused while the guard is up).
  state.poiseDamage = tickPoiseDecay(state.poiseDamage);
  state.ticksSinceStaminaSpend += 1;
  if (state.ticksSinceStaminaSpend >= STAMINA_REGEN_DELAY_TICKS && !isGuardEngaged(state)) {
    state.stamina = Math.min(
      maxStamina(ctx.build.vitality),
      state.stamina + STAMINA_REGEN_PER_TICK,
    );
  }
  state.ticksSinceFpSpend += 1;
  if (state.ticksSinceFpSpend >= FP_REGEN_DELAY_TICKS) {
    state.fp = Math.min(maxFp(ctx.build.intelligence), state.fp + FP_REGEN_PER_TICK);
  }

  // Projectiles fly independently of the caster — advanced every tick, even
  // through a stagger or mid-action, before any early return below.
  tickProjectiles(state, events);

  // Staggered: locked out until it runs down. Inputs are ignored entirely.
  if (state.staggerTicks > 0) {
    state.staggerTicks -= 1;
    if (state.staggerTicks === 0) events.push({ type: 'stagger:end' });
    return { state, events };
  }

  if (state.action === null) {
    if (!tryStartFromInput(state, input, ctx, events)) {
      // Idle: free movement.
      if (input.moveX !== 0) {
        state.facing = input.moveX > 0 ? 1 : -1;
        state.x = clamp(state.x + input.moveX * MOVE_SPEED, ctx.minX, ctx.maxX);
      }
    }
    return { state, events };
  }

  // Light-attack chaining: a (possibly buffered, #20) light intent during a
  // light's recovery starts the next chain step (bounded by LIGHT_MAX_CHAIN
  // and stamina), extending pressure. Buffered, not raw `input.light`, for
  // the same reason tryStartFromInput is: a press thrown during the *active*
  // window (before recovery even starts) used to be silently eaten the exact
  // same way a press at the recovery→idle boundary was.
  if (
    state.action.id === 'light' &&
    state.action.phase === 'recovery' &&
    isBuffered(state, 'light') &&
    state.action.chainIndex < LIGHT_MAX_CHAIN &&
    canAfford(state, 'light')
  ) {
    consumeBuffer(state, 'light');
    startAction(state, 'light', state.action.chainIndex + 1, ctx, events);
    return { state, events };
  }

  advancePhase(state, input, ctx, events);
  return { state, events };
}

/** Pure geometry: does a projectile overlap a target centred at `targetX`
 * with the given half-width? Cross-entity resolution stays the scene's job
 * (as with melee's range check), but the *test* is a pure, unit-tested
 * predicate — no Phaser, no boss module dependency. */
export function projectileHits(
  projectile: Projectile,
  targetX: number,
  targetHalfWidth: number,
): boolean {
  return Math.abs(projectile.x - targetX) <= SORCERY_PROJECTILE_HALF_WIDTH + targetHalfWidth;
}

/** Poise/posture damage a sorcery hit deals (flat; HP damage rides on each
 * projectile's own int-scaled `damage`). */
export const SORCERY_HIT_POISE = SORCERY_POISE_DAMAGE;

/** Return a copy of the state with the named projectiles removed — the scene
 * calls this after resolving hits so a consumed bolt stops flying. Keeping
 * the projectile list in player state (not the scene) is what makes the sim
 * replayable. */
export function consumeProjectiles(
  state: PlayerCombatState,
  ids: ReadonlySet<number>,
): PlayerCombatState {
  if (ids.size === 0) return state;
  return { ...state, projectiles: state.projectiles.filter((p) => !ids.has(p.id)) };
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
  /** True when a block emptied the stamina bar → guard-break stagger. */
  guardBroken: boolean;
  /** True when this hit staggered the player (poise break or guard break). */
  staggered: boolean;
  events: CombatEvent[];
}

function applyStagger(
  state: PlayerCombatState,
  ticks: number,
  cause: 'poise' | 'guard-break',
  events: CombatEvent[],
): void {
  // Never let a fresh (shorter) stagger cut an ongoing one short — being hit
  // again must not help the player recover sooner.
  state.staggerTicks = Math.max(state.staggerTicks, ticks);
  state.poiseDamage = 0; // the break consumes the accumulator
  state.action = null; // any in-flight action is interrupted
  events.push({ type: 'stagger:start', ticks, cause });
}

/** Resolve an incoming attack against the player's current defensive state. */
export function resolveIncomingHit(
  prev: PlayerCombatState,
  incoming: IncomingHit,
  build: PlayerBuild,
): HitResolution {
  const state: PlayerCombatState = { ...prev, action: prev.action ? { ...prev.action } : null };
  const events: CombatEvent[] = [];

  if (isInvulnerable(state)) {
    return { state, result: 'dodged', hpLost: 0, guardBroken: false, staggered: false, events };
  }

  if (isBlocking(state)) {
    // A held guard absorbs the poise damage entirely; the price is HP chip
    // and stamina drain — and a drained bar is a guard break (§4/§5).
    const hpLost = incoming.hp * BLOCK_DAMAGE_MULT;
    state.hp = Math.max(0, state.hp - hpLost);
    state.stamina = Math.max(0, state.stamina - BLOCK_STAMINA_PER_HIT);
    state.ticksSinceStaminaSpend = 0; // the drain restarts the regen delay
    const guardBroken = state.stamina === 0;
    if (guardBroken) {
      applyStagger(state, GUARD_BREAK_STAGGER_TICKS, 'guard-break', events);
    }
    return { state, result: 'blocked', hpLost, guardBroken, staggered: guardBroken, events };
  }

  // Undefended (idle, committed, or already staggered): delegate to the
  // entity-generic core — full HP damage plus poise accumulation, stagger on
  // break (§5). The player-specific part is only the stagger consequence.
  const hit = applyUndefendedHit(state, incoming, poiseThreshold(build));
  state.hp = hit.hp;
  state.poiseDamage = hit.poiseDamage;
  if (hit.poiseBroken) {
    applyStagger(state, POISE_STAGGER_TICKS, 'poise', events);
  }
  return {
    state,
    result: 'hit',
    hpLost: incoming.hp,
    guardBroken: false,
    staggered: hit.poiseBroken,
    events,
  };
}
