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
  // A two-beat sequence (#42 part 2b), not a single instant snap to prone:
  // `reel` holds briefly first. Reuses the stagger pose rather than drawing
  // new art — an off-balance, arms-flung frame already reads as "just been
  // hit hard," which is exactly the first beat of a death, and the scene
  // times the hold since the sim itself freezes the instant hp hits 0
  // (CombatScene.finished) and has no ticks left to drive an animation with.
  death: { reel: 18, prone: 19 },
} as const;

/** Margit frames, indexed into margit.png.
 *
 * `moves` gives every move its own tell + active pose (#42 part 2) — before
 * this, all eight moves shared one generic windup/swing, so a 40-frame grab
 * telegraphed identically to a fast cane swing and the boss's combos read as
 * one repeated animation regardless of which move the L3 AI actually picked.
 * Recovery stays one shared pose deliberately: it reads similarly across
 * moves (the punish window is about timing, not shape) and differentiating
 * it wasn't where the illegibility complaint was.
 *
 * Keyed by MoveDef.id (margitMoves.ts) — spriteFrames.test.ts asserts every
 * key in that table has an entry here, so a new move without art fails CI
 * instead of silently falling back mid-fight. */
export const MF = {
  idle: [0, 1],
  recovery: 2,
  staggered: 3,
  collapsed: 4,
  // Reuses the collapsed (posture-break) pose as death's first beat, same
  // reasoning as the player's `death.reel` above — no new art needed, and a
  // boss already reeling from posture break is a believable "about to fall."
  death: { reel: 4, prone: 5 },
  moves: {
    'margit.cane_swing_1': { tell: 6, active: 7 },
    'margit.cane_swing_2': { tell: 8, active: 9 },
    'margit.delayed_overhead': { tell: 10, active: 11 },
    'margit.holy_thrust': { tell: 12, active: 13 },
    'margit.flying_thrust': { tell: 14, active: 15 },
    'margit.sweep_kick': { tell: 16, active: 17 },
    'margit.reaper_flurry': { tell: 18, active: 19 },
    'margit.grab': { tell: 20, active: 21 },
  },
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
