import { GameCanvas } from '@/components/GameCanvas';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6">
      <GameCanvas />
    </main>
  );
}
