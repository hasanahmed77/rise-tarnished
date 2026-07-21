'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import { GameBridge, type FightOutcome } from '@/game/bridge';
import { createClient } from '@/lib/supabase/client';

/** Server-persisted result of resolve_attempt (#11) — distinct from the
 * bridge's FightOutcome, whose estimatedRuneDelta is only an optimistic
 * client-side guess. This is the authoritative number. */
interface ResolvedAttempt {
  runeDelta: number;
  totalRunes: number;
  regionUnlocked: boolean;
}

type ResolutionState =
  | { status: 'resolving'; outcome: FightOutcome }
  | { status: 'resolved'; outcome: FightOutcome; resolved: ResolvedAttempt }
  | { status: 'error'; outcome: FightOutcome; message: string };

// The single place where the Phaser runtime is mounted into the React tree
// (ADR-0001). React owns this component's lifecycle; Phaser owns everything
// inside the container div. Communication is bridge-only.
export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [resolution, setResolution] = useState<ResolutionState | null>(null);

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
    const offOutcome = bridge.toShell.on('fight:outcome', (outcome) => {
      setResolution({ status: 'resolving', outcome });
      void resolveAttempt(outcome).then(
        (resolved) => {
          if (disposed) return;
          setResolution({ status: 'resolved', outcome, resolved });
        },
        (err: unknown) => {
          if (disposed) return;
          setResolution({
            status: 'error',
            outcome,
            message: err instanceof Error ? err.message : 'Failed to save this attempt.',
          });
        },
      );
    });

    void (async () => {
      const { createGame } = await import('@/game/createGame');
      if (disposed) return;
      game = createGame(container, bridge);
    })();

    return () => {
      disposed = true;
      offReady();
      offOutcome();
      game?.destroy(true);
      game = null;
      bridge.dispose();
      setEngineReady(false);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-xs text-neutral-500">
        {engineReady ? 'engine: ready (bridge ok)' : 'engine: booting…'}
      </p>
      {resolution && <ResolutionOverlay state={resolution} />}
    </div>
  );
}

/** Calls the resolve_attempt RPC (#11) — the only path from a finished fight
 * to persisted runes/progress (ADR-0003: authoritative state is
 * client-read-only). The RPC computes the reward itself from server-side
 * data; nothing here supplies or can supply a trusted amount. */
async function resolveAttempt(outcome: FightOutcome): Promise<ResolvedAttempt> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc('resolve_attempt', {
      p_attempt_id: outcome.attemptId,
      p_boss_id: outcome.bossId,
      p_result: outcome.result,
      p_duration_ticks: outcome.durationTicks,
    })
    .single();

  if (error) throw error;
  // No generated Supabase Database types exist yet in this project, so `data`
  // is `unknown` here — narrow it explicitly (a runtime check on real network
  // data is warranted regardless) rather than casting blindly.
  if (!isResolveAttemptRow(data)) {
    throw new Error('resolve_attempt returned an unexpected shape');
  }
  return {
    runeDelta: data.rune_delta,
    totalRunes: data.total_runes,
    regionUnlocked: data.region_unlocked,
  };
}

function isResolveAttemptRow(
  value: unknown,
): value is { rune_delta: number; total_runes: number; region_unlocked: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).rune_delta === 'number' &&
    typeof (value as Record<string, unknown>).total_runes === 'number' &&
    typeof (value as Record<string, unknown>).region_unlocked === 'boolean'
  );
}

function ResolutionOverlay({ state }: { state: ResolutionState }) {
  const victory = state.outcome.result === 'victory';
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 font-mono text-neutral-100">
      <div className="flex flex-col items-center gap-3 text-center">
        <h2 className={`text-3xl ${victory ? 'text-amber-300' : 'text-red-400'}`}>
          {victory ? 'MARGIT, THE FELL OMEN — FALLEN' : 'YOU DIED'}
        </h2>
        {state.status === 'resolving' && (
          <p className="text-sm text-neutral-400">
            {state.outcome.estimatedRuneDelta > 0 ? `~+${state.outcome.estimatedRuneDelta}` : 0}{' '}
            runes — saving attempt…
          </p>
        )}
        {state.status === 'resolved' && (
          <>
            <p className="text-lg">
              {state.resolved.runeDelta > 0
                ? `+${state.resolved.runeDelta}`
                : state.resolved.runeDelta}{' '}
              runes
              <span className="ml-2 text-neutral-500">({state.resolved.totalRunes} total)</span>
            </p>
            {state.resolved.regionUnlocked && (
              <p className="text-sm text-amber-300">Region cleared — the next path is open.</p>
            )}
          </>
        )}
        {state.status === 'error' && (
          <p className="text-sm text-red-400">
            Couldn&apos;t save this attempt ({state.message}). Your local result still stands, but
            progress may not be saved.
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded border border-neutral-600 px-4 py-1.5 text-sm hover:bg-neutral-800"
        >
          Fight again
        </button>
      </div>
    </div>
  );
}
