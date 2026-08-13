import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { handleRecapRequest, type SupabaseLike } from './handler';

/**
 * POST /api/recap — the post-death breakdown (#13, PRD G4, ADR-0004).
 *
 * Body: `{ attemptId: string }`. The client never sends the decision log
 * itself — only the id. This route re-fetches the attempt server-side, under
 * the caller's own session, so the data fed to the model is exactly what
 * `resolve_attempt` persisted (already sanitized by #55's migration), never a
 * client-supplied payload. `handleRecapRequest` (handler.ts) does the actual
 * work and is what's under test; this file is the Next.js/auth boundary
 * around it.
 *
 * Every failure mode — bad request, unauthenticated, not found, provider
 * error, ungrounded response — degrades to `{ recap: null }` with a 200 (or
 * the specific status below), never an error the resolution screen has to
 * handle specially. The recap is enrichment; its absence is a normal outcome.
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
    return NextResponse.json({ recap: null }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ recap: null }, { status: 401 });
  }

  // The real client structurally satisfies SupabaseLike (it has a chained
  // .from().select().eq().single() thenable), but its generic type is deep
  // enough that TS's structural check on the way in blows its instantiation
  // budget rather than any actual mismatch — narrow explicitly instead of
  // asking the compiler to prove what's true at runtime.
  const result = await handleRecapRequest({
    attemptId,
    supabase: supabase as unknown as SupabaseLike,
  });
  return NextResponse.json(result);
}
