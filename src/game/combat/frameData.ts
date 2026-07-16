// Combat tuning constants and the player-action frame-data table.
// Source of truth: docs/design/COMBAT_SYSTEM.md §2–5. Values are v1 tuning
// targets (expected to change through playtesting); the *systems* they feed are
// the commitment. All durations are in simulation ticks.

export const TICKS_PER_SECOND = 60;

export const BASE_MAX_HP = 100;
export const BASE_MAX_STAMINA = 100;

/** World units travelled per tick while free-moving (≈180 u/s). */
export const MOVE_SPEED = 3;

/** Dodge i-frames scale with dexterity: +1 per 8 points, capped at +4 (§6). */
export const DODGE_BASE_IFRAMES = 12;
export const DODGE_IFRAME_DEX_STEP = 8;
export const DODGE_IFRAME_DEX_CAP = 4;

/** Blocking leaves you taking 30% of incoming damage (70% reduction, §4). */
export const BLOCK_DAMAGE_MULT = 0.3;
/** Stamina drained from the blocker each time a hit is blocked (§4). */
export const BLOCK_STAMINA_PER_HIT = 20;

/** Light attacks chain up to 3 times; each step adds recovery (§4). */
export const LIGHT_MAX_CHAIN = 3;
export const LIGHT_CHAIN_RECOVERY_STEP = 2;

export type AttackId = 'light' | 'heavy';
export type ActionId = AttackId | 'dodge' | 'block';

export interface FrameData {
  /** Windup before the action's effect; interruptible only by being hit. */
  startup: number;
  /** Effect window — hitbox live for attacks, i-frames live for dodge. */
  active: number;
  /** Locked, vulnerable tail where punishes land. */
  recovery: number;
  /** Stamina spent to initiate the action. */
  stamina: number;
}

// Block is a held stance rather than a fixed active window, so its `active` is
// 0 — the machine routes it through a `hold` phase instead (see playerCombat).
export const FRAME_DATA: Record<ActionId, FrameData> = {
  light: { startup: 8, active: 4, recovery: 12, stamina: 15 },
  heavy: { startup: 22, active: 6, recovery: 24, stamina: 30 },
  dodge: { startup: 2, active: DODGE_BASE_IFRAMES, recovery: 10, stamina: 25 },
  block: { startup: 3, active: 0, recovery: 8, stamina: 0 },
};

/** Attacks deal HP and poise damage; v1 values live here so tuning is data. */
export const ATTACK_DAMAGE: Record<AttackId, { hp: number; poise: number }> = {
  light: { hp: 8, poise: 6 },
  heavy: { hp: 18, poise: 14 },
};

/** Dodge i-frame count for a given dexterity (§6). */
export function dodgeIframes(dexterity: number): number {
  const bonus = Math.min(DODGE_IFRAME_DEX_CAP, Math.floor(dexterity / DODGE_IFRAME_DEX_STEP));
  return DODGE_BASE_IFRAMES + bonus;
}
