// Proves the sprite-sheet contract (#42): the committed PNGs really do
// contain every frame CombatScene indexes into, at the frame size it loads
// them with. Regenerating the art with a different frame count or canvas
// size — or renumbering a pose — breaks here instead of silently animating
// the wrong thing in a fight.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BOSS_SPRITE_H,
  BOSS_SPRITE_W,
  MF,
  PF,
  PLAYER_SPRITE_H,
  PLAYER_SPRITE_W,
  SLASH_FRAME_COUNT,
  SLASH_SPRITE,
  frameIndices,
} from './spriteFrames';

const SPRITES = join(process.cwd(), 'public', 'sprites');

/** Read width/height straight out of a PNG's IHDR — no image library needed
 * for two big-endian ints at a fixed offset. */
function pngSize(name: string): { width: number; height: number } {
  const buf = readFileSync(join(SPRITES, name));
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function frameCount(name: string, fw: number, fh: number): number {
  const { width, height } = pngSize(name);
  expect(width % fw, `${name} width ${width} is not a whole number of ${fw}px frames`).toBe(0);
  expect(height % fh, `${name} height ${height} is not a whole number of ${fh}px frames`).toBe(0);
  return (width / fw) * (height / fh);
}

describe('player sheet', () => {
  it('holds every frame the scene indexes', () => {
    const total = frameCount('player.png', PLAYER_SPRITE_W, PLAYER_SPRITE_H);
    const used = frameIndices(PF);
    expect(used.length).toBeGreaterThan(0);
    expect(Math.max(...used)).toBeLessThan(total);
    expect(Math.min(...used)).toBeGreaterThanOrEqual(0);
  });

  it('covers each combat state with a distinct pose where the state differs', () => {
    // Startup/active/recovery of an attack must not collapse to one frame —
    // the tell is the whole readability contract (COMBAT_SYSTEM.md §1).
    expect(new Set([PF.light.startup, PF.light.active, PF.light.recovery]).size).toBe(3);
    expect(new Set([PF.heavy.startup, PF.heavy.active, PF.heavy.recovery]).size).toBe(3);
    expect(PF.light.active).not.toBe(PF.heavy.active);
    expect(PF.stagger).not.toBe(PF.death);
  });
});

describe('margit sheet', () => {
  it('holds every frame the scene indexes', () => {
    const total = frameCount('margit.png', BOSS_SPRITE_W, BOSS_SPRITE_H);
    const used = frameIndices(MF);
    expect(Math.max(...used)).toBeLessThan(total);
  });

  it('distinguishes the phases a player reads to time a punish', () => {
    expect(new Set([MF.startup, MF.active, MF.recovery]).size).toBe(3);
    expect(MF.collapsed).not.toBe(MF.staggered);
  });

  it('is drawn larger than the player — Margit has to loom', () => {
    expect(BOSS_SPRITE_W).toBeGreaterThan(PLAYER_SPRITE_W);
    expect(BOSS_SPRITE_H).toBeGreaterThan(PLAYER_SPRITE_H);
  });
});

describe('slash vfx sheet', () => {
  it('has exactly the frames the arc animation plays', () => {
    expect(frameCount('slash.png', SLASH_SPRITE, SLASH_SPRITE)).toBe(SLASH_FRAME_COUNT);
  });
});
