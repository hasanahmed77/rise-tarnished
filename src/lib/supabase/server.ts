import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/** Server Component / Route Handler Supabase client. Reads the session from
 * request cookies; writes are best-effort (see the catch below) because
 * Server Components can't set cookies on the response themselves — the
 * middleware refreshes the session on every request, so a missed write here
 * self-heals on the next navigation. */
export async function createClient() {
  // cookies() MUST be called before anything that could throw: it's what
  // signals Next.js to bail a route out of static prerendering into dynamic
  // rendering. Checking env vars first meant a build with no Supabase config
  // (e.g. CI, which never has real secrets — SDLC §8) threw mid-prerender
  // and failed the whole build, instead of the page just rendering dynamically.
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env.local and fill it in.',
    );
  }

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — no response to attach
          // cookies to. Safe to ignore; middleware.ts covers the refresh.
        }
      },
    },
  });
}
