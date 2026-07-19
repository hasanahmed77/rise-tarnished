// Seeded, pure PRNG (mulberry32) — boss decisions must be deterministic and
// reproducible given (seed, state) per BOSS_AI.md §4/§9. No Math.random
// anywhere in the boss brain; every call threads state explicitly.

export type RngState = number;

export function createRng(seed: number): RngState {
  return seed >>> 0;
}

/** Advance the generator one step. Returns a value in [0, 1) and the next state. */
export function nextRandom(state: RngState): [number, RngState] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

export interface WeightedOption<T> {
  item: T;
  weight: number;
}

/**
 * Pick one option weighted by `weight`. Weights need not sum to 1 — anything
 * left over after summing is implicit "none of these" (used for combo chains,
 * where the remaining mass means "end the sequence"); pass `null` in that slot
 * explicitly if the caller wants a named fallback instead.
 */
export function weightedPick<T>(
  options: WeightedOption<T>[],
  totalWeight: number,
  state: RngState,
): [T | null, RngState] {
  const [roll, next] = nextRandom(state);
  let cursor = roll * totalWeight;
  for (const { item, weight } of options) {
    cursor -= weight;
    if (cursor <= 0) return [item, next];
  }
  return [null, next];
}
