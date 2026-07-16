// Boss posture (§5): the slow second meter that rewards sustained, skilled
// offense. Player attacks (and later: well-timed jumps, punishes) fill it;
// when it breaks, the boss collapses for a critical window where the player
// lands a high-damage critical hit, then the meter resets.
//
// Pure and engine-free like the rest of the combat core. The boss entity
// (#8) drives this; it's built and tested now because the mechanic is part
// of the combat foundation.

import { POSTURE_CRITICAL_WINDOW_TICKS, POSTURE_DECAY_PER_TICK, POSTURE_MAX } from './frameData';

export interface PostureState {
  /** 0..POSTURE_MAX. Break triggers at the cap. */
  value: number;
  /** Ticks remaining in the open critical window (0 = not broken). */
  criticalTicks: number;
}

export type PostureEvent = 'break' | 'critical-expired' | null;

export function createPostureState(): PostureState {
  return { value: 0, criticalTicks: 0 };
}

export function isCriticalWindowOpen(state: PostureState): boolean {
  return state.criticalTicks > 0;
}

/**
 * Advance one tick: posture decays while un-broken; an open critical window
 * counts down and reports its expiry so the boss can play a recovery animation.
 */
export function tickPosture(prev: PostureState): { state: PostureState; event: PostureEvent } {
  if (prev.criticalTicks > 0) {
    const criticalTicks = prev.criticalTicks - 1;
    return {
      state: { value: 0, criticalTicks },
      event: criticalTicks === 0 ? 'critical-expired' : null,
    };
  }
  return {
    state: { value: Math.max(0, prev.value - POSTURE_DECAY_PER_TICK), criticalTicks: 0 },
    event: null,
  };
}

/**
 * Apply posture damage from a player hit. Ignored while the window is already
 * open (the boss is collapsed — hit HP instead). Breaking opens the window.
 */
export function applyPostureDamage(
  prev: PostureState,
  amount: number,
): { state: PostureState; event: PostureEvent } {
  if (prev.criticalTicks > 0) return { state: prev, event: null };

  const value = prev.value + amount;
  if (value >= POSTURE_MAX) {
    return {
      state: { value: 0, criticalTicks: POSTURE_CRITICAL_WINDOW_TICKS },
      event: 'break',
    };
  }
  return { state: { ...prev, value }, event: null };
}
