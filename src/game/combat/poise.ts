// Entity-generic poise: the interrupt-resistance meter COMBAT_SYSTEM.md §5
// gives to *every* entity. The player (playerCombat.ts) and the boss (#8)
// share this one implementation so their accumulate/decay/break cycles can
// never drift apart in tuning.
//
// Pure and engine-free. An entity carries a plain `poiseDamage: number`;
// these helpers own every legal transition of it.

import { POISE_DECAY_PER_TICK } from './frameData';

/** Per-tick decay (10/s per spec §5). Call once per simulation tick. */
export function tickPoiseDecay(poiseDamage: number): number {
  return Math.max(0, poiseDamage - POISE_DECAY_PER_TICK);
}

export interface PoiseHitResult {
  /** Accumulator after the hit (0 if it broke — the break consumes it). */
  poiseDamage: number;
  /** True when the hit reached the threshold: the target staggers. */
  broken: boolean;
}

/**
 * Accumulate poise damage from a connecting hit. Breaks at >= threshold
 * (matching posture's break-at-cap convention) and consumes the accumulator.
 */
export function applyPoiseHit(
  poiseDamage: number,
  incomingPoise: number,
  threshold: number,
): PoiseHitResult {
  const total = poiseDamage + incomingPoise;
  if (total >= threshold) {
    return { poiseDamage: 0, broken: true };
  }
  return { poiseDamage: total, broken: false };
}

export interface UndefendedHitTarget {
  hp: number;
  poiseDamage: number;
}

export interface UndefendedHitResult extends UndefendedHitTarget {
  /** True when the hit broke poise: the target staggers, action interrupted. */
  poiseBroken: boolean;
}

/**
 * The entity-generic core of hit resolution: an undefended hit deals full HP
 * damage and accumulates poise (§5). Defensive layers — the player's i-frames
 * and block, a boss's hyper-armor moves later — are decorators that decide
 * whether a hit reaches this core, and with what numbers.
 */
export function applyUndefendedHit(
  target: UndefendedHitTarget,
  incoming: { hp: number; poise: number },
  poiseThreshold: number,
): UndefendedHitResult {
  const poise = applyPoiseHit(target.poiseDamage, incoming.poise, poiseThreshold);
  return {
    hp: Math.max(0, target.hp - incoming.hp),
    poiseDamage: poise.poiseDamage,
    poiseBroken: poise.broken,
  };
}
