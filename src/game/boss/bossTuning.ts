// Boss-specific tuning, kept separate from combat/frameData.ts (player-only)
// so the two entities can be retuned independently while sharing the generic
// mechanisms (poise.ts, posture.ts).

export const BOSS_BASE_MAX_HP = 400;

/** Flat poise threshold for phase 1 (no vitality-style scaling — bosses don't
 * spend runes). Tune per boss/phase later; one number is enough to prove the
 * pipeline this sprint. */
export const BOSS_POISE_THRESHOLD = 40;

/** How long a poise break locks the boss out of acting. */
export const BOSS_POISE_STAGGER_TICKS = 45;

/** Posture-break critical hits multiply the landing attack's HP damage. */
export const CRITICAL_HIT_MULTIPLIER = 2;

/** Simple approach/retreat speed while not committed to an action. */
export const BOSS_MOVE_SPEED = 2;

/** Distance the boss tries to hold when neither closing nor mid-sequence. */
export const BOSS_PREFERRED_RANGE = 70;
