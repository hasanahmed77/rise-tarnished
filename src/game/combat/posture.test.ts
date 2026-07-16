import { describe, expect, it } from 'vitest';
import {
  applyPostureDamage,
  createPostureState,
  isCriticalWindowOpen,
  tickPosture,
  type PostureState,
} from './posture';
import { POSTURE_CRITICAL_WINDOW_TICKS, POSTURE_DECAY_PER_TICK, POSTURE_MAX } from './frameData';

describe('boss posture', () => {
  it('fills without breaking below the cap', () => {
    const { state, event } = applyPostureDamage(createPostureState(), 40);
    expect(state.value).toBe(40);
    expect(event).toBeNull();
    expect(isCriticalWindowOpen(state)).toBe(false);
  });

  it('breaks at the cap and opens the critical window (90 ticks)', () => {
    const s = applyPostureDamage(createPostureState(), 60).state;
    const r = applyPostureDamage(s, 40); // 100 → break
    expect(r.event).toBe('break');
    expect(r.state.criticalTicks).toBe(POSTURE_CRITICAL_WINDOW_TICKS);
    expect(r.state.value).toBe(0);
    expect(isCriticalWindowOpen(r.state)).toBe(true);
  });

  it('ignores posture damage while the window is open', () => {
    const broken = applyPostureDamage(applyPostureDamage(createPostureState(), 60).state, 40).state;
    const r = applyPostureDamage(broken, 50);
    expect(r.state).toEqual(broken); // unchanged — hit HP instead
    expect(r.event).toBeNull();
  });

  it('counts the window down and reports expiry on the last tick', () => {
    let s: PostureState = applyPostureDamage(
      applyPostureDamage(createPostureState(), 60).state,
      40,
    ).state;

    for (let i = 0; i < POSTURE_CRITICAL_WINDOW_TICKS - 1; i++) {
      const r = tickPosture(s);
      s = r.state;
      expect(r.event).toBeNull();
    }
    const last = tickPosture(s);
    expect(last.event).toBe('critical-expired');
    expect(isCriticalWindowOpen(last.state)).toBe(false);
    expect(last.state.value).toBe(0); // meter restarts empty after a break
  });

  it('decays posture over time while un-broken', () => {
    let s = applyPostureDamage(createPostureState(), 50).state;
    for (let i = 0; i < 60; i++) s = tickPosture(s).state; // one second
    expect(s.value).toBeCloseTo(50 - POSTURE_DECAY_PER_TICK * 60);
  });

  it('never decays below zero', () => {
    let s = applyPostureDamage(createPostureState(), 1).state;
    for (let i = 0; i < 120; i++) s = tickPosture(s).state;
    expect(s.value).toBe(0);
  });

  it('a slow drip never breaks posture if decay outpaces it', () => {
    // 2/s incoming vs 3/s decay → posture should hover near zero forever.
    let s = createPostureState();
    for (let sec = 0; sec < 10; sec++) {
      const r = applyPostureDamage(s, 2);
      expect(r.event).toBeNull();
      s = r.state;
      for (let i = 0; i < 60; i++) s = tickPosture(s).state;
    }
    expect(s.value).toBeLessThan(POSTURE_MAX / 10);
  });
});
