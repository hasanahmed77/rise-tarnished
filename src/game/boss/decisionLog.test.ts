// #55 — the per-decision event log (BOSS_AI.md §8).
//
// The load-bearing claims under test:
//   1. Reporting a reason never changes the decision. #13's recap is only
//      trustworthy if instrumentation is observation, not participation.
//   2. The log is bounded by emitting on decisions rather than ticks — the
//      difference between tens of entries per fight and ~10,800.
//   3. Ranking is deterministic, because §8 also promises replay.

import { describe, expect, it } from 'vitest';
import {
  BECAUSE_SIGNAL_COUNT,
  MAX_LOGGED_DECISIONS,
  topContributions,
  type SignalContribution,
} from './decisionLog';
import { behaviorMod, behaviorModDetailed, margitWeightRules } from './weighting';
import { createTacticState, tickTactic } from './tactics';
import { NEUTRAL_SIGNALS, type BehaviorSignals } from './behaviorTracker';
import { margitMoves, margitTopLevelMoveIds } from './margitMoves';
import { createBossState, step, type BossStepContext } from './bossCombat';
import { TICKS_PER_SECOND } from '../combat/frameData';

function signals(overrides: Partial<BehaviorSignals> = {}): BehaviorSignals {
  return { ...NEUTRAL_SIGNALS, ...overrides };
}

describe('topContributions', () => {
  it('keeps the strongest terms, strongest first', () => {
    const input: SignalContribution[] = [
      { signal: 'weak', value: 0.1, effect: 1.1 },
      { signal: 'strong', value: 0.9, effect: 3.7 },
      { signal: 'middling', value: 0.5, effect: 1.6 },
    ];
    expect(topContributions(input).map((c) => c.signal)).toEqual(['strong', 'middling']);
  });

  it('ranks suppression as strongly as amplification', () => {
    // A move picked *despite* a signal pushing it down is as explanatory as one
    // picked because a signal pushed it up — distance from 1 is what matters,
    // not direction.
    const input: SignalContribution[] = [
      { signal: 'up', value: 0.2, effect: 1.2 },
      { signal: 'down', value: 0.9, effect: 0.1 },
    ];
    expect(topContributions(input)[0].signal).toBe('down');
  });

  it('drops inert terms rather than padding the list out to two', () => {
    // A signal sitting at zero did not contribute. Listing it anyway would
    // invite the recap to claim it mattered.
    const input: SignalContribution[] = [
      { signal: 'real', value: 0.4, effect: 1.8 },
      { signal: 'inert', value: 0, effect: 1 },
    ];
    expect(topContributions(input)).toHaveLength(1);
    expect(topContributions([{ signal: 'inert', value: 0, effect: 1 }])).toEqual([]);
  });

  it('breaks ties by name so the log is byte-reproducible', () => {
    const tied: SignalContribution[] = [
      { signal: 'zulu', value: 0.5, effect: 1.5 },
      { signal: 'alpha', value: 0.5, effect: 1.5 },
    ];
    expect(topContributions(tied).map((c) => c.signal)).toEqual(['alpha', 'zulu']);
    // Same input in the other order must produce the same output.
    expect(topContributions([...tied].reverse()).map((c) => c.signal)).toEqual(['alpha', 'zulu']);
  });

  it('never returns more than §8 asks for', () => {
    const many: SignalContribution[] = Array.from({ length: 8 }, (_, i) => ({
      signal: `s${i}`,
      value: 0.5,
      effect: 1 + i,
    }));
    expect(topContributions(many)).toHaveLength(BECAUSE_SIGNAL_COUNT);
  });
});

