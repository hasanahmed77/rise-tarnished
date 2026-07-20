import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase auth session cookie on every request. Server
// Components can only READ cookies, not set them — without this, an expired
// access token would never get refreshed and the user would be silently
// signed out on the next Server Component render.
//
// IMPORTANT: this only REFRESHES the session — it does NOT gate routes.
// Route protection is enforced per-page (getUser() + redirect() in each
// protected Server Component, e.g. src/app/play/page.tsx). A new protected
// route must add its own guard; the proxy will not block anonymous users.
//
// Named `proxy` per Next.js 16's convention (renamed from `middleware`; same
// file location/shape, function export renamed).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return response; // env not configured — no-op, not a crash

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
