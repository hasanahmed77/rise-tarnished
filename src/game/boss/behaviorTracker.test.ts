import { describe, expect, it } from 'vitest';
import {
  computeSignals,
  createTracker,
  trackEvent,
  trackTick,
  PANIC_ROLL_WINDOW_TICKS,
  TRACKER_WINDOW_SECONDS,
  type TrackerState,
  type TrackerTickInput,
} from './behaviorTracker';
import { TICKS_PER_SECOND } from '../combat/frameData';

const NEUTRAL: TrackerTickInput = {
  playerBlocking: false,
  distance: 70,
  dodgeStarted: false,
  attackStarted: false,
  bossStartupBegan: false,
};

function run(state: TrackerState, ticks: number, input: Partial<TrackerTickInput> = {}) {
  let s = state;
  for (let i = 0; i < ticks; i++) s = trackTick(s, { ...NEUTRAL, ...input });
  return s;
}

describe('behavior tracker signals', () => {
  it('dodgeReflex: rolls right after a boss startup read as panic (acceptance criterion)', () => {
    let s = createTracker();
    // Dodge-spam stream: every boss startup is answered with an instant roll.
    for (let i = 0; i < 10; i++) {
      s = trackTick(s, { ...NEUTRAL, bossStartupBegan: true });
      s = run(s, 3); // 3 ticks later — inside the panic window
      s = trackTick(s, { ...NEUTRAL, dodgeStarted: true });
      s = run(s, 30);
    }
    expect(computeSignals(s).dodgeReflex).toBeGreaterThanOrEqual(0.7);
  });

  it('dodgeReflex: rolls well after the tell are NOT panic', () => {
    let s = createTracker();
    for (let i = 0; i < 10; i++) {
      s = trackTick(s, { ...NEUTRAL, bossStartupBegan: true });
      s = run(s, PANIC_ROLL_WINDOW_TICKS + 10); // patient dodge
      s = trackTick(s, { ...NEUTRAL, dodgeStarted: true });
      s = run(s, 30);
    }
    expect(computeSignals(s).dodgeReflex).toBe(0);
  });

  it('dodgeTiming: i-frame successes over dodges', () => {
    let s = createTracker();
    for (let i = 0; i < 4; i++) {
      s = trackTick(s, { ...NEUTRAL, dodgeStarted: true });
      if (i < 3) s = trackEvent(s, { type: 'dodge:iframe-success' });
    }
    expect(computeSignals(s).dodgeTiming).toBeCloseTo(0.75);
  });

  it('turtleIndex: sustained blocking saturates the signal', () => {
    let s = createTracker();
    s = run(s, 10 * TICKS_PER_SECOND, { playerBlocking: true });
    expect(computeSignals(s).turtleIndex).toBeGreaterThanOrEqual(0.9);
  });

  it('rangeCamping: hovering far away registers, brawling close does not', () => {
    const far = run(createTracker(), 10 * TICKS_PER_SECOND, { distance: 300 });
    expect(computeSignals(far).rangeCamping).toBeGreaterThanOrEqual(0.9);

    const near = run(createTracker(), 10 * TICKS_PER_SECOND, { distance: 60 });
    expect(computeSignals(near).rangeCamping).toBe(0);
  });

  it('punishPattern: hits on recovery vs all hits', () => {
    let s = createTracker();
    s = trackEvent(s, { type: 'hit:landed', onBossRecovery: true });
    s = trackEvent(s, { type: 'hit:landed', onBossRecovery: true });
    s = trackEvent(s, { type: 'hit:landed', onBossRecovery: false });
    s = trackEvent(s, { type: 'hit:landed', onBossRecovery: false });
    expect(computeSignals(s).punishPattern).toBeCloseTo(0.5);
  });

  it('aggression: attack rate normalizes against the saturation constant', () => {
    let s = createTracker();
    // ~2 attacks/second for 5 seconds — above the 1.5 aps saturation.
    for (let sec = 0; sec < 5; sec++) {
      s = trackTick(s, { ...NEUTRAL, attackStarted: true });
      s = run(s, 29);
      s = trackTick(s, { ...NEUTRAL, attackStarted: true });
      s = run(s, 29);
    }
    expect(computeSignals(s).aggression).toBe(1);
  });

  it('the window actually rolls: old behavior ages out after 20s of neutrality', () => {
    let s = createTracker();
    // Heavy dodge-spam...
    for (let i = 0; i < 10; i++) {
      s = trackTick(s, { ...NEUTRAL, bossStartupBegan: true });
      s = trackTick(s, { ...NEUTRAL, dodgeStarted: true });
    }
    expect(computeSignals(s).dodgeReflex).toBeGreaterThan(0.9);
    // ...then nothing for a full window: the spam must be forgotten.
    s = run(s, (TRACKER_WINDOW_SECONDS + 1) * TICKS_PER_SECOND);
    expect(computeSignals(s).dodgeReflex).toBe(0);
  });

  it('healGreed reads 0 with no heals (flasks not implemented yet)', () => {
    const s = run(createTracker(), 600);
    expect(computeSignals(s).healGreed).toBe(0);
  });
});
