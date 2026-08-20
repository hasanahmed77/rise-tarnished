import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { handleReweightRequest, type SupabaseLike } from './handler';

/**
 * POST /api/reweight — between-attempt LLM reweighting (#64, ADR-0002's
 * promised sibling to #13's recap: "OpenAI adjusts starting weights for the
 * next attempt; it never participates in the frame loop").
 *
 * Body: `{ attemptId: string }`, fired right after `resolve_attempt`
 * succeeds — same trigger as #13's recap. The client never sends the
 * decision log or the proposed weights; this route re-fetches the attempt
 * and the player's current overrides server-side, under the caller's own
 * session, and only a validated, clamped subset of the model's proposal
 * (see @/game/attempt/reweight) is ever persisted, via the
 * `upsert_boss_weight_overrides` RPC — never a client-supplied payload.
 *
 * Every failure mode — bad request, unauthenticated, no attempt, empty log,
 * provider error, an all-rejected proposal — degrades to
 * `{ updated: false }`, never an error the resolution screen has to handle
 * specially. Reweighting is enrichment; ADR-0002 already commits to falling
 * back to the existing (or heuristic default) weights when unavailable.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const attemptId =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { attemptId?: unknown }).attemptId === 'string'
      ? (body as { attemptId: string }).attemptId
      : null;

  if (!attemptId) {
    return NextResponse.json({ updated: false }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ updated: false }, { status: 401 });
  }

  // Same instantiation-budget narrowing as recap's route.ts — the real
  // client structurally satisfies SupabaseLike, but asking TS to prove that
  // through its full generic type blows its budget rather than any actual
  // mismatch.
  const result = await handleReweightRequest({
    attemptId,
    supabase: supabase as unknown as SupabaseLike,
  });
  return NextResponse.json(result);
}
