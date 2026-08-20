'use client';

import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import {
  GameBridge,
  type FightOutcome,
  type PlayerBuild,
  type WeightOverrides,
} from '@/game/bridge';
import { MARGIT_BOSS_ID } from '@/game/boss/bossTuning';
import { createClient } from '@/lib/supabase/client';
import type { GameSettings } from '@/lib/settings';

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

/** The post-death recap (#13, ADR-0004) — always optional, never blocking.
 * 'idle' covers both "not attempted yet" and every non-death outcome, so the
 * overlay has one state to check rather than a separate "is this a death"
 * branch at every render site. */
type RecapState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ready'; text: string }
  | { status: 'unavailable' };

// The single place where the Phaser runtime is mounted into the React tree
// (ADR-0001). React owns this component's lifecycle; Phaser owns everything
// inside the container div. Communication is bridge-only.
//
// `build` is the player's real, persisted stat build (#12) — the caller
// (the character sheet screen, PlayPage) reads it from player_stats before
// mounting this component, so it's ready the instant the engine asks for it
// via 'fight:start'. One GameCanvas mount is one fight; a fresh build for
// the next attempt means remounting (see PlayPage's "fight again" reload).
export function GameCanvas({ build, settings }: { build: PlayerBuild; settings: GameSettings }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [resolution, setResolution] = useState<ResolutionState | null>(null);
  const [recap, setRecap] = useState<RecapState>({ status: 'idle' });

  // #56 — the bridge and the latest `settings` both need to outlive any
  // single render so the two effects below can reach them: the bridge is
  // created once (empty-deps effect) and read from the settings-push effect;
  // `settings` is read inside the 'game:ready' handler, which is created
  // once and would otherwise close over whatever `settings` was at that
  // first render.
  const bridgeRef = useRef<GameBridge | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // StrictMode mounts effects twice in dev (mount → cleanup → mount).
    // `disposed` guards the async gap: if cleanup ran before the dynamic
    // import resolved, we destroy the just-created game instead of leaking it.
    let disposed = false;
    let game: Phaser.Game | null = null;

    const bridge = new GameBridge();
    bridgeRef.current = bridge;
    const offReady = bridge.toShell.on('game:ready', () => {
      setEngineReady(true);
      // #64 — best-effort fetch of this player's persisted weight overrides
      // for this boss before the fight starts. Never blocks/holds up
      // 'fight:start' waiting on this any longer than one network round
      // trip already in flight when the engine finished booting, and any
      // failure (no row yet, network error) resolves to undefined — falls
      // back to the boss's hardcoded defaults (ADR-0002).
      void fetchWeightOverrides(MARGIT_BOSS_ID).then((weightOverrides) => {
        if (disposed) return;
        // The engine is idle until this carries the real build (CombatScene's
        // startFight()) — never the hardcoded sandbox build it used before #12.
        bridge.toGame.emit('fight:start', { bossId: MARGIT_BOSS_ID, build, weightOverrides });
        // CombatScene also self-initializes from localStorage at creation
        // (see its comment) — this covers the case where SettingsPanel already
        // pushed an update before the game finished booting, which the
        // settings-push effect below would have sent to no listener.
        bridge.toGame.emit('settings:update', settingsRef.current);
      });
    });
    const offOutcome = bridge.toShell.on('fight:outcome', (outcome) => {
      setResolution({ status: 'resolving', outcome });
      setRecap({ status: 'idle' });
      void resolveAttempt(outcome).then(
        (resolved) => {
          if (disposed) return;
          setResolution({ status: 'resolved', outcome, resolved });

          // Only after resolve_attempt has actually persisted the attempt —
          // the recap route reads attempt_logs server-side, so the row must
          // exist first — and only on death (PRD G4 is a post-death
          // breakdown; a win has nothing to explain). Fire-and-forget: the
          // overlay below is already fully usable without this.
          if (outcome.result === 'death') {
            setRecap({ status: 'pending' });
            void fetchRecap(outcome.attemptId).then((text) => {
              if (disposed) return;
              setRecap(text ? { status: 'ready', text } : { status: 'unavailable' });
            });
          }

          // #64 — between-attempt reweighting (ADR-0002). Every attempt, win
          // or loss: the boss should retune on what it saw regardless of
          // outcome. Fire-and-forget, same as the recap call above — this
          // fight's overlay is already fully usable without it, and the
          // result only ever affects the *next* fight the player starts.
          void triggerReweight(outcome.attemptId);
        },
        (err: unknown) => {
          if (disposed) return;
          setResolution({
            status: 'error',
            outcome,
            message: extractErrorMessage(err),
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
      bridgeRef.current = null;
      setEngineReady(false);
    };
    // `build` isn't expected to change for this component's lifetime (see
    // the class comment) but is a real effect dependency: if it ever did,
    // remounting the whole game to start a fresh fight on it is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #56 — live settings updates to an already-running fight. Deliberately
  // separate from the mount effect above (which never re-runs): toggling a
  // setting must not tear down and recreate the whole Phaser game, it just
  // needs one message sent to the scene that's already running.
  useEffect(() => {
    settingsRef.current = settings;
    bridgeRef.current?.toGame.emit('settings:update', settings);
  }, [settings]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-xs text-neutral-500">
        {engineReady ? 'engine: ready (bridge ok)' : 'engine: booting…'}
      </p>
      {resolution && <ResolutionOverlay state={resolution} recap={recap} />}
    </div>
  );
}

/** Supabase's PostgrestError (thrown on `.rpc()` failure) is a plain object
 * with a `message` field, not an `Error` instance — `err instanceof Error`
 * misses it and falls back to a useless generic string. Handle both shapes. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return 'Failed to save this attempt.';
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
      // Telemetry for #13's recap (BOSS_AI.md §8). Like the rune estimate,
      // it is never trusted to compute anything — the RPC stores it verbatim
      // and derives no reward from it.
      p_log: { decisions: outcome.decisionLog },
    })
    .single();

  if (error) throw error;
  // No generated Supabase Database types exist yet in this project, so `data`
  // is `unknown` here — narrow it explicitly (a runtime check on real network
  // data is warranted regardless) rather than casting blindly.
  if (!isResolveAttemptRow(data)) {
    console.error('resolve_attempt returned an unexpected shape:', data);
    throw new Error('resolve_attempt returned an unexpected shape');
  }
  return {
    runeDelta: data.rune_delta,
    totalRunes: Number(data.total_runes),
    regionUnlocked: data.region_unlocked,
  };
}

// total_runes is a Postgres bigint (player_stats.runes) — PostgREST/pgbouncer
// configuration determines whether it's serialized as a JSON number or a
// string (the safer convention, to avoid JS Number precision loss above
// 2^53), and that can differ between the local CLI stack and a live hosted
// project. Accept either; resolveAttempt() coerces it to a number for display.
/** Calls POST /api/recap (#13, ADR-0004). Returns null on ANY failure — bad
 * status, network error, malformed body — never throws. The recap is
 * enrichment; silence is the correct response to every failure mode here,
 * not a retry or a surfaced error (the route itself already collapses
 * "provider down" / "response wasn't grounded" / "nothing to explain" into
 * the same `{ recap: null }` shape, so this just has to trust that). */
async function fetchRecap(attemptId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const text = (data as { recap?: unknown } | null)?.recap;
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** Reads this player's persisted weight overrides for a boss directly via
 * the Supabase client (ADR-0003: client-read-only, RLS-scoped to the
 * caller's own row) — a read needs no server route, unlike the write (see
 * handleReweightRequest, which goes through the RPC). Returns undefined on
 * ANY failure — no row yet, network error, malformed columns — so the
 * caller falls back to the boss's hardcoded defaults rather than blocking
 * fight start on this. */
async function fetchWeightOverrides(bossId: string): Promise<WeightOverrides | undefined> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from('boss_weight_overrides')
      .select('tactic_base_score, weight_rule_gains')
      .eq('boss_id', bossId)
      .maybeSingle();
    if (!data) return undefined;
    const row = data as { tactic_base_score: unknown; weight_rule_gains: unknown };
    if (typeof row.tactic_base_score !== 'object' || row.tactic_base_score === null) {
      return undefined;
    }
    if (typeof row.weight_rule_gains !== 'object' || row.weight_rule_gains === null) {
      return undefined;
    }
    return {
      tacticBaseScore: row.tactic_base_score as WeightOverrides['tacticBaseScore'],
      weightRuleGains: row.weight_rule_gains as WeightOverrides['weightRuleGains'],
    };
  } catch {
    return undefined;
  }
}

/** Calls POST /api/reweight (#64, ADR-0002). Fire-and-forget — never throws,
 * result unused by the caller. The route itself already collapses every
 * failure mode (no attempt row, empty log, provider error, an all-rejected
 * proposal) into `{ updated: false }`, so there is nothing meaningful to do
 * with the response here; the only observable effect is on the *next*
 * fight's `fetchWeightOverrides` call. */
async function triggerReweight(attemptId: string): Promise<void> {
  try {
    await fetch('/api/reweight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId }),
    });
  } catch {
    // Non-blocking by design (ADR-0002) — nothing to surface to the player.
  }
}

function isResolveAttemptRow(
  value: unknown,
): value is { rune_delta: number; total_runes: number | string; region_unlocked: boolean } {
  const v = value as Record<string, unknown> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.rune_delta === 'number' &&
    (typeof v.total_runes === 'number' || typeof v.total_runes === 'string') &&
    typeof v.region_unlocked === 'boolean'
  );
}

function ResolutionOverlay({ state, recap }: { state: ResolutionState; recap: RecapState }) {
  const victory = state.outcome.result === 'victory';
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 font-mono text-neutral-100">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
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
            {/* Only ever rendered for a death (recap stays 'idle' on a win —
             * see the fetch trigger in GameCanvas). Nothing shows for
             * 'pending'/'unavailable': a placeholder or an error line here
             * would be the "spinner that outlives the player's patience"
             * ADR-0004's non-blocking requirement rules out. */}
            {recap.status === 'ready' && (
              <p className="text-sm italic text-neutral-300">&ldquo;{recap.text}&rdquo;</p>
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
