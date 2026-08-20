// #64 / ADR-0002 — prompt construction and closed-vocabulary validation for
// between-attempt LLM reweighting. See reweight.ts's header for why this
// lives outside the route: pure, engine-agnostic logic, provable without a
// server or a real model call.

import { describe, expect, it } from 'vitest';
import {
  buildReweightPrompt,
  validateAndClampWeights,
  BASE_SCORE_MAX,
  BASE_SCORE_MIN,
  GAIN_MAX,
  GAIN_MIN,
} from './reweight';
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

describe('buildReweightPrompt', () => {
  const log = [
    decision({
      tick: 10,
      layer: 'tactic',
      chose: 'BAIT',
      becauseSignals: [{ signal: 'dodgeReflex', value: 0.9, effect: 3.7 }],
    }),
    decision({
      tick: 12,
      layer: 'action',
      chose: 'margit.delayed_overhead',
      becauseSignals: [{ signal: 'dodgeReflex', value: 0.9, effect: 3.7 }],
    }),
  ];

  it('returns null for an empty log — nothing to reweight from', () => {
    expect(
      buildReweightPrompt({
        bossId: 'margit',
        decisions: [],
        currentWeightRuleGains: {},
        currentTacticBaseScore: {},
      }),
    ).toBeNull();
  });

  it('includes the real decisions and current weights', () => {
    const prompt = buildReweightPrompt({
      bossId: 'margit',
      decisions: log,
      currentWeightRuleGains: {},
      currentTacticBaseScore: {},
    });
    expect(prompt).not.toBeNull();
    expect(prompt!.user).toContain('margit.delayed_overhead');
    expect(prompt!.user).toContain('dodgeReflex=0.90');
    expect(prompt!.user).toContain('margit');
  });

  it("reflects a player's existing overrides, not just the hardcoded defaults", () => {
    const prompt = buildReweightPrompt({
      bossId: 'margit',
      decisions: log,
      currentWeightRuleGains: { delayed: 1.5 },
      currentTacticBaseScore: { BAIT: 0.9 },
    });
    expect(prompt!.user).toContain('delayed=1.5');
    expect(prompt!.user).toContain('BAIT=0.9');
  });

  it('names only the real, valid tactic and tag vocabulary', () => {
    const prompt = buildReweightPrompt({
      bossId: 'margit',
      decisions: log,
      currentWeightRuleGains: {},
      currentTacticBaseScore: {},
    });
    expect(prompt!.system).toContain('NEUTRAL');
    expect(prompt!.system).toContain('delayed');
    expect(prompt!.system).not.toContain('PUNISH,'); // PUNISH is trigger-only, never scored
  });
});

describe('validateAndClampWeights', () => {
  it('accepts a well-formed response with known names', () => {
    const result = validateAndClampWeights(
      JSON.stringify({
        tacticBaseScoreAdjustments: { BAIT: 0.8 },
        weightRuleAdjustments: { delayed: 2 },
      }),
    );
    expect(result.tacticBaseScoreAdjustments).toEqual({ BAIT: 0.8 });
    expect(result.weightRuleAdjustments).toEqual({ delayed: 2 });
  });

  it('drops an unknown tactic or tag name rather than passing it through', () => {
    const result = validateAndClampWeights(
      JSON.stringify({
        tacticBaseScoreAdjustments: { PUNISH: 0.9, NOT_A_TACTIC: 5 },
        weightRuleAdjustments: { aoe: 2, not_a_tag: 9 },
      }),
    );
    // PUNISH is a real Tactic name but not scoreable — must not pass either.
    expect(result.tacticBaseScoreAdjustments).toEqual({});
    // 'aoe' is a real MoveTag but not one of Margit's actual rule tags.
    expect(result.weightRuleAdjustments).toEqual({});
  });

  it('clamps an in-range-vocabulary but out-of-bounds number rather than dropping it', () => {
    const result = validateAndClampWeights(
      JSON.stringify({
        tacticBaseScoreAdjustments: { BAIT: 999 },
        weightRuleAdjustments: { delayed: -999 },
      }),
    );
    expect(result.tacticBaseScoreAdjustments.BAIT).toBe(BASE_SCORE_MAX);
    expect(result.weightRuleAdjustments.delayed).toBe(GAIN_MIN);
  });

  it('clamps at the low end too', () => {
    const result = validateAndClampWeights(
      JSON.stringify({
        tacticBaseScoreAdjustments: { BAIT: -999 },
        weightRuleAdjustments: { delayed: 999 },
      }),
    );
    expect(result.tacticBaseScoreAdjustments.BAIT).toBe(BASE_SCORE_MIN);
    expect(result.weightRuleAdjustments.delayed).toBe(GAIN_MAX);
  });

  it('drops a non-numeric value', () => {
    const result = validateAndClampWeights(
      JSON.stringify({
        tacticBaseScoreAdjustments: { BAIT: 'higher please' },
        weightRuleAdjustments: { delayed: null },
      }),
    );
    expect(result.tacticBaseScoreAdjustments).toEqual({});
    expect(result.weightRuleAdjustments).toEqual({});
  });

  it('returns an empty result for malformed JSON rather than throwing', () => {
    expect(() => validateAndClampWeights('not json at all')).not.toThrow();
    const result = validateAndClampWeights('not json at all');
    expect(result).toEqual({ tacticBaseScoreAdjustments: {}, weightRuleAdjustments: {} });
  });

  it('returns an empty result for a JSON value that is not an object', () => {
    const result = validateAndClampWeights(JSON.stringify([1, 2, 3]));
    expect(result).toEqual({ tacticBaseScoreAdjustments: {}, weightRuleAdjustments: {} });
  });

  it('handles a response with neither key present', () => {
    const result = validateAndClampWeights(JSON.stringify({}));
    expect(result).toEqual({ tacticBaseScoreAdjustments: {}, weightRuleAdjustments: {} });
  });
});
