// Boss-specific tuning, kept separate from combat/frameData.ts (player-only)
// so the two entities can be retuned independently while sharing the generic
// mechanisms (poise.ts, posture.ts).

export const BOSS_BASE_MAX_HP = 400;

/** Canonical boss identity string, sent to the shell/bridge and to the
 * resolve_attempt RPC (#11). Must match the `bosses.id` row in
 * supabase/migrations — the RPC looks up the real reward/region from that
 * row, this constant only labels which one to ask for. */
export const MARGIT_BOSS_ID = 'margit';

/** Client-side mirror of `bosses.rune_reward` (that migration's row is the
 * only value the resolve_attempt RPC actually trusts). Used only for the
 * optimistic UI estimate shown before the RPC responds — never persisted
 * from here, never sent as a trusted amount. Keep in sync by hand; drifting
 * is a cosmetic display flash, not a security issue. */
export const MARGIT_RUNE_REWARD = 500;

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

/** Max distance at which a committed player action reads as a punishable
 * opening (§3 PUNISH trigger). */
export const PUNISHABLE_OPENING_RANGE = 90;
