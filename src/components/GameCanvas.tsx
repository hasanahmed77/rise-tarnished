'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { GameBridge } from '@/game/bridge';

// The single place where the Phaser runtime is mounted into the React tree
// (ADR-0001). React owns this component's lifecycle; Phaser owns everything
// inside the container div. Communication is bridge-only.
export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode mounts effects twice in dev (mount → cleanup → mount).
    // `disposed` guards the async gap: if cleanup ran before the dynamic
    // import resolved, we destroy the just-created game instead of leaking it.
    let disposed = false;
    let game: Phaser.Game | null = null;

    const bridge = new GameBridge();
    const offReady = bridge.toShell.on('game:ready', () => setEngineReady(true));

    void (async () => {
      const { createGame } = await import('@/game/createGame');
      if (disposed) return;
      game = createGame(container, bridge);
    })();

    return () => {
      disposed = true;
      offReady();
      game?.destroy(true);
      game = null;
      bridge.dispose();
      setEngineReady(false);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} className="w-full max-w-[960px]" />
      <p className="font-mono text-xs text-neutral-500">
        {engineReady ? 'engine: ready (bridge ok)' : 'engine: booting…'}
      </p>
    </div>
  );
}
