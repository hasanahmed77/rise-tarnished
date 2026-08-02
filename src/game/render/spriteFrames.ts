// Frame layout of the generated sprite sheets (public/sprites/*.png).
//
// This is one half of a contract with scripts/generate-sprites.mjs, which
// writes frames in exactly this order. Kept Phaser-free and separate from
// CombatScene so the contract can be asserted in a headless test
// (spriteFrames.test.ts reads the real PNGs and checks the sheets are big
// enough for every index named here) — a mismatch otherwise shows up only
// as the wrong pose playing, which no type check would catch.

/** Native frame sizes: the generator's base resolution × its 3× upscale.
 * Deliberately wider than the combat hit dimensions in CombatScene — a
 * swung sword and Margit's horns need room outside the hitbox. */
export const PLAYER_SPRITE_W = 66;
export const PLAYER_SPRITE_H = 96;
// Margit's frame is much wider than her body: her cane has to reach the
// player at the 80–140px ranges her moves actually hit from, so the strike
// animates well outside her silhouette. See the note in generate-sprites.mjs.
export const BOSS_SPRITE_W = 204;
export const BOSS_SPRITE_H = 144;
export const SLASH_SPRITE = 72;
export const SLASH_FRAME_COUNT = 4;

/** Margit's strike streak. Drawn at this reference length and stretched
 * horizontally by the scene to each move's own `rangeBand[1]`, so what the
 * player sees reaching them is exactly what hits them — her moves span
 * 80–260px and no single drawn cane pose can cover that. */
export const STRIKE_SPRITE_W = 288;
export const STRIKE_SPRITE_H = 36;
export const STRIKE_FRAME_COUNT = 4;
/** Vertical centre of the streak, as a fraction of the player's height above
 * the ground — chest height, where a strike should land. */
export const STRIKE_HEIGHT_RATIO = 0.55;

/** Player frames, indexed into player.png. */
export const PF = {
  idle: [0, 1],
  run: [2, 3, 4, 5],
  light: { startup: 6, active: 7, recovery: 8 },
  heavy: { startup: 9, active: 10, recovery: 11 },
  dodge: { startup: 12, active: 13, recovery: 14 },
  block: 15,
  cast: { startup: 16, active: 17, recovery: 17 },
  stagger: 18,
  death: 19,
} as const;

/** Margit frames, indexed into margit.png. */
export const MF = {
  idle: [0, 1],
  startup: 2,
  active: 3,
  recovery: 4,
  staggered: 5,
  collapsed: 6,
  death: 7,
} as const;

/** Every frame index a table references — the test uses this to prove the
 * sheet actually contains them all. */
export function frameIndices(table: object): number[] {
  const out: number[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'number') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(table);
  return out;
}
