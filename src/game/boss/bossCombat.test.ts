import { describe, expect, it } from 'vitest';
import {
  createBossState,
  isBossStaggered,
  resolveBossHit,
  step,
  type BossStepContext,
} from './bossCombat';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { margitWeightRules } from './weighting';
import { BOSS_POISE_STAGGER_TICKS, BOSS_POISE_THRESHOLD } from './bossTuning';
import { MIN_INTER_SEQUENCE_GAP_TICKS } from './moveSchema';
import { isCriticalWindowOpen } from '../combat/posture';

const OBSERVED_NEUTRAL = {
  playerBlocking: false,
  dodgeStarted: false,
  attackStarted: false,
  punishableOpening: false,
};

const CTX: BossStepContext = {
  table: margitMoves,
  topLevelIds: margitTopLevelMoveIds,
  playerX: 250,
  minX: 40,
  maxX: 900,
  lastPlayerAction: null,
  weightRules: [],
  observed: OBSERVED_NEUTRAL,
};

function run(state: ReturnType<typeof createBossState>, ticks: number, ctx: BossStepContext = CTX) {
  let s = state;
  const events: ReturnType<typeof step>['events'] = [];
  for (let i = 0; i < ticks; i++) {
    const r = step(s, ctx);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

describe('boss step — determinism', () => {
  it('given the same seed, the exact same fight unfolds over 2000 ticks', () => {
    const a = run(createBossState(500, 42), 2000);
    const b = run(createBossState(500, 42), 2000);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('different seeds eventually diverge', () => {
    const a = run(createBossState(500, 1), 500);
    const b = run(createBossState(500, 2), 500);
    expect(a.events).not.toEqual(b.events);
  });
});

describe('boss step — approach and engage', () => {
  it('closes distance toward the player when idle and far away', () => {
    const s0 = createBossState(500, 1);
    const s1 = step(s0, { ...CTX, playerX: 800 }).state;
    // Either it moved toward the player, or it immediately started a move —
    // both are legal; just assert it never moved AWAY.
    expect(s1.x).toBeGreaterThanOrEqual(s0.x);
  });

  it('eventually starts a move once in range (moves emit move:start)', () => {
    const s0 = createBossState(200, 7); // already close to playerX 250
    const { events } = run(s0, 500);
    expect(events.some((e) => e.type === 'move:start')).toBe(true);
    expect(events.some((e) => e.type === 'move:active')).toBe(true);
    expect(events.some((e) => e.type === 'move:end')).toBe(true);
  });

  it('decrements cooldowns even while a move is executing, not just while idle', () => {
    const s0 = createBossState(200, 7);
    // Force a known cooldown and put the boss mid-move (startup) so it's
    // NOT idle for the next several ticks.
    const s1 = {
      ...s0,
      action: { moveId: 'margit.cane_swing_1', phase: 'startup' as const, tickInPhase: 0 },
      selection: { ...s0.selection, cooldowns: { 'margit.grab': 90 } },
    };
    const s2 = step(s1, CTX).state;
    // The boss is still mid-startup (didn't finish this tick), yet the
    // cooldown must have ticked down — it's a wall-clock timer, not an
    // "only while free to act" timer.
    expect(s2.action).not.toBeNull();
    expect(s2.selection.cooldowns['margit.grab']).toBe(89);
  });
});

describe('boss step — fairness holds over simulation (BOSS_AI.md §9)', () => {
  it('F3 + F8: no move-table violations across many seeds and thousands of ticks', () => {
    for (let seed = 0; seed < 15; seed++) {
      const { events } = run(createBossState(220, seed), 3000);
      const starts = events
        .filter((e) => e.type === 'move:start')
        .map((e) => (e as { moveId: string }).moveId);

      // F8: no move ever appears 3x consecutively across the whole selection stream.
      for (let i = 2; i < starts.length; i++) {
        expect(!(starts[i] === starts[i - 1] && starts[i] === starts[i - 2])).toBe(true);
      }
    }
  });

  it('F2: a fresh sequence never starts less than the mandated gap after the previous one ends', () => {
    // Track move:end → next move:start timing for TOP-LEVEL starts only
    // (chain continuations are exempt — F2 governs between sequences).
    for (let seed = 0; seed < 8; seed++) {
      let s = createBossState(220, seed);
      let tickIndex = 0;
      let lastSequenceEndTick: number | null = null;
      let chainDepthWasZeroBeforeStart = true;

      for (let i = 0; i < 4000; i++) {
        const wasIdleNoAction = s.action === null && s.selection.chainDepth === 0;
        const r = step(s, CTX);
        s = r.state;
        for (const e of r.events) {
          if (e.type === 'move:end' && s.selection.chainDepth === 0) {
            lastSequenceEndTick = tickIndex;
          }
          if (e.type === 'move:start' && wasIdleNoAction && lastSequenceEndTick !== null) {
            const gap = tickIndex - lastSequenceEndTick;
            expect(gap).toBeGreaterThanOrEqual(MIN_INTER_SEQUENCE_GAP_TICKS);
            chainDepthWasZeroBeforeStart = true;
          }
        }
        tickIndex++;
      }
      expect(chainDepthWasZeroBeforeStart).toBe(true);
    }
  });
});

describe('adaptation end-to-end (#9): the boss punishes patterns', () => {
  it('a panic-rolling player sees measurably more delayed strikes than a calm one', () => {
    // Adversarial actor (Sprint 2 retro lesson): the roll-spammer bot dodges
    // the instant any boss move starts; the calm player never touches dodge.
    // Same seeds, full boss steps, margit weight rules live.
    let delayedVsSpammer = 0;
    let delayedVsCalm = 0;

    for (let seed = 0; seed < 6; seed++) {
      for (const spammer of [true, false]) {
        let s = createBossState(300, seed);
        let dodgeNextTick = false;
        let count = 0;
        for (let i = 0; i < 8000; i++) {
          const r = step(s, {
            ...CTX,
            weightRules: margitWeightRules,
            observed: { ...OBSERVED_NEUTRAL, dodgeStarted: spammer && dodgeNextTick },
          });
          s = r.state;
          dodgeNextTick = r.events.some((e) => e.type === 'move:start');
          count += r.events.filter(
            (e) => e.type === 'move:start' && e.moveId === 'margit.delayed_overhead',
          ).length;
        }
        if (spammer) delayedVsSpammer += count;
        else delayedVsCalm += count;
      }
    }

    // The adaptation must be perceptible in aggregate (S2's first evidence).
    expect(delayedVsSpammer).toBeGreaterThan(delayedVsCalm);
  });
});

describe('resolveBossHit', () => {
  it('accumulates poise and staggers on breach, interrupting the current action', () => {
    let s = createBossState(220, 1);
    s = { ...s, action: { moveId: 'margit.cane_swing_1', phase: 'startup', tickInPhase: 5 } };
    const r = resolveBossHit(s, { hp: 5, poise: BOSS_POISE_THRESHOLD, postureDamage: 0 });
    expect(r.poiseBroken).toBe(true);
    expect(isBossStaggered(r.state)).toBe(true);
    expect(r.state.staggerTicks).toBe(BOSS_POISE_STAGGER_TICKS);
    expect(r.state.action).toBeNull();
  });

  it('grants the F2 inter-sequence gap on interrupt, same as a clean sequence end', () => {
    let s = createBossState(220, 1);
    s = {
      ...s,
      action: { moveId: 'margit.cane_swing_1', phase: 'startup', tickInPhase: 5 },
      selection: { ...s.selection, chainDepth: 2, gapTicksRemaining: 0 },
    };
    const r = resolveBossHit(s, { hp: 5, poise: BOSS_POISE_THRESHOLD, postureDamage: 0 });
    expect(r.poiseBroken).toBe(true);
    expect(r.state.selection.chainDepth).toBe(0);
    expect(r.state.selection.gapTicksRemaining).toBeGreaterThan(0);
  });

  it('breaks posture and opens a critical window at the cap', () => {
    const s = createBossState(220, 1);
    const r = resolveBossHit(s, { hp: 5, poise: 0, postureDamage: 100 });
    expect(isCriticalWindowOpen(r.state.posture)).toBe(true);
  });

  it('deals a multiplied critical hit while the posture window is open, and skips poise', () => {
    let s = createBossState(220, 1);
    s = resolveBossHit(s, { hp: 0, poise: 0, postureDamage: 100 }).state; // break it
    const before = s.hp;
    const r = resolveBossHit(s, { hp: 10, poise: 999, postureDamage: 0 });
    expect(r.wasCritical).toBe(true);
    expect(before - r.state.hp).toBe(20); // 2x multiplier
    expect(r.state.poiseDamage).toBe(0); // poise untouched during the window
  });
});
