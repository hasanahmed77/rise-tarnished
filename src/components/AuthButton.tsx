'use client';

import { createClient } from '@/lib/supabase/client';

/** The game's one button palette. Every actionable button in the app — sign
 * in/out, the settings gear, Pause, "Fight again", MainMenu's Play/Resume,
 * CharacterSheet's "Begin the fight" — shares this exact border/text/hover
 * color rather than each picking its own shade of gray or amber, so the
 * whole app reads as one theme. The only colors that deliberately diverge
 * from this are non-button state indicators: victory/death headline text,
 * the "region cleared" callout, and CharacterSheet's armed-for-confirmation
 * highlight — those carry real, distinct meaning, not just decoration.
 *
 * Split from sizing/padding (unlike a single bundled class) because not
 * every button using this palette is the same shape — the settings gear is
 * a fixed 9x9 square, everything else is a padded rectangle. */
export const themeButtonColor =
  'border-[#6b5f52] bg-transparent text-[#d4c9a8] transition hover:bg-[#2a2a2a]';
export const buttonClass = `rounded border px-4 py-2 font-mono text-sm ${themeButtonColor}`;

export function SignInButton() {
  const handleSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <button onClick={handleSignIn} className={buttonClass}>
      Sign in with Google
    </button>
  );
}

export function SignOutButton() {
  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  return (
    <button onClick={handleSignOut} className={buttonClass}>
      Sign out
    </button>
  );
}
