// The post-death recap's prompt construction and grounding check (#13, PRD
// G4, BOSS_AI.md §8, ADR-0004). Pure and engine-agnostic on purpose, same
// discipline as outcome.ts/reward.ts: the API route (src/app/api/recap) is a
// thin shell around this, so "does the prompt reflect the real log" and "does
// this response name something that never happened" are unit-testable
// without a server, a mock fetch, or a running Next.js app.
//
// The central claim this module exists to enforce: a recap grounded in a real
// log entry is worth having, and a recap that merely *sounds* grounded is
// worse than no recap at all, because this boss's decisions are genuinely
// legible and a fabricated explanation quietly spends that credibility. See
// ADR-0004.

import type { DecisionEvent } from '../boss/decisionLog';
import type { FightResult } from './reward';
import { margitMoves } from '../boss/margitMoves';

/** Every real move id and tactic name the model could truthfully mention.
 * Anything in this set that ISN'T in a specific attempt's log is a name the
 * model has no business using for THAT attempt — it's a real thing that
 * happened in some OTHER fight, which makes it a more dangerous hallucination
 * than a nonsense word: it reads as plausible. */
const KNOWN_TACTICS = ['NEUTRAL', 'PRESSURE', 'BAIT', 'PUNISH', 'REPOSITION', 'RECOVER'];
const KNOWN_MOVE_IDS = Object.keys(margitMoves);
const ALL_KNOWN_NAMES = [...KNOWN_TACTICS, ...KNOWN_MOVE_IDS];

export interface RecapInput {
  bossId: string;
  result: FightResult;
  durationTicks: number;
  decisions: DecisionEvent[];
}

/**
 * The decision that ended the fight: the last L3 (action) entry in the log.
 * Null if the log has nothing to point to — a short fight, or a fight that
 * predates #55 — in which case the caller should not attempt a recap at all
 * rather than build a prompt with nothing to ground it (see buildPrompt).
 */
export function findKillingDecision(decisions: DecisionEvent[]): DecisionEvent | null {
  for (let i = decisions.length - 1; i >= 0; i--) {
    if (decisions[i].layer === 'action') return decisions[i];
  }
  return null;
}

/** Trailing context alongside the killing blow: enough to show a pattern
 * (the tactic shift that led here), not the whole fight. Bounded independent
 * of #55's own MAX_LOGGED_DECISIONS cap — this is a prompt-size decision, not
 * a storage one, and the two are allowed to diverge. */
const CONTEXT_DECISIONS = 6;

export interface RecapPrompt {
  system: string;
  user: string;
}

/**
 * Build the model prompt from a real attempt. Returns null when there is
 * nothing to ground a recap in (victory, or a death with no recorded
 * decision) — the caller's job is to skip the model call entirely in that
 * case, not send a prompt asking the model to explain a fight it has no data
 * for.
 */
export function buildRecapPrompt(input: RecapInput): RecapPrompt | null {
  if (input.result !== 'death') return null;
  const killer = findKillingDecision(input.decisions);
  if (!killer) return null;

  const context = input.decisions.slice(-CONTEXT_DECISIONS);

  const system = [
    'You write a single short sentence explaining why a player died to a boss',
    'in a 2D action game, in the voice of a terse combat analyst. You are given',
    'the exact sequence of decisions the boss made, with the signals behind',
    'each one. Reference ONLY the moves, tactics, and signals that appear in',
    'the data you are given below — never name a move or tactic you were not',
    'shown, and never invent a reason not present in the signals. If the data',
    'does not clearly explain the death, say so plainly rather than guessing.',
    'One sentence. No hedging, no advice, no "try to" phrasing.',
  ].join(' ');

  const lines = context.map((d) => {
    const reasons = d.becauseSignals.length
      ? d.becauseSignals.map((s) => `${s.signal}=${s.value.toFixed(2)}`).join(', ')
      : 'no scored reason (triggered or authored)';
    return `tick ${d.tick} [${d.layer}] chose "${d.chose}" because ${reasons}`;
  });

  const user = [
    `The player died to ${input.bossId} after ${input.durationTicks} ticks.`,
    `The killing decision was tick ${killer.tick}, which chose "${killer.chose}".`,
    'Recent boss decisions leading up to it, oldest first:',
    ...lines,
  ].join('\n');

  return { system, user };
}

/**
 * Does `text` name a real move/tactic that this specific attempt's log never
 * recorded? A substring match, deliberately — move ids like
 * "margit.delayed_overhead" and tactic names like "PUNISH" are distinctive
 * enough that this catches a fabricated reference without needing a full
 * parse of the model's prose, and a false positive here only costs the
 * player a recap they'd otherwise have gotten, never a wrong one shown.
 */
export function isGrounded(text: string, decisions: DecisionEvent[]): boolean {
  const mentioned = new Set(decisions.map((d) => d.chose));
  for (const name of ALL_KNOWN_NAMES) {
    if (mentioned.has(name)) continue;
    if (text.includes(name)) return false;
  }
  return true;
}
