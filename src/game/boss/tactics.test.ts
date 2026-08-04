import { describe, expect, it } from 'vitest';
import {
  createTacticState,
  tickTactic,
  PUNISH_COOLDOWN_TICKS,
  TACTIC_MIN_HOLD_TICKS,
  type TacticContext,
  type TacticState,
} from './tactics';
import { NEUTRAL_SIGNALS, type BehaviorSignals } from './behaviorTracker';
import { createRng } from './rng';

const CTX: TacticContext = {
  distance: 70,
  bossPoiseFraction: 0,
  bossPostureFraction: 0,
  punishableOpening: false,
};

function run(
  state: TacticState,
  ticks: number,
  signals: BehaviorSignals = NEUTRAL_SIGNALS,
  ctx: TacticContext = CTX,
) {
  let s = state;
  const tactics: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const r = tickTactic(s, () => signals, ctx);
    s = r.state;
    if (r.changed) tactics.push(s.current);
  }
  return { state: s, changes: tactics };
}

describe('L2 tactic machine', () => {
  it('is deterministic: same seed + same inputs → same tactic stream', () => {
    const a = run(createTacticState(createRng(7)), 3000);
    const b = run(createTacticState(createRng(7)), 3000);
    expect(a.changes).toEqual(b.changes);
    expect(a.state).toEqual(b.state);
  });

  it('PUNISH pre-empts immediately when an opening appears', () => {
    const s = createTacticState(createRng(1));
    const r = tickTactic(s, () => NEUTRAL_SIGNALS, { ...CTX, punishableOpening: true });
    expect(r.state.current).toBe('PUNISH');
    expect(r.changed).toBe(true);
  });

  it('F5: at most one triggered punish per 4 seconds', () => {
    // A permanently-punishable player (worst case): count PUNISH entries.
    let s = createTacticState(createRng(3));
    let punishEntries = 0;
    const ctx = { ...CTX, punishableOpening: true };
    const TOTAL = PUNISH_COOLDOWN_TICKS * 5; // 20 seconds
    for (let i = 0; i < TOTAL; i++) {
      const r = tickTactic(s, () => NEUTRAL_SIGNALS, ctx);
      if (r.changed && r.state.current === 'PUNISH') punishEntries += 1;
      s = r.state;
    }
    // 20s / 4s cooldown → at most 5 entries (and at least 1).
    expect(punishEntries).toBeGreaterThanOrEqual(1);
    expect(punishEntries).toBeLessThanOrEqual(TOTAL / PUNISH_COOLDOWN_TICKS);
  });

  it('heavy dodge-spam signals shift intent toward BAIT (perceptibility, S2)', () => {
    const spam: BehaviorSignals = { ...NEUTRAL_SIGNALS, dodgeReflex: 1 };
    let baitTicks = 0;
    let totalMeasured = 0;
    // Many seeds; count time spent in BAIT vs neutral signals.
    for (let seed = 0; seed < 10; seed++) {
      let sSpam = createTacticState(createRng(seed));
      let sCalm = createTacticState(createRng(seed));
      let baitSpam = 0;
      let baitCalm = 0;
      for (let i = 0; i < 5000; i++) {
        sSpam = tickTactic(sSpam, () => spam, CTX).state;
        sCalm = tickTactic(sCalm, () => NEUTRAL_SIGNALS, CTX).state;
        if (sSpam.current === 'BAIT') baitSpam += 1;
        if (sCalm.current === 'BAIT') baitCalm += 1;
      }
      baitTicks += baitSpam - baitCalm;
      totalMeasured += 1;
    }
    // Across seeds, dodge-spam must produce clearly MORE time in BAIT.
    expect(baitTicks / totalMeasured).toBeGreaterThan(0);
  });

  it('never thrashes: consecutive changes are at least the minimum hold apart', () => {
    // A hold may expire and re-pick the SAME tactic (no change event), so
    // there is no upper bound on the gap between changes — only the lower
    // bound matters: intent shifts can't come faster than the hold window
    // (absent a PUNISH trigger, which this run never fires).
    let s = createTacticState(createRng(11));
    let sincePrev = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 20000; i++) {
      const r = tickTactic(s, () => NEUTRAL_SIGNALS, CTX);
      s = r.state;
      sincePrev += 1;
      if (r.changed) {
        gaps.push(sincePrev);
        sincePrev = 0;
      }
    }
    expect(gaps.length).toBeGreaterThan(1); // the machine does actually shift
    for (const gap of gaps.slice(1)) {
      expect(gap).toBeGreaterThanOrEqual(TACTIC_MIN_HOLD_TICKS);
    }
  });
});

