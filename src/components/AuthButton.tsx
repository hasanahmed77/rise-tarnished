'use client';

import { createClient } from '@/lib/supabase/client';

const buttonClass =
  'rounded border border-[#6b5f52] bg-transparent px-4 py-2 font-mono text-sm text-[#d4c9a8] transition hover:bg-[#2a2a2a]';

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
