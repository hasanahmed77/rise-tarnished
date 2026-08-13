// The orchestration behind POST /api/recap (#13, ADR-0004), split out of
// route.ts so it can be contract-tested without a live Next.js request scope
// or a real network call: `supabase` and `callProvider` are both injected,
// same "push the impure boundary to the edge and test the orchestration
// directly" pattern the boss AI modules use for RNG.
//
// This function is the only place that decides "does the player see a recap
// or not" — every failure path (bad shape, provider error, ungrounded
// response) converges on `{ recap: null }` rather than throwing, because a
// missing recap is a normal, silent outcome (ADR-0004: non-blocking by
// construction) and a wrong one is not an option at all.

import { buildRecapPrompt, isGrounded, type RecapPrompt } from '@/game/attempt/recap';
import type { DecisionEvent } from '@/game/boss/decisionLog';
import type { FightResult } from '@/game/attempt/reward';

export const RECAP_MODEL = 'gpt-4o-mini';

/** Bounded fetch — a hung provider must not hang the route indefinitely. The
 * route itself is already non-blocking from the player's point of view (the
 * resolution screen never waits on this), but the request still needs to
 * resolve so it doesn't sit as a leaked connection. */
const PROVIDER_TIMEOUT_MS = 8000;

interface AttemptLogsRow {
  boss_id: string;
  result: string;
  duration_ticks: number;
  log: unknown;
}

/** The exact shape this handler calls on a Supabase client — structural, not
 * `SupabaseClient`, so a test double only has to implement what's used.
 * `PromiseLike`, not `Promise`: the real client's query builder is thenable
 * (it only resolves once awaited/`.then()`-ed) but isn't a full Promise —
 * matching that exactly is what lets the real `SupabaseClient` satisfy this
 * interface structurally, with no cast at the call site in route.ts. */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        single(): PromiseLike<{ data: AttemptLogsRow | null; error: unknown }>;
      };
    };
  };
}

export type ProviderCall = (prompt: RecapPrompt) => Promise<string>;

/**
 * Call the model. Not used directly by tests (see ProviderCall) — this is the
 * real implementation route.ts wires up. Bare `fetch`, no SDK (ADR-0004): the
 * request/response shape is small enough that hand-rolling it keeps the only
 * network dependency in this codebase trivially mockable.
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
        model: RECAP_MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 120,
        temperature: 0.4,
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

/** Loosely validate what came back out of the jsonb `log` column into
 * something recap.ts's types promise. Defensive even though #55's migration
 * already sanitizes on write: this reads it back as `unknown`, and trusting a
 * jsonb column's shape without a check is how a future schema change becomes
 * a runtime crash here instead of a compile error. */
function extractDecisions(log: unknown): DecisionEvent[] {
  const decisions = (log as { decisions?: unknown } | null)?.decisions;
  return Array.isArray(decisions) ? (decisions as DecisionEvent[]) : [];
}

export interface RecapRequestInput {
  attemptId: string;
  supabase: SupabaseLike;
  /** Defaults to the real provider; tests inject a fixture. */
  callProvider?: ProviderCall;
}

export async function handleRecapRequest({
  attemptId,
  supabase,
  callProvider = callOpenAI,
}: RecapRequestInput): Promise<{ recap: string | null }> {
  // RLS scopes this to the caller's own row (see the "select own attempt
  // logs" policy) — a mismatched or missing id just returns no data, never
  // another user's attempt.
  const { data } = await supabase
    .from('attempt_logs')
    .select('boss_id, result, duration_ticks, log')
    .eq('id', attemptId)
    .single();

  if (!data) return { recap: null };

  const decisions = extractDecisions(data.log);
  const prompt = buildRecapPrompt({
    bossId: data.boss_id,
    result: data.result as FightResult,
    durationTicks: data.duration_ticks,
    decisions,
  });
  // Nothing to ground a recap in — victory, or a death #55 never recorded a
  // decision for. Silence, not a call the model has no data to answer.
  if (!prompt) return { recap: null };

  let text: string;
  try {
    text = await callProvider(prompt);
  } catch (err) {
    console.error('[recap] provider call failed:', err);
    return { recap: null };
  }

  if (!isGrounded(text, decisions)) {
    console.error('[recap] rejected an ungrounded response for attempt', attemptId);
    return { recap: null };
  }

  return { recap: text };
}
