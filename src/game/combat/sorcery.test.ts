// Sorcery mechanic (#40): FP gating, cast commitment, deterministic
// projectile travel + hit/miss, and int-scaled damage — all headless,
// against the pure sim (no Phaser).

import { describe, expect, it } from 'vitest';
import {
  consumeProjectiles,
  createPlayerState,
  projectileHits,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from './playerCombat';
import {
  FRAME_DATA,
  SORCERY_PROJECTILE_MAX_TICKS,
  SORCERY_PROJECTILE_SPEED,
  maxFp,
  sorceryDamage,
} from './frameData';
import type { PlayerBuild } from '../bridge';

const CASTER: PlayerBuild = { vitality: 10, dexterity: 10, intelligence: 30 };
const CTX: StepContext = { build: CASTER, minX: 0, maxX: 2000 };

const NEUTRAL: CombatInput = {
  moveX: 0,
  light: false,
  heavy: false,
  dodge: false,
  cast: false,
  block: false,
};
const press = (over: Partial<CombatInput>): CombatInput => ({ ...NEUTRAL, ...over });

function run(state: PlayerCombatState, ticks: number, input: CombatInput = NEUTRAL) {
  let s = state;
  for (let i = 0; i < ticks; i++) {
    s = step(s, i === 0 ? input : NEUTRAL, CTX).state;
  }
  return s;
}

describe('FP resource', () => {
  it('scales max FP with intelligence (+3/pt, §6)', () => {
    expect(createPlayerState(0, { vitality: 10, dexterity: 10, intelligence: 0 }).fp).toBe(
      maxFp(0),
    );
    expect(createPlayerState(0, CASTER).fp).toBe(maxFp(30));
    expect(maxFp(30)).toBeGreaterThan(maxFp(10));
  });

  it('a cast spends FP', () => {
    const start = createPlayerState(0, CASTER);
    const afterCast = step(start, press({ cast: true }), CTX).state;
    expect(afterCast.fp).toBe(start.fp - FRAME_DATA.cast.fp);
  });
});

describe('cast gating + commitment', () => {
  it('will not cast without enough FP', () => {
    let s = createPlayerState(0, CASTER);
    s = { ...s, fp: FRAME_DATA.cast.fp - 1 }; // one short
    const after = step(s, press({ cast: true }), CTX).state;
    expect(after.action).toBeNull(); // no cast started
    expect(after.projectiles).toHaveLength(0);
    // The cast cost was not deducted (FP only regens, never drops here).
    expect(after.fp).toBeGreaterThanOrEqual(s.fp);
    expect(after.fp).toBeLessThan(s.fp + FRAME_DATA.cast.fp);
  });

  it('locks the player into the cast (committed like a heavy)', () => {
    const start = createPlayerState(0, CASTER);
    const casting = step(start, press({ cast: true }), CTX).state;
    expect(casting.action?.id).toBe('cast');
    // A movement input mid-cast is ignored — committed.
    const moved = step(casting, press({ moveX: 1 }), CTX).state;
    expect(moved.x).toBe(casting.x);
  });

  it('spawns exactly one projectile when the cast reaches its active phase', () => {
    let s = step(createPlayerState(0, CASTER), press({ cast: true }), CTX).state;
    // advance through the whole startup until active spawns the bolt
    for (let i = 0; i < FRAME_DATA.cast.startup + 2 && s.projectiles.length === 0; i++) {
      s = step(s, NEUTRAL, CTX).state;
    }
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0].facing).toBe(1);
    expect(s.projectiles[0].damage).toBeCloseTo(sorceryDamage(CASTER.intelligence));
  });
});

describe('projectile travel + lifetime (deterministic)', () => {
  it('travels a fixed distance per tick in the facing direction', () => {
    let s = step(createPlayerState(100, CASTER), press({ cast: true }), CTX).state;
    while (s.projectiles.length === 0) s = step(s, NEUTRAL, CTX).state;
    const spawnX = s.projectiles[0].x;
    s = step(s, NEUTRAL, CTX).state;
    expect(s.projectiles[0].x).toBeCloseTo(spawnX + SORCERY_PROJECTILE_SPEED);
  });

  it('fizzles after its max lifetime', () => {
    let s = step(createPlayerState(0, CASTER), press({ cast: true }), CTX).state;
    while (s.projectiles.length === 0) s = step(s, NEUTRAL, CTX).state;
    s = run(s, SORCERY_PROJECTILE_MAX_TICKS + 2);
    expect(s.projectiles).toHaveLength(0);
  });
});

describe('projectileHits geometry (pure)', () => {
  const bolt = { id: 0, x: 100, facing: 1 as const, ticksAlive: 0, damage: 10 };

  it('hits a target it overlaps', () => {
    expect(projectileHits(bolt, 105, 27)).toBe(true); // well within reach
  });

  it('misses a target out of reach', () => {
    expect(projectileHits(bolt, 400, 27)).toBe(false);
  });
});

describe('consumeProjectiles', () => {
  it('removes only the named projectiles', () => {
    let s = createPlayerState(0, CASTER);
    // hand-place two bolts
    s = {
      ...s,
      projectiles: [
        { id: 1, x: 0, facing: 1, ticksAlive: 0, damage: 5 },
        { id: 2, x: 0, facing: 1, ticksAlive: 0, damage: 5 },
      ],
    };
    const after = consumeProjectiles(s, new Set([1]));
    expect(after.projectiles.map((p) => p.id)).toEqual([2]);
  });
});

describe('int-scaled damage', () => {
  it('a higher-int caster launches a harder-hitting bolt', () => {
    const dim = { vitality: 10, dexterity: 10, intelligence: 10 };
    const bright = { vitality: 10, dexterity: 10, intelligence: 45 };
    expect(sorceryDamage(bright.intelligence)).toBeGreaterThan(sorceryDamage(dim.intelligence));
  });
});
