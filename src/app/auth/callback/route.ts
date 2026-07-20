import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Supabase redirects here with a `code` after Google OAuth completes; we
 * exchange it for a session (sets the auth cookies) and send the player
 * into the game. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // Behind a proxy (Vercel preview/prod, a load balancer), request.url can
  // carry the internal host — prefer the public host from x-forwarded-host so
  // the post-login redirect lands on the domain the user actually came from.
  // Locally there's no proxy, so origin is already correct. (Supabase's own
  // App Router example uses exactly this.)
  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const base = !isLocal && forwardedHost ? `https://${forwardedHost}` : origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}/play`);
    }
  }

  return NextResponse.redirect(`${base}/?error=auth`);
}
