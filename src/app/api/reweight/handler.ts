// The orchestration behind POST /api/reweight (#64, ADR-0002's promised
// sibling to #13's recap), split out of route.ts for the same reason
// recap's handler is: contract-testable without a live Next.js request scope
// or a real network call. `supabase` and `callProvider` are both injected.
//
// This function is the only place that decides whether a player's persisted
// weight overrides change. Every failure path (no attempt row, empty log,
// provider error, an all-empty validated proposal) converges on
// `{ updated: false }` rather than throwing — reweighting is enrichment
// (ADR-0002: "Falls back to heuristic weights if unavailable"), so a failed
// attempt to reweight must leave the player's existing weights untouched,
// never partially written or erased.

import {
  buildReweightPrompt,
  validateAndClampWeights,
  type ReweightPrompt,
} from '@/game/attempt/reweight';
import type { DecisionEvent } from '@/game/boss/decisionLog';
import type { ScoredTactic } from '@/game/boss/tactics';
import type { MoveTag } from '@/game/boss/types';

export const REWEIGHT_MODEL = 'gpt-4o-mini';

/** Same bound as recap's provider call, same reasoning: this route is
 * non-blocking from the player's point of view, but the request must still
 * resolve rather than sit as a leaked connection. */
const PROVIDER_TIMEOUT_MS = 8000;

interface AttemptLogsRow {
  boss_id: string;
  log: unknown;
}

interface WeightOverridesRow {
  tactic_base_score: unknown;
  weight_rule_gains: unknown;
}

/** The exact shape this handler calls on a Supabase client — structural,
 * mirroring recap's SupabaseLike (see that file for why `PromiseLike`, not
 * `Promise`, is what lets the real client satisfy this with no cast at the
 * route.ts call site). Adds `.rpc()` for the write recap never needed. */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        single(): PromiseLike<{ data: unknown; error: unknown }>;
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type ProviderCall = (prompt: ReweightPrompt) => Promise<string>;

/**
 * Call the model. Not used directly by tests (see ProviderCall) — the real
 * implementation route.ts wires up. Bare `fetch`, no SDK (ADR-0004), same
 * shape as recap's callOpenAI.
 */
export const callOpenAI: ProviderCall = async (prompt) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: REWEIGHT_MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 200,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI responded ${res.status}`);
    }
    const body: unknown = await res.json();
    const text = extractMessageContent(body);
    if (!text) throw new Error('OpenAI response had no message content');
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
};

function extractMessageContent(body: unknown): string | null {
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown }).message;
  const content = (message as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : null;
}

/** Same defensive read-back as recap's extractDecisions — the jsonb `log`
 * column is trusted as `unknown` on the way back out, never assumed to
 * match #55's write-time shape. */
function extractDecisions(log: unknown): DecisionEvent[] {
  const decisions = (log as { decisions?: unknown } | null)?.decisions;
  return Array.isArray(decisions) ? (decisions as DecisionEvent[]) : [];
}

function extractOverrideMap<K extends string>(value: unknown): Partial<Record<K, number>> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Partial<Record<K, number>> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) result[key as K] = v;
  }
  return result;
}

export interface ReweightRequestInput {
  attemptId: string;
  supabase: SupabaseLike;
  /** Defaults to the real provider; tests inject a fixture. */
  callProvider?: ProviderCall;
}

export async function handleReweightRequest({
  attemptId,
  supabase,
  callProvider = callOpenAI,
}: ReweightRequestInput): Promise<{ updated: boolean }> {
  // RLS scopes this to the caller's own row — a mismatched or missing id
  // just returns no data, never another user's attempt.
  const { data: attemptData } = await supabase
    .from('attempt_logs')
    .select('boss_id, log')
    .eq('id', attemptId)
    .single();
  const attempt = attemptData as AttemptLogsRow | null;
  if (!attempt) return { updated: false };

  const decisions = extractDecisions(attempt.log);

  // The player's current overrides for this boss — RLS-scoped to the
  // caller's own row, absent entirely on a player's first attempt against
  // this boss (that's a normal, valid state: everything defaults to the
  // hardcoded tables, see reweight.ts's buildReweightPrompt).
  const { data: overridesData } = await supabase
    .from('boss_weight_overrides')
    .select('tactic_base_score, weight_rule_gains')
    .eq('boss_id', attempt.boss_id)
    .maybeSingle();
  const overrides = overridesData as WeightOverridesRow | null;
  const currentTacticBaseScore = extractOverrideMap<ScoredTactic>(overrides?.tactic_base_score);
  const currentWeightRuleGains = extractOverrideMap<MoveTag>(overrides?.weight_rule_gains);

  const prompt = buildReweightPrompt({
    bossId: attempt.boss_id,
    decisions,
    currentWeightRuleGains,
    currentTacticBaseScore,
  });
  // Nothing to reweight from — an attempt with no logged decisions.
  if (!prompt) return { updated: false };

  let text: string;
  try {
    text = await callProvider(prompt);
  } catch (err) {
    console.error('[reweight] provider call failed:', err);
    return { updated: false };
  }

  const validated = validateAndClampWeights(text);
  const tacticBaseScore = { ...currentTacticBaseScore, ...validated.tacticBaseScoreAdjustments };
  const weightRuleGains = { ...currentWeightRuleGains, ...validated.weightRuleAdjustments };

  // Nothing survived validation — every proposed name or value was rejected.
  // Skip the write entirely rather than persisting a no-op identical to what
  // is already stored.
  if (
    Object.keys(validated.tacticBaseScoreAdjustments).length === 0 &&
    Object.keys(validated.weightRuleAdjustments).length === 0
  ) {
    return { updated: false };
  }

  const { error } = await supabase.rpc('upsert_boss_weight_overrides', {
    p_boss_id: attempt.boss_id,
    p_tactic_base_score: tacticBaseScore,
    p_weight_rule_gains: weightRuleGains,
  });
  if (error) {
    console.error('[reweight] failed to persist weight overrides:', error);
    return { updated: false };
  }

  return { updated: true };
}
