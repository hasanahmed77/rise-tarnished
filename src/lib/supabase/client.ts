import { createBrowserClient } from '@supabase/ssr';

/** Client Component Supabase client (browser). Safe to use anywhere in the
 * client bundle — the publishable key is meant to be public; RLS is what
 * actually protects data (ADR-0003).
 *
 * Env vars are referenced literally inside this function (not hoisted to a
 * shared computed lookup) so Next.js's build-time inliner can replace them
 * in the browser bundle — a dynamic process.env[name] would resolve to
 * undefined at runtime in the client. */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env.local and fill it in.',
    );
  }

  return createBrowserClient(url, publishableKey);
}
