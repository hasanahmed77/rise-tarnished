// The audio contract: which sounds exist, how loud each sits, and where the
// files are. One half of a pair with scripts/generate-audio.mjs, exactly like
// spriteFrames.ts is with the sprite generator.
//
// Kept Phaser-free so soundManifest.test.ts can assert every key here has a
// real, valid WAV behind it — a missing file otherwise surfaces only as a
// silent event mid-fight, which is close to impossible to notice in review.

export const SFX_KEYS = [
  'swing-light',
  'swing-heavy',
  'swing-boss',
  'hit',
  'hit-critical',
  'block',
  'dodge',
  'cast',
  'hurt',
  'death',
] as const;

export type SfxKey = (typeof SFX_KEYS)[number];

export const AMBIENCE_KEY = 'ambience-stormveil';

/**
 * Per-sound volume. The generator already normalises each file to a peak
 * chosen for its role, so these are the *mix* on top of that — they set what
 * sits forward and what stays out of the way.
 *
 * The shape of this mix is deliberate: impacts (hit, critical, hurt) are the
 * loudest because they're the feedback the player must never miss, swings sit
 * lower because they fire constantly, and dodge is quietest of all — it should
 * confirm the input without competing with whatever it's dodging.
 */
export const SFX_VOLUME: Record<SfxKey, number> = {
  'swing-light': 0.32,
  'swing-heavy': 0.42,
  'swing-boss': 0.5,
  hit: 0.72,
  'hit-critical': 0.9,
  block: 0.55,
  dodge: 0.22,
  cast: 0.45,
  hurt: 0.8,
  death: 0.75,
};

/** The brief was "subtle" — this is a room tone, not a soundtrack. Low enough
 * that it reads as atmosphere and is mostly noticed when it stops. */
export const AMBIENCE_VOLUME = 0.18;

/** Ambience fades in rather than starting abruptly, since it may begin at an
 * arbitrary moment (browsers block audio until the first user gesture). */
export const AMBIENCE_FADE_MS = 2500;

export function audioPath(key: string): string {
  return `/audio/${key}.wav`;
}
