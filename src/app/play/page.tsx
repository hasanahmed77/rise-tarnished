import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PlayShell } from '@/components/PlayShell';
import { SignOutButton } from '@/components/AuthButton';

export default async function PlayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  return (
    <main className="relative min-h-0 flex-1 bg-neutral-950">
      <div className="absolute top-3 right-3 z-10">
        <SignOutButton />
      </div>
      <PlayShell />
    </main>
  );
}
