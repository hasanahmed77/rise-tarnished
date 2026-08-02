import { describe, expect, it } from 'vitest';
import {
  createPlayerState,
  isBlocking,
  isInvulnerable,
  isStaggered,
  poiseThreshold,
  resolveIncomingHit,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from './playerCombat';
import {
  BASE_MAX_STAMINA,
  FRAME_DATA,
  GUARD_BREAK_STAGGER_TICKS,
  LIGHT_CHAIN_RECOVERY_STEP,
  MOVE_SPEED,
  POISE_STAGGER_TICKS,
  STAMINA_REGEN_DELAY_TICKS,
  STAMINA_REGEN_PER_TICK,
  dodgeIframes,
} from './frameData';
import type { PlayerBuild } from '../bridge';

const BUILD: PlayerBuild = { vitality: 10, dexterity: 10, intelligence: 10 };
const CTX: StepContext = { build: BUILD, minX: 0, maxX: 960 };

const NEUTRAL: CombatInput = {
  moveX: 0,
  light: false,
  heavy: false,
  dodge: false,
  cast: false,
  block: false,
};
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
    // No spend — only the passive regen tick moved the bar.
    expect(s.stamina).toBeCloseTo(5 + STAMINA_REGEN_PER_TICK);
  });

  it('regenerates only after the post-spend delay, at the spec rate', () => {
    // Spend (dodge), then idle. During the delay window nothing regens.
    let s = step(createPlayerState(), press({ dodge: true }), CTX).state;
    const afterSpend = s.stamina;

    s = run(s, STAMINA_REGEN_DELAY_TICKS - 1, NEUTRAL);
    expect(s.stamina).toBeCloseTo(afterSpend); // still inside the delay

    s = run(s, 60, NEUTRAL); // one full second of regen
    expect(s.stamina).toBeCloseTo(afterSpend + 25, 0.5);
  });

  it('caps regen at max stamina', () => {
    const s = run(createPlayerState(), 120, NEUTRAL);
    expect(s.stamina).toBe(BASE_MAX_STAMINA);
  });

  it('pauses regen while the block stance is held, resumes on release', () => {
    // Ready to regen (delay long elapsed), missing stamina, guard up.
    let s = { ...createPlayerState(), stamina: 50 };
    const hold = press({ block: true });
    s = step(s, hold, CTX).state; // start block (costs 0 — no delay reset)
    s = run(s, FRAME_DATA.block.startup, hold, hold);
    expect(isBlocking(s)).toBe(true);
    const atHold = s.stamina;

    s = run(s, 120, hold, hold); // two full seconds holding guard
    expect(s.stamina).toBeCloseTo(atHold); // frozen while blocking

    s = run(s, FRAME_DATA.block.recovery + 1 + 60, NEUTRAL); // release + 1s idle
    expect(s.stamina).toBeGreaterThan(atHold + 20); // regen resumed
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
    // Guard break = long stagger, guard interrupted (§4).
    expect(r.staggered).toBe(true);
    expect(r.state.staggerTicks).toBe(GUARD_BREAK_STAGGER_TICKS);
    expect(r.state.action).toBeNull();
    expect(r.events).toContainEqual({
      type: 'stagger:start',
      ticks: GUARD_BREAK_STAGGER_TICKS,
      cause: 'guard-break',
    });
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

describe('poise & stagger', () => {
  // BUILD has vitality 10 → threshold = 20 + 10·0.5 = 25.
  const THRESHOLD = poiseThreshold(BUILD);

  it('accumulates poise damage below the threshold without staggering', () => {
    const r = resolveIncomingHit(createPlayerState(), { hp: 10, poise: 14 }, BUILD);
    expect(r.staggered).toBe(false);
    expect(r.state.poiseDamage).toBe(14);
    expect(r.state.poiseDamage).toBeLessThan(THRESHOLD);
  });

  it('staggers past the threshold: interrupts the action, resets the accumulator', () => {
    // Get the player mid-heavy (committed), then breach poise with two hits.
    const s = step(createPlayerState(), press({ heavy: true }), CTX).state;
    expect(s.action?.id).toBe('heavy');

    const first = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD);
    expect(first.staggered).toBe(false);
    expect(first.state.action?.id).toBe('heavy'); // still committed

    const second = resolveIncomingHit(first.state, { hp: 5, poise: 14 }, BUILD); // 28 > 25
    expect(second.staggered).toBe(true);
    expect(second.state.staggerTicks).toBe(POISE_STAGGER_TICKS);
    expect(second.state.action).toBeNull(); // heavy interrupted
    expect(second.state.poiseDamage).toBe(0); // break consumed the meter
    expect(second.events).toContainEqual({
      type: 'stagger:start',
      ticks: POISE_STAGGER_TICKS,
      cause: 'poise',
    });
  });

  it('decays poise damage over time (10/s)', () => {
    let s = resolveIncomingHit(createPlayerState(), { hp: 0, poise: 14 }, BUILD).state;
    s = run(s, 60, NEUTRAL); // one second → −10
    expect(s.poiseDamage).toBeCloseTo(4);
    // A fresh 14 now totals 18 < threshold: no stagger thanks to the decay.
    const r = resolveIncomingHit(s, { hp: 0, poise: 14 }, BUILD);
    expect(r.staggered).toBe(false);
  });

  it('locks out all input while staggered, then releases with stagger:end', () => {
    let s = createPlayerState(100);
    s = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD).state;
    s = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD).state;
    expect(isStaggered(s)).toBe(true);

    // Mashing inputs does nothing: no movement, no action.
    const during = step(s, press({ moveX: 1, light: true, dodge: true }), CTX).state;
    expect(during.x).toBe(100);
    expect(during.action).toBeNull();
    expect(isStaggered(during)).toBe(true);

    // Run the stagger out; the final tick emits stagger:end.
    let events: unknown[] = [];
    let cur = during;
    for (let i = 0; i < POISE_STAGGER_TICKS; i++) {
      const r = step(cur, NEUTRAL, CTX);
      cur = r.state;
      events = events.concat(r.events);
    }
    expect(isStaggered(cur)).toBe(false);
    expect(events).toContainEqual({ type: 'stagger:end' });

    // Free again: actions work.
    const after = step(cur, press({ light: true }), CTX).state;
    expect(after.action?.id).toBe('light');
  });

  it('staggers on EXACTLY reaching the threshold (>= convention, matches posture)', () => {
    const primed = { ...createPlayerState(), poiseDamage: THRESHOLD - 14 };
    const r = resolveIncomingHit(primed, { hp: 0, poise: 14 }, BUILD); // lands exactly on 25
    expect(r.staggered).toBe(true);
  });

  it('never shortens an ongoing stagger with a fresh shorter one', () => {
    // Guard-broken player (40-tick stagger) takes poise-breaching hits mid-lockout.
    let s = { ...createPlayerState(), staggerTicks: GUARD_BREAK_STAGGER_TICKS };
    s = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD).state;
    const r = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD); // breach → 30-tick stagger
    expect(r.staggered).toBe(true);
    // The remaining 40 must win over the fresh 30 — being hit can't speed recovery.
    expect(r.state.staggerTicks).toBe(GUARD_BREAK_STAGGER_TICKS);
  });

  it('pauses regen during block STARTUP too (guard rising counts as blocking)', () => {
    // Regen-eligible, missing stamina, then tap block: the 3 startup ticks
    // must not regen (spec §3: "paused while blocking").
    // The press tick itself may regen once (the guard isn't rising when that
    // tick begins); every startup tick after it must be frozen.
    const s = { ...createPlayerState(), stamina: 50 };
    const afterPress = step(s, press({ block: true }), CTX).state;
    expect(afterPress.action).toMatchObject({ id: 'block', phase: 'startup' });
    const atStartup = afterPress.stamina;

    const hold = press({ block: true });
    let cur = afterPress;
    for (let i = 0; i < FRAME_DATA.block.startup; i++) {
      cur = step(cur, hold, CTX).state;
      expect(cur.stamina).toBe(atStartup); // frozen through all of startup
    }
  });

  it('takes full damage while staggered (no defense available)', () => {
    let s = createPlayerState();
    s = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD).state;
    s = resolveIncomingHit(s, { hp: 5, poise: 14 }, BUILD).state;
    expect(isStaggered(s)).toBe(true);

    const r = resolveIncomingHit(s, { hp: 30, poise: 5 }, BUILD);
    expect(r.result).toBe('hit');
    expect(r.hpLost).toBe(30);
  });
});
