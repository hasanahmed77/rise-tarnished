import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Supabase redirects here with a `code` after Google OAuth completes; we
 * exchange it for a session (sets the auth cookies) and send the player
 * into the game. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/play`);
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth`);
}
