// The §6 stat-scaling math: soft-capped diminishing returns and derived-stat
// helpers. Pure and engine-agnostic (CLAUDE.md) — the foundation both
// sorcery (#40, int → spell damage + FP) and melee/build scaling (#12) build
// on. Values in COMBAT_SYSTEM.md §6 are tuning targets; the *curve* is the
// commitment.

/**
 * Normalized soft-cap curve (§6): linear up to the cap, then sharply
 * diminishing.
 *
 *   softcap(s) = s ≤ cap ? s/cap : 1 + 0.3 × (s - cap)/cap
 *
 * At s = cap it returns exactly 1; below, it's the linear fraction s/cap;
 * above, each further point is worth 0.3/cap instead of 1/cap — so
 * specialization past the cap still helps, but hybridizing stays viable.
 */
export function softcap(stat: number, cap: number): number {
  if (cap <= 0) throw new Error('softcap: cap must be positive');
  const s = Math.max(0, stat);
  return s <= cap ? s / cap : 1 + (0.3 * (s - cap)) / cap;
}

/**
 * §6 damage formula:
 *   damage = weaponBase × (1 + scalingCoeff × softcap(stat)) × typeModifier
 *
 * At stat 0 you get the raw weaponBase; at the soft cap you get
 * weaponBase × (1 + scalingCoeff). typeModifier defaults to 1 (no weapon-type
 * matchups in v1).
 */
export function scaledDamage(
  weaponBase: number,
  scalingCoeff: number,
  stat: number,
  cap: number,
  typeModifier = 1,
): number {
  return weaponBase * (1 + scalingCoeff * softcap(stat, cap)) * typeModifier;
}
