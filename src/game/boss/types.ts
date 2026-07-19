// The move-data schema, shared by every boss (BOSS_AI.md §4 — "moves are
// data, not code"). L2 tactics land in #9; `tactics` is authored now so move
// data doesn't need rework when the tactic layer arrives, but L3 selection
// this sprint does not filter on it (every move in a phase's table is
// considered, regardless of tactic).

export type MoveTag =
  | 'delayed'
  | 'grab'
  | 'aoe'
  | 'projectile'
  | 'sweep'
  | 'combo_starter'
  | 'combo_link'
  | 'finisher'
  | 'gap_closer';

export type Tactic = 'NEUTRAL' | 'PRESSURE' | 'BAIT' | 'PUNISH' | 'REPOSITION' | 'RECOVER';

export type PlayerActionTag = 'dodge' | 'heal' | 'block' | 'whiff';

export interface ComboCondition {
  /** v1: only "did the player take this action against the previous hit". */
  playerAction: PlayerActionTag;
}

export interface ComboNext {
  move: string; // MoveId
  weight: number;
  condition?: ComboCondition;
}

export interface ComboDef {
  next: ComboNext[];
  /** Fairness cap F3 — hard limit on this family's chain depth. */
  maxChain: number;
}

export interface MoveDef {
  id: string;
  tags: MoveTag[];
  tactics: Tactic[];
  /** [min, max] world-unit distance this move is eligible at. */
  rangeBand: [number, number];
  frames: { startup: number; active: number; recovery: number };
  /** Readable windup, ≥ F1's minimum. May be < startup (early tell) but never > startup. */
  tellFrames: number;
  damage: number;
  poiseDamage: number;
  /** Extra posture damage taken by the boss if this move's recovery is punished. */
  postureSelfRisk: number;
  staminaCost: number;
  combo?: ComboDef;
  /** What this move exists to counter — unused by selection until #9, but
   * drives the future post-death recap and is worth authoring now. */
  punishes?: PlayerActionTag[];
  cooldownTicks: number;
  /** Only reachable via a combo link, never chosen as a fresh sequence opener
   * (e.g. a flurry finisher). Not part of the BOSS_AI.md schema literally, but
   * a minimal practical extension — documented here rather than smuggled in. */
  comboOnly?: boolean;
}

export type MoveTable = Record<string, MoveDef>;