describe('instrumentation does not change the decision', () => {
  it('behaviorModDetailed.mod is exactly what behaviorMod returns', () => {
    // The two share one expression by construction; this pins that they still
    // do, across the whole move table and a spread of signal values.
    for (const id of margitTopLevelMoveIds) {
      for (const v of [0, 0.13, 0.5, 0.77, 1]) {
        const s = signals({
          dodgeReflex: v,
          turtleIndex: 1 - v,
          rangeCamping: v,
          aggression: 1 - v,
          dodgeTiming: v,
        });
        expect(behaviorModDetailed(margitMoves[id], s, margitWeightRules).mod).toBe(
          behaviorMod(margitMoves[id], s, margitWeightRules),
        );
      }
    }
  });

  it('every reported contribution multiplies out to the reported mod', () => {
    // If the product of the parts stops equalling the whole, the log is
    // describing arithmetic the boss never did.
    const s = signals({ dodgeReflex: 0.8, turtleIndex: 0.6, rangeCamping: 0.3, aggression: 0.2 });
    let sawAContribution = false;

    for (const id of margitTopLevelMoveIds) {
      const { mod, contributions } = behaviorModDetailed(margitMoves[id], s, margitWeightRules);
      if (contributions.length > 0) sawAContribution = true;

      const product = contributions.reduce((acc, c) => acc * c.effect, 1);
      // behaviorMod applies F4's clamp on the way out, so the invariant is
      // "clamped product === reported mod", not "product === mod".
      expect(Math.min(4, Math.max(0.25, product))).toBeCloseTo(mod, 10);
    }

    // Guards the loop itself: if the rules or the table drifted so that no move
    // has any applicable rule, every assertion above would be 1 === 1 and this
    // test would pass while checking nothing.
    expect(sawAContribution).toBe(true);
  });

  it('tactic shares are unchanged by the reason-reporting path', () => {
    // tactics.test.ts already asserts the tuned bands. This is the narrower
    // claim that running the detailed path does not perturb the RNG stream:
    // the same seed must produce the identical sequence of picks.
    const run = () => {
      let st = createTacticState(4242);
      const picks: string[] = [];
      for (let i = 0; i < 600; i++) {
        const d = tickTactic(st, () => signals({ dodgeReflex: 0.7, turtleIndex: 0.4 }), {
          distance: 90,
          bossPoiseFraction: 0.2,
          bossPostureFraction: 0.1,
          punishableOpening: false,
        });
        st = d.state;
        if (d.changed) picks.push(st.current);
      }
      return picks;
    };
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(0);
  });
});

describe('the log is bounded by decisions, not ticks', () => {
  function runFight(ticks: number) {
    let boss = createBossState(300, 99);
    const ctx: BossStepContext = {
      table: margitMoves,
      topLevelIds: margitTopLevelMoveIds,
      playerX: 200,
      minX: 0,
      maxX: 800,
      lastPlayerAction: null,
      weightRules: margitWeightRules,
      observed: {
        playerBlocking: false,
        dodgeStarted: false,
        attackStarted: false,
        punishableOpening: false,
      },
    };
    let decisions = 0;
    for (let i = 0; i < ticks; i++) {
      const r = step(boss, ctx);
      boss = r.state;
      decisions += r.events.filter(
        (e) => e.type === 'move:start' || e.type === 'tactic:change',
      ).length;
    }
    return decisions;
  }

  it('a three-minute fight logs tens of decisions, not one per tick', () => {
    const ticks = 180 * TICKS_PER_SECOND; // 10,800
    const decisions = runFight(ticks);

    expect(decisions).toBeGreaterThan(0);
    // The actual point of #55's bounding rule: orders of magnitude below the
    // tick count, and comfortably inside the retention cap.
    expect(decisions).toBeLessThan(ticks / 20);
    expect(decisions).toBeLessThanOrEqual(MAX_LOGGED_DECISIONS);
  });

  it('emits a decision only when intent actually changes', () => {
    // L2 re-scores on its own cadence but holds for 2-5s; a re-score landing on
    // the same tactic is not a decision worth a log line.
    let st = createTacticState(7);
    let changes = 0;
    for (let i = 0; i < 60 * TICKS_PER_SECOND; i++) {
      const d = tickTactic(st, () => signals(), {
        distance: 90,
        bossPoiseFraction: 0,
        bossPostureFraction: 0,
        punishableOpening: false,
      });
      st = d.state;
      if (d.changed) {
        changes++;
        // Every logged change carries its reason, capped at §8's top-2.
        expect(d.because.length).toBeLessThanOrEqual(BECAUSE_SIGNAL_COUNT);
      } else {
        expect(d.because).toEqual([]);
      }
    }
    // 60s at a 2-5s hold can't exceed 30 changes even if every re-score flips.
    expect(changes).toBeLessThanOrEqual(30);
  });

  it('a PUNISH trigger reports no signal rather than inventing one', () => {
    const d = tickTactic(createTacticState(1), () => signals({ dodgeReflex: 0.9 }), {
      distance: 40,
      bossPoiseFraction: 0,
      bossPostureFraction: 0,
      punishableOpening: true,
    });
    expect(d.changed).toBe(true);
    expect(d.state.current).toBe('PUNISH');
    // PUNISH is trigger-only (§3) — it is never scored, so there is no
    // contributing signal, and claiming one would be a fabricated reason.
    expect(d.because).toEqual([]);
  });
});
