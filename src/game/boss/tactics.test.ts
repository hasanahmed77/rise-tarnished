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
    const r = tickTactic(s, signals, ctx);
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
    const r = tickTactic(s, NEUTRAL_SIGNALS, { ...CTX, punishableOpening: true });
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
      const r = tickTactic(s, NEUTRAL_SIGNALS, ctx);
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
        sSpam = tickTactic(sSpam, spam, CTX).state;
        sCalm = tickTactic(sCalm, NEUTRAL_SIGNALS, CTX).state;
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
      const r = tickTactic(s, NEUTRAL_SIGNALS, CTX);
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