/** Fraction of ticks spent in each tactic over a long run with fixed signals.
 * Time-in-tactic, not change-count: what a player feels is how long the boss
 * spends crowding them, not how often intent flips. */
function tacticShare(
  signals: BehaviorSignals,
  ctx: TacticContext = CTX,
  seed = 5,
  ticks = 60000,
): Record<string, number> {
  let s = createTacticState(createRng(seed));
  const held: Record<string, number> = {};
  for (let i = 0; i < ticks; i++) {
    s = tickTactic(s, () => signals, ctx).state;
    held[s.current] = (held[s.current] ?? 0) + 1;
  }
  for (const k of Object.keys(held)) held[k] /= ticks;
  return held;
}

// The player-facing bug these guard: Margit attacked without pause and never
// left a window to strike back. Root cause was a feedback loop — PRESSURE
// scored higher the *less* the player attacked, so being suppressed made the
// boss press harder, and RECOVER (the only tactic that disengages) was gated
// on damage the boss had taken, which stays zero while the player is losing.
describe('pressure/relief rhythm', () => {
  /** A player being smothered: barely landing attacks, not deliberately
   * turtling, boss untouched. The exact state the loop used to trap. */
  const SMOTHERED: BehaviorSignals = {
    ...NEUTRAL_SIGNALS,
    aggression: 0,
    turtleIndex: 0.1,
  };

  it('gives a smothered player relief instead of escalating on them', () => {
    const share = tacticShare(SMOTHERED);
    // RECOVER is the only tactic that stops selecting moves entirely
    // (bossCombat: it returns after approach()), so it is what a window is
    // actually made of.
    //
    // Asserted as a BAND, not a floor. The first attempt at this fix scored
    // RECOVER well above the field and — because the softmax temperature is
    // low — handed it 75% of the fight, replacing "never lets up" with "barely
    // fights". Both failure modes have to be caught, so the ceiling matters as
    // much as the floor.
    expect(share.RECOVER ?? 0).toBeGreaterThan(0.15);
    expect(share.RECOVER ?? 0).toBeLessThan(0.45);
    expect(share.PRESSURE ?? 0).toBeLessThan(share.RECOVER ?? 0);
  });

  it('does not let PRESSURE dominate a player who simply is not attacking', () => {
    // Regression guard on the removed `1 + (1 - aggression)` term: a passive
    // player must not, by itself, drive the boss into its most aggressive
    // stance. Compare against an identical player who IS attacking.
    const attacking = tacticShare({ ...SMOTHERED, aggression: 0.9 });
    const passive = tacticShare(SMOTHERED);
    expect(passive.PRESSURE ?? 0).toBeLessThanOrEqual((attacking.PRESSURE ?? 0) + 0.05);
  });

  it('still answers deliberate turtling with pressure', () => {
    // The fix must not cost the anti-turtle behaviour: blocking is a chosen
    // action and should still invite crowding, unlike mere passivity.
    const turtling = tacticShare({ ...NEUTRAL_SIGNALS, turtleIndex: 0.95, aggression: 0.2 });
    expect(turtling.PRESSURE ?? 0).toBeGreaterThan(turtling.RECOVER ?? 0);
  });

  it('returns to pressure once the player is landing hits freely', () => {
    // Relief is self-correcting, not a permanent softening: an aggressive
    // player should see markedly less RECOVER than a suppressed one.
    const suppressed = tacticShare(SMOTHERED);
    const thriving = tacticShare({ ...NEUTRAL_SIGNALS, aggression: 1, turtleIndex: 0.1 });
    expect(thriving.RECOVER ?? 0).toBeLessThan(suppressed.RECOVER ?? 0);
  });
});
