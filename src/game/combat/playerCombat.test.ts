import { describe, expect, it } from 'vitest';
import {
  createPlayerState,
  isBlocking,
  isInvulnerable,
  resolveIncomingHit,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from './playerCombat';
import {
  BASE_MAX_STAMINA,
  FRAME_DATA,
  LIGHT_CHAIN_RECOVERY_STEP,
  MOVE_SPEED,
  dodgeIframes,
} from './frameData';
import type { PlayerBuild } from '../bridge';

const BUILD: PlayerBuild = { vitality: 10, health: 10, dexterity: 10, intelligence: 10 };
const CTX: StepContext = { build: BUILD, minX: 0, maxX: 960 };

const NEUTRAL: CombatInput = { moveX: 0, light: false, heavy: false, dodge: false, block: false };
const press = (over: Partial<CombatInput>): CombatInput => ({ ...NEUTRAL, ...over });

/** Run the sim forward, feeding `input` on tick 0 and `hold` thereafter. */
function run(
  state: PlayerCombatState,
  ticks: number,
  input: CombatInput,
  hold: CombatInput = NEUTRAL,
): PlayerCombatState {
  let s = state;
  for (let i = 0; i < ticks; i++) {
    s = step(s, i === 0 ? input : hold, CTX).state;
  }
  return s;
}

describe('movement', () => {
  it('moves and faces in the input direction while idle', () => {
    const s = step(createPlayerState(100), press({ moveX: 1 }), CTX).state;
    expect(s.x).toBe(100 + MOVE_SPEED);
    expect(s.facing).toBe(1);

    const l = step(createPlayerState(100), press({ moveX: -1 }), CTX).state;
    expect(l.x).toBe(100 - MOVE_SPEED);
    expect(l.facing).toBe(-1);
  });

  it('clamps to arena bounds', () => {
    const atEdge = step({ ...createPlayerState(959), facing: 1 }, press({ moveX: 1 }), CTX).state;
    expect(atEdge.x).toBe(960);
  });

  it('cannot move mid-action (committed)', () => {
    const attacking = step(createPlayerState(100), press({ light: true }), CTX).state;
    const after = step(attacking, press({ moveX: 1 }), CTX).state;
    expect(after.x).toBe(100);
  });
});

describe('action frame progression', () => {
  it('runs light through startup → active → recovery → idle with correct durations', () => {
    const fd = FRAME_DATA.light;
    let s = step(createPlayerState(), press({ light: true }), CTX).state;
    expect(s.action).toMatchObject({ id: 'light', phase: 'startup' });

    s = run(s, fd.startup, NEUTRAL);
    expect(s.action?.phase).toBe('active');

    s = run(s, fd.active, NEUTRAL);
    expect(s.action?.phase).toBe('recovery');

    s = run(s, fd.recovery, NEUTRAL);
    expect(s.action).toBeNull(); // back to idle
  });

  it('emits attack:active when an attack enters its active window', () => {
    let s = step(createPlayerState(), press({ heavy: true }), CTX).state;
    const events = [];
    for (let i = 0; i < FRAME_DATA.heavy.startup; i++) {
      const r = step(s, NEUTRAL, CTX);
      s = r.state;
      events.push(...r.events);
    }
    expect(events).toContainEqual({ type: 'attack:active', id: 'heavy', chainIndex: 1 });
  });
});

describe('stamina', () => {
  it('spends stamina to start an action', () => {
    const s = step(createPlayerState(), press({ dodge: true }), CTX).state;
    expect(s.stamina).toBe(BASE_MAX_STAMINA - FRAME_DATA.dodge.stamina);
  });

  it('refuses to start an action it cannot afford', () => {
    const broke = { ...createPlayerState(), stamina: 5 };
    const s = step(broke, press({ heavy: true }), CTX).state;
    expect(s.action).toBeNull();
    expect(s.stamina).toBe(5);
  });
});

describe('dodge i-frames', () => {
  it('is invulnerable only during the dodge active window', () => {
    let s = step(createPlayerState(), press({ dodge: true }), CTX).state;
    expect(isInvulnerable(s)).toBe(false); // startup

    s = run(s, FRAME_DATA.dodge.startup, NEUTRAL);
    expect(s.action?.phase).toBe('active');
    expect(isInvulnerable(s)).toBe(true); // i-frames live

    s = run(s, dodgeIframes(BUILD.dexterity), NEUTRAL);
    expect(s.action?.phase).toBe('recovery');
    expect(isInvulnerable(s)).toBe(false); // vulnerable tail
  });

  it('takes NO damage when hit during i-frames (acceptance criterion)', () => {
    let s = step(createPlayerState(), press({ dodge: true }), CTX).state;
    s = run(s, FRAME_DATA.dodge.startup, NEUTRAL);
    expect(isInvulnerable(s)).toBe(true);

    const r = resolveIncomingHit(s, { hp: 40, poise: 20 }, BUILD);
    expect(r.result).toBe('dodged');
    expect(r.hpLost).toBe(0);
    expect(r.state.hp).toBe(s.hp);
  });

  it('extends the i-frame window with dexterity', () => {
    expect(dodgeIframes(0)).toBe(12);
    expect(dodgeIframes(8)).toBe(13);
    expect(dodgeIframes(32)).toBe(16);
    expect(dodgeIframes(100)).toBe(16); // capped at +4
  });
});

describe('light-attack chaining', () => {
  it('chains a second light during recovery with extended recovery', () => {
    const fd = FRAME_DATA.light;
    // Advance to the first light's recovery.
    let s = step(createPlayerState(), press({ light: true }), CTX).state;
    s = run(s, fd.startup + fd.active, NEUTRAL);
    expect(s.action?.phase).toBe('recovery');

    // Press light again → chain step 2.
    s = step(s, press({ light: true }), CTX).state;
    expect(s.action).toMatchObject({ id: 'light', chainIndex: 2, phase: 'startup' });

    // Its recovery is longer than the first by one chain step.
    s = run(s, fd.startup + fd.active, NEUTRAL);
    expect(s.action?.phaseLength).toBe(fd.recovery + LIGHT_CHAIN_RECOVERY_STEP);
  });

  it('does not chain past the max', () => {
    const fd = FRAME_DATA.light;
    let s = createPlayerState();
    s = step(s, press({ light: true }), CTX).state;
    for (let chain = 2; chain <= 3; chain++) {
      s = run(s, fd.startup + fd.active, NEUTRAL);
      s = step(s, press({ light: true }), CTX).state;
    }
    expect(s.action?.chainIndex).toBe(3);

    // A 4th press during the 3rd recovery must NOT start a new chain.
    s = run(s, fd.startup + fd.active, NEUTRAL);
    const before = s.action?.chainIndex;
    s = step(s, press({ light: true }), CTX).state;
    expect(s.action?.chainIndex).toBe(before); // still 3, no chain 4
  });
});

describe('block', () => {
  it('holds while the key is held, then recovers on release', () => {
    let s = step(createPlayerState(), press({ block: true }), CTX).state;
    s = run(s, FRAME_DATA.block.startup, press({ block: true }), press({ block: true }));
    expect(isBlocking(s)).toBe(true);

    // Keep holding — stays in hold indefinitely.
    s = run(s, 30, press({ block: true }), press({ block: true }));
    expect(isBlocking(s)).toBe(true);

    // Release → recovery → idle.
    s = step(s, NEUTRAL, CTX).state;
    expect(s.action?.phase).toBe('recovery');
    s = run(s, FRAME_DATA.block.recovery, NEUTRAL);
    expect(s.action).toBeNull();
  });

  it('reduces blocked damage by 70% and drains stamina', () => {
    let s = step(createPlayerState(), press({ block: true }), CTX).state;
    s = run(s, FRAME_DATA.block.startup, press({ block: true }), press({ block: true }));
    expect(isBlocking(s)).toBe(true);

    const r = resolveIncomingHit(s, { hp: 50, poise: 20 }, BUILD);
    expect(r.result).toBe('blocked');
    expect(r.hpLost).toBeCloseTo(15); // 30% of 50
    expect(r.state.stamina).toBeLessThan(s.stamina);
  });

  it('takes FULL damage when hit during block startup (guard not yet up)', () => {
    // Press block but stay within its 3-tick startup — the stance isn't established.
    const s = step(createPlayerState(), press({ block: true }), CTX).state;
    expect(s.action).toMatchObject({ id: 'block', phase: 'startup' });
    expect(isBlocking(s)).toBe(false);

    const r = resolveIncomingHit(s, { hp: 50, poise: 20 }, BUILD);
    expect(r.result).toBe('hit');
    expect(r.hpLost).toBe(50); // no reduction — guard must be established first
  });

  it('flags a guard break when a block empties the stamina bar', () => {
    let s = step(createPlayerState(), press({ block: true }), CTX).state;
    s = run(s, FRAME_DATA.block.startup, press({ block: true }), press({ block: true }));
    s = { ...s, stamina: 10 }; // one hit away from empty
    const r = resolveIncomingHit(s, { hp: 50, poise: 20 }, BUILD);
    expect(r.state.stamina).toBe(0);
    expect(r.guardBroken).toBe(true);
  });
});

describe('undefended hit', () => {
  it('applies full damage when neither dodging nor blocking', () => {
    const s = createPlayerState();
    const r = resolveIncomingHit(s, { hp: 30, poise: 10 }, BUILD);
    expect(r.result).toBe('hit');
    expect(r.hpLost).toBe(30);
    expect(r.state.hp).toBe(s.hp - 30);
  });
});
