/** Shared, engine-free helpers used across the combat and boss modules. */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
