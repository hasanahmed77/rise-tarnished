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
  STRIKE_FRAME_COUNT,
  STRIKE_SPRITE_H,
  STRIKE_SPRITE_W,
  frameIndices,
} from './spriteFrames';
import { margitMoves, margitTopLevelMoveIds } from '../boss/margitMoves';

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

  it('is drawn larger than the player — Margit has to loom', () => {
    expect(BOSS_SPRITE_W).toBeGreaterThan(PLAYER_SPRITE_W);
    expect(BOSS_SPRITE_H).toBeGreaterThan(PLAYER_SPRITE_H);
  });

  describe('per-move tells (#42 part 2)', () => {
    it('every move in the table has its own art — none silently fall back', () => {
      // The bug this exists to catch: a move added to margitMoves.ts without
      // a matching MF.moves entry would render CombatScene's cane_swing_1
      // fallback instead — a move-selection bug that looks, at a glance,
      // exactly like a rendering success.
      for (const id of Object.keys(margitMoves)) {
        expect(
          (MF.moves as Record<string, unknown>)[id],
          `${id} has no entry in MF.moves — it will render as cane_swing_1`,
        ).toBeDefined();
      }
    });

    it('every move a player actually sees is visually distinct from every other', () => {
      // The whole point: a 40-frame grab (F7's anti-turtle reach) must not
      // read the same as a fast cane swing. Checked pairwise across BOTH
      // tell and active — two moves sharing a tell but not an active (or
      // vice versa) would still let a player misread what's coming.
      const entries = Object.entries(MF.moves);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const [idA, framesA] = entries[i];
          const [idB, framesB] = entries[j];
          expect(
            framesA.tell,
            `${idA} and ${idB} share a tell frame — indistinguishable windups`,
          ).not.toBe(framesB.tell);
          expect(
            framesA.active,
            `${idA} and ${idB} share an active frame — indistinguishable strikes`,
          ).not.toBe(framesB.active);
        }
      }
    });

    it("each move's tell and active are different poses", () => {
      // A move whose active frame equals its tell wouldn't visibly swing at
      // all — the windup and the hit would look identical.
      for (const [id, frames] of Object.entries(MF.moves)) {
        expect(frames.tell, `${id}'s tell and active are the same frame`).not.toBe(frames.active);
      }
    });
  });
});

describe('slash vfx sheet', () => {
  it('has exactly the frames the arc animation plays', () => {
    expect(frameCount('slash.png', SLASH_SPRITE, SLASH_SPRITE)).toBe(SLASH_FRAME_COUNT);
  });
});

describe('boss strike streak', () => {
  it('has exactly the frames the strike animation plays', () => {
    expect(frameCount('strike.png', STRIKE_SPRITE_W, STRIKE_SPRITE_H)).toBe(STRIKE_FRAME_COUNT);
  });

  it('is drawn long enough to stretch DOWN to every move range, never up', () => {
    // The scene scales this streak to each move's rangeBand[1]. Margit's
    // longest is the 260px flying thrust; drawing the reference shorter than
    // that would mean upscaling a motion trail past its native size on the
    // very move where the reach mismatch was worst.
    const longestMoveRange = Math.max(
      ...margitTopLevelMoveIds.map((id) => margitMoves[id].rangeBand[1]),
    );
    expect(STRIKE_SPRITE_W).toBeGreaterThanOrEqual(longestMoveRange);
  });

  it('reaches at least as far as every move that can hit', () => {
    // The bug this guards: a move whose hitbox extends past anything the
    // player can see. Every move's max range must be expressible by the
    // streak, which the scene sizes from that same number.
    for (const id of Object.keys(margitMoves)) {
      const move = margitMoves[id];
      expect(
        move.rangeBand[1],
        `${id} range exceeds the strike streak's native length`,
      ).toBeLessThanOrEqual(STRIKE_SPRITE_W);
    }
  });
});
