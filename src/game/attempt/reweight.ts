// Between-attempt LLM reweighting: prompt construction and response
// validation (#64, ADR-0002's promised sibling to #13's recap — "OpenAI
// adjusts starting weights for the next attempt; it never participates in
// the frame loop"). Pure and engine-agnostic, same discipline as recap.ts:
// the API route (src/app/api/reweight) is a thin shell around this so the
// prompt shape and the closed-vocabulary validation are unit-testable
// without a server or a real network call.
//
// The central claim this module exists to enforce: an LLM-proposed
// reweighting can only ever say something a human tuner authoring a
// WeightRule/BASE_SCORE entry by hand could already say — a closed
// vocabulary of real tag/tactic names, numbers clamped to the same order of
// magnitude the hand-authored tables already live in. Anything else
// (an unknown name, a non-numeric value, an out-of-range number) is
// silently dropped, never partially trusted. F4 (weighting.ts) still clamps
// the final multiplier at combat time regardless — this is belt, F4 is
// buckle.

import type { DecisionEvent } from '../boss/decisionLog';
import { BASE_SCORE, type ScoredTactic } from '../boss/tactics';
import { margitWeightRules } from '../boss/weighting';
import type { MoveTag } from '../boss/types';

const KNOWN_TACTICS = Object.keys(BASE_SCORE) as ScoredTactic[];
/** The only tags a WeightRule can name for this boss — deliberately not
 * every MoveTag that exists (types.ts), only the ones Margit's table
 * actually uses. A proposal naming a real-but-unused tag would silently do
 * nothing at combat time (behaviorModDetailed only reads rules that exist),
 * so restricting the vocabulary here to what's live keeps a rejected
 * proposal and an inert one from looking the same. */
const KNOWN_TAGS = Array.from(new Set(margitWeightRules.map((r) => r.tag))) as MoveTag[];

/** Gain bound for a WeightRule. margitWeightRules' hand-authored gains sit
 * in [-0.5, 3] today; this is deliberately wider so the model has real room
 * to move without unbounded drift — an order of magnitude, not a hard
 * ceiling equal to today's max. F4 still clamps the resulting multiplier at
 * combat time no matter what a rule's gain is. */
export const GAIN_MIN = -4;
export const GAIN_MAX = 4;

/** Bound for a tactic's BASE_SCORE. The hand-authored table (tactics.ts)
 * lives in [0.5, 1.0]; same reasoning as GAIN_MIN/MAX above. */
export const BASE_SCORE_MIN = 0.1;
export const BASE_SCORE_MAX = 2;

export interface ReweightInput {
  bossId: string;
  /** The attempt's full decision log (#55) — every reweight looks at one
   * attempt at a time, mirroring recap.ts; a multi-attempt trend is future
   * scope, not this issue's. */
  decisions: DecisionEvent[];
  /** The player's current persisted overrides for this boss (empty on a
   * player's first attempt), so the model adjusts from where they actually
   * are, not from the hardcoded defaults every player starts at. */
  currentWeightRuleGains: Partial<Record<MoveTag, number>>;
  currentTacticBaseScore: Partial<Record<ScoredTactic, number>>;
}

export interface ReweightPrompt {
  system: string;
  user: string;
}

/**
 * Build the model prompt from a real attempt's decision log. Returns null
 * when there is nothing to reweight from — an empty log — same "don't ask
 * the model to explain data it wasn't given" discipline as
 * buildRecapPrompt.
 */
export function buildReweightPrompt(input: ReweightInput): ReweightPrompt | null {
  if (input.decisions.length === 0) return null;

  const system = [
    'You tune a boss AI in a 2D action game between attempts, based on the',
    'decisions it made and the player behaviour signals behind them in the',
    'last attempt. Respond with ONLY a JSON object of this exact shape:',
    '{"tacticBaseScoreAdjustments": {"<tactic>": <number>},',
    '"weightRuleAdjustments": {"<tag>": <number>}}.',
    `Valid tactic names: ${KNOWN_TACTICS.join(', ')}.`,
    `Valid tag names: ${KNOWN_TAGS.join(', ')}.`,
    'Never use a name outside those two lists. Omit any key you would not',
    'change. Values are absolute replacements, not deltas. Make small,',
    'targeted adjustments that counter a pattern actually visible in the',
    'data below — never invent a pattern that is not in the log.',
  ].join(' ');

  const lines = input.decisions.map((d) => {
    const reasons = d.becauseSignals.length
      ? d.becauseSignals.map((s) => `${s.signal}=${s.value.toFixed(2)}`).join(', ')
      : 'no scored reason (triggered or authored)';
    return `tick ${d.tick} [${d.layer}] chose "${d.chose}" because ${reasons}`;
  });

  const currentTactics = KNOWN_TACTICS.map(
    (t) => `${t}=${input.currentTacticBaseScore[t] ?? BASE_SCORE[t]}`,
  ).join(', ');
  const currentGains = KNOWN_TAGS.map((tag) => {
    const rule = margitWeightRules.find((r) => r.tag === tag);
    const defaultGain = rule?.gain ?? 0;
    return `${tag}=${input.currentWeightRuleGains[tag] ?? defaultGain}`;
  }).join(', ');

  const user = [
    `Boss: ${input.bossId}. Current tactic base scores: ${currentTactics}.`,
    `Current weight rule gains: ${currentGains}.`,
    "This attempt's decisions, oldest first:",
    ...lines,
  ].join('\n');

  return { system, user };
}

export interface ValidatedWeights {
  tacticBaseScoreAdjustments: Partial<Record<ScoredTactic, number>>;
  weightRuleAdjustments: Partial<Record<MoveTag, number>>;
}

function clampFinite(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse and validate the model's raw response text against the closed
 * vocabulary and numeric bounds above. Never throws — a malformed or
 * partially-malformed response degrades to whatever subset of it was
 * actually valid (possibly empty), mirroring recap.ts's "a wrong answer is
 * not an option, a missing one is normal" stance.
 */
export function validateAndClampWeights(text: string): ValidatedWeights {
  const result: ValidatedWeights = { tacticBaseScoreAdjustments: {}, weightRuleAdjustments: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return result;
  }
  if (typeof parsed !== 'object' || parsed === null) return result;

  const tacticRaw = (parsed as { tacticBaseScoreAdjustments?: unknown }).tacticBaseScoreAdjustments;
  if (typeof tacticRaw === 'object' && tacticRaw !== null) {
    for (const tactic of KNOWN_TACTICS) {
      const value = clampFinite(
        (tacticRaw as Record<string, unknown>)[tactic],
        BASE_SCORE_MIN,
        BASE_SCORE_MAX,
      );
      if (value !== null) result.tacticBaseScoreAdjustments[tactic] = value;
    }
  }

  const tagRaw = (parsed as { weightRuleAdjustments?: unknown }).weightRuleAdjustments;
  if (typeof tagRaw === 'object' && tagRaw !== null) {
    for (const tag of KNOWN_TAGS) {
      const value = clampFinite((tagRaw as Record<string, unknown>)[tag], GAIN_MIN, GAIN_MAX);
      if (value !== null) result.weightRuleAdjustments[tag] = value;
    }
  }

  return result;
}
