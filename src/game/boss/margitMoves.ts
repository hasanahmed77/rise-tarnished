// Margit's phase-1 move table (BOSS_AI.md §7). 8 authored MoveDefs linked by
// 6 combo branches — BOSS_AI.md's "~14 moves incl. combo branches" counts
// branch edges, not distinct move defs; this sprint's scope (#8) is proving
// the L3 pipeline works end-to-end, not full-roster authoring. Adding more
// moves later is pure data, no engineering.
//
// `margit.reaper_flurry` is comboOnly: it's a finisher, never a fresh opener.
// Every non-comboOnly id here is eligible as a top-level selection.

import type { MoveTable } from './types';

export const margitMoves: MoveTable = {
  'margit.cane_swing_1': {
    id: 'margit.cane_swing_1',
    tags: ['combo_starter'],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 100],
    frames: { startup: 20, active: 6, recovery: 16 },
    tellFrames: 20,
    damage: 10,
    poiseDamage: 8,
    postureSelfRisk: 4,
    staminaCost: 0,
    cooldownTicks: 20,
    combo: {
      maxChain: 3,
      next: [
        { move: 'margit.cane_swing_2', weight: 0.6 },
        { move: 'margit.delayed_overhead', weight: 0.3, condition: { playerAction: 'dodge' } },
        // remaining 0.1 mass: end the sequence
      ],
    },
  },

  'margit.cane_swing_2': {
    id: 'margit.cane_swing_2',
    tags: ['combo_link'],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 100],
    frames: { startup: 18, active: 6, recovery: 20 },
    tellFrames: 18,
    damage: 12,
    poiseDamage: 9,
    postureSelfRisk: 4,
    staminaCost: 0,
    cooldownTicks: 0, // only reachable via combo — cooldown is moot
    comboOnly: true,
    combo: {
      maxChain: 3,
      next: [
        { move: 'margit.reaper_flurry', weight: 0.5 },
        { move: 'margit.delayed_overhead', weight: 0.2 },
        // remaining 0.3: end the sequence
      ],
    },
  },

  'margit.delayed_overhead': {
    id: 'margit.delayed_overhead',
    tags: ['delayed'],
    tactics: ['BAIT'],
    rangeBand: [0, 110],
    // Long startup with a fully-readable tell: "delayed" extends the window,
    // never shortens it below F1 — the punish is the read, not a cheap hit.
    frames: { startup: 34, active: 8, recovery: 22 },
    tellFrames: 30,
    damage: 20,
    poiseDamage: 14,
    postureSelfRisk: 8,
    staminaCost: 0,
    cooldownTicks: 70,
    punishes: ['dodge'],
  },

  'margit.holy_thrust': {
    id: 'margit.holy_thrust',
    tags: ['aoe'],
    tactics: ['NEUTRAL', 'PRESSURE'],
    rangeBand: [0, 140],
    frames: { startup: 24, active: 10, recovery: 26 },
    tellFrames: 22,
    damage: 22,
    poiseDamage: 16,
    postureSelfRisk: 6,
    staminaCost: 0,
    cooldownTicks: 60,
    combo: {
      maxChain: 2,
      next: [
        { move: 'margit.reaper_flurry', weight: 0.4 },
        // remaining 0.6: end the sequence
      ],
    },
  },

  'margit.flying_thrust': {
    id: 'margit.flying_thrust',
    tags: ['gap_closer'],
    tactics: ['REPOSITION', 'PRESSURE'],
    // Only eligible at range — the boss's answer to a player who keeps distance.
    rangeBand: [110, 260],
    frames: { startup: 18, active: 6, recovery: 20 },
    tellFrames: 18,
    damage: 14,
    poiseDamage: 8,
    postureSelfRisk: 4,
    staminaCost: 0,
    cooldownTicks: 50,
    combo: {
      maxChain: 2,
      next: [
        { move: 'margit.cane_swing_1', weight: 0.5 },
        // remaining 0.5: end the sequence
      ],
    },
  },

  'margit.sweep_kick': {
    id: 'margit.sweep_kick',
    tags: ['sweep', 'aoe'],
    tactics: ['NEUTRAL'],
    rangeBand: [0, 90],
    frames: { startup: 20, active: 8, recovery: 18 },
    tellFrames: 20,
    damage: 14,
    poiseDamage: 10,
    postureSelfRisk: 5,
    staminaCost: 0,
    cooldownTicks: 45,
  },

  'margit.reaper_flurry': {
    id: 'margit.reaper_flurry',
    tags: ['finisher'],
    tactics: ['PRESSURE'],
    rangeBand: [0, 100],
    frames: { startup: 18, active: 12, recovery: 30 },
    tellFrames: 18,
    damage: 26,
    poiseDamage: 18,
    postureSelfRisk: 10,
    staminaCost: 0,
    cooldownTicks: 80,
    comboOnly: true,
  },

  'margit.grab': {
    id: 'margit.grab',
    tags: ['grab'],
    tactics: ['PUNISH', 'PRESSURE'],
    rangeBand: [0, 80],
    // F7: the longest tell in the table (>= delayed_overhead's 30) — anti-
    // turtle reach that's still fully reactable.
    frames: { startup: 40, active: 8, recovery: 26 },
    tellFrames: 40,
    damage: 24,
    poiseDamage: 20,
    postureSelfRisk: 6,
    staminaCost: 0,
    cooldownTicks: 90,
  },
};

/** Top-level selectable moves — everything except comboOnly finishers/links. */
export const margitTopLevelMoveIds = Object.values(margitMoves)
  .filter((m) => !m.comboOnly)
  .map((m) => m.id);
