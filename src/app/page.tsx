import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SignInButton } from '@/components/AuthButton';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/play');

  // The OAuth callback bounces failures back here with ?error=auth — surface
  // it so a failed sign-in isn't silent.
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-neutral-950">
      <h1 className="font-serif text-3xl tracking-widest text-[#d4c9a8]">RISE, TARNISHED</h1>
      <p className="max-w-sm text-center font-mono text-sm text-neutral-500">
        A 2D souls-like boss rush with an adaptive AI that never lets you win the same way twice.
      </p>
      {error === 'auth' && (
        <p className="font-mono text-sm text-[#d05a4a]">Sign-in failed. Please try again.</p>
      )}
      <SignInButton />
    </main>
  );
}
