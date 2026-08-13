// #13 / ADR-0004 — prompt construction and grounding for the death recap.
// See recap.ts's header for why this lives outside the route: it's pure,
// engine-agnostic logic, so its correctness is provable without a server.

import { describe, expect, it } from 'vitest';
import { buildRecapPrompt, findKillingDecision, isGrounded } from './recap';
import type { DecisionEvent } from '../boss/decisionLog';

function decision(over: Partial<DecisionEvent>): DecisionEvent {
  return {
    tick: 0,
    layer: 'action',
    chose: 'margit.cane_swing_1',
    becauseSignals: [],
    playerStateSnapshot: { hp: 100, stamina: 50, distance: 90, action: null },
    ...over,
  };
}

describe('findKillingDecision', () => {
  it('is the last action-layer entry, ignoring trailing tactic changes', () => {
    const log = [
      decision({ tick: 1, layer: 'action', chose: 'margit.cane_swing_1' }),
      decision({ tick: 2, layer: 'tactic', chose: 'PRESSURE' }),
      decision({ tick: 3, layer: 'action', chose: 'margit.grab' }),
      decision({ tick: 4, layer: 'tactic', chose: 'RECOVER' }),
    ];
    expect(findKillingDecision(log)?.chose).toBe('margit.grab');
  });

  it('is null for an empty log', () => {
    expect(findKillingDecision([])).toBeNull();
  });

  it('is null when the log has tactic changes but no action ever fired', () => {
    // A pathologically short fight, or a log truncated by #55's own cap.
    expect(findKillingDecision([decision({ layer: 'tactic', chose: 'NEUTRAL' })])).toBeNull();
  });
});

describe('buildRecapPrompt', () => {
  const killer = decision({
    tick: 500,
    layer: 'action',
    chose: 'margit.delayed_overhead',
    becauseSignals: [{ signal: 'dodgeReflex', value: 0.82, effect: 3.46 }],
  });

  it('returns null for a victory — nothing to explain', () => {
    expect(
      buildRecapPrompt({
        bossId: 'margit',
        result: 'victory',
        durationTicks: 500,
        decisions: [killer],
      }),
    ).toBeNull();
  });

  it('returns null for a death with no action decision to point to', () => {
    expect(
      buildRecapPrompt({ bossId: 'margit', result: 'death', durationTicks: 10, decisions: [] }),
    ).toBeNull();
  });

  it('names the killing move and includes its real reason', () => {
    const prompt = buildRecapPrompt({
      bossId: 'margit',
      result: 'death',
      durationTicks: 500,
      decisions: [killer],
    });
    expect(prompt).not.toBeNull();
    expect(prompt!.user).toContain('margit.delayed_overhead');
    expect(prompt!.user).toContain('dodgeReflex=0.82');
  });

  it('instructs the model to stay inside the given data', () => {
    const prompt = buildRecapPrompt({
      bossId: 'margit',
      result: 'death',
      durationTicks: 500,
      decisions: [killer],
    });
    expect(prompt!.system.toLowerCase()).toContain('never name a move or tactic you were not');
  });

  it('caps context to the trailing window rather than the whole fight', () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      decision({ tick: i, layer: 'action', chose: `margit.cane_swing_1` }),
    );
    long[long.length - 1] = killer;
    const prompt = buildRecapPrompt({
      bossId: 'margit',
      result: 'death',
      durationTicks: 900,
      decisions: long,
    });
    // One line per included decision, plus the fixed lead-in lines.
    const decisionLines = prompt!.user.split('\n').filter((l) => l.startsWith('tick '));
    expect(decisionLines.length).toBeLessThan(long.length);
    expect(decisionLines.length).toBeLessThanOrEqual(6);
  });

  it('reports "no scored reason" for a trigger/authored pick rather than inventing one', () => {
    const punish = decision({ tick: 1, layer: 'action', chose: 'margit.grab', becauseSignals: [] });
    const prompt = buildRecapPrompt({
      bossId: 'margit',
      result: 'death',
      durationTicks: 100,
      decisions: [punish],
    });
    expect(prompt!.user).toContain('no scored reason');
  });
});

describe('isGrounded', () => {
  const log = [
    decision({ tick: 1, layer: 'tactic', chose: 'BAIT' }),
    decision({ tick: 2, layer: 'action', chose: 'margit.delayed_overhead' }),
  ];

  it('accepts a response that only names what actually happened', () => {
    expect(isGrounded('Margit read your panic-rolls and baited a heavy swing.', log)).toBe(true);
  });

  it('accepts prose that never names a move or tactic at all', () => {
    expect(isGrounded('You were caught off guard by a delayed strike.', log)).toBe(true);
  });

  it('rejects a response naming a real move this attempt never chose', () => {
    // margit.grab is a genuine move id — the dangerous case, since it reads
    // as plausible rather than as nonsense.
    expect(isGrounded('Margit grabbed you with margit.grab.', log)).toBe(false);
  });

  it('rejects a response naming a real tactic this attempt never entered', () => {
    expect(isGrounded('The boss pressed with PUNISH intent.', log)).toBe(false);
  });

  it('is case-sensitive to the real ids, not a loose word match', () => {
    // "grab" alone isn't the id ("margit.grab" is) and isn't in ALL_KNOWN_NAMES
    // as a bare word, so ordinary prose using the word must not trip it.
    expect(isGrounded('Margit tried to grab you but missed.', log)).toBe(true);
  });
});
