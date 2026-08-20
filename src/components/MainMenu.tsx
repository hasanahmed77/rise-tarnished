'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { themeButtonColor } from './AuthButton';

interface PlayerStatsRow {
  vitality: number;
  dexterity: number;
  intelligence: number;
  runes: number;
}

/**
 * The landing screen for a play session: shows the player's real, persisted
 * stats and waits for an explicit "Play" click before anything else mounts.
 * Previously PlayShell went straight to CharacterSheet, which itself
 * auto-skips to the fight when there's nothing affordable to spend on — so a
 * returning player with capped-out or unaffordable stats could land straight
 * in combat with no menu at all. This screen is the fix: it always renders
 * first, and nothing after it (CharacterSheet's own skip included) runs
 * until the player chooses to.
 *
 * Also reused, verbatim, as the in-fight pause screen (#66) — GameCanvas
 * renders this same component with `mode="paused"` rather than a separate,
 * differently-styled overlay: "pause" and "start" are the same underlying
 * question ("here are your stats; say when to fight"), just with the fight
 * already in progress. `mode` only ever changes the copy and the action
 * button's label; the stats fetch/display below is identical either way.
 *
 * Read-only (ADR-0003) — spending stays CharacterSheet's job via the RPC;
 * this only ever selects.
 */
export function MainMenu({
  mode = 'start',
  onAction,
}: {
  mode?: 'start' | 'paused';
  onAction: () => void;
}) {
  const [stats, setStats] = useState<PlayerStatsRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('player_stats')
        .select('vitality, dexterity, intelligence, runes')
        .eq('user_id', user.id)
        .single();

      if (cancelled) return;
      if (error || !isPlayerStatsRow(data)) {
        setLoadError(extractErrorMessage(error) ?? 'Could not load your stats.');
        return;
      }
      setStats({ ...data, runes: Number(data.runes) });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-neutral-950 px-4 text-center">
      <div>
        <h1 className="font-serif text-4xl text-[#d4c9a8]">Rise, Tarnished</h1>
        <p
          className={`mt-1 font-mono text-xs ${mode === 'paused' ? 'tracking-widest text-[#d4c9a8] uppercase' : 'text-neutral-500'}`}
        >
          {mode === 'paused' ? 'Paused' : 'Margit, the Fell Omen awaits.'}
        </p>
      </div>

      {loadError && (
        <p className="text-sm text-red-400">Couldn&apos;t load your stats ({loadError}).</p>
      )}
      {/* Always rendered, never gated on `stats` — each row shows a spinner
       * in place of its number until the fetch resolves, rather than
       * hiding the whole table and replacing it with a loading line. A
       * failed fetch (loadError set) stops spinning and shows "—" instead:
       * an indefinite spinner would misreport a real failure as still
       * in-flight. */}
      <div className="flex w-full max-w-xs flex-col gap-2 rounded border border-[#3a352c] px-5 py-4">
        <StatRow label="Vitality" value={stats?.vitality} loading={!stats && !loadError} />
        <StatRow label="Dexterity" value={stats?.dexterity} loading={!stats && !loadError} />
        <StatRow label="Intelligence" value={stats?.intelligence} loading={!stats && !loadError} />
        <div className="mt-2 border-t border-[#3a352c] pt-2">
          <StatRow label="Runes" value={stats?.runes} loading={!stats && !loadError} />
        </div>
      </div>

      {/* Never blocked on the stats load — a failed/slow fetch here is a
       * display problem, not a reason to keep the player off the game. */}
      <button
        type="button"
        onClick={onAction}
        className={`rounded border px-8 py-2.5 font-mono text-sm ${themeButtonColor}`}
      >
        {mode === 'paused' ? 'Resume' : 'Play'}
      </button>
    </div>
  );
}

function StatRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between font-mono text-sm">
      <span className="text-neutral-400">{label}</span>
      {loading ? (
        <span
          role="status"
          aria-label={`loading ${label}`}
          className="h-3 w-3 animate-spin rounded-full border-2 border-[#6b5f52] border-t-transparent"
        />
      ) : (
        <span className="text-[#d4c9a8]">{value ?? '—'}</span>
      )}
    </div>
  );
}

function isPlayerStatsRow(value: unknown): value is PlayerStatsRow {
  const v = value as Record<string, unknown> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.vitality === 'number' &&
    typeof v.dexterity === 'number' &&
    typeof v.intelligence === 'number' &&
    (typeof v.runes === 'number' || typeof v.runes === 'string')
  );
}

/** Same shape as CharacterSheet's/GameCanvas's own extractErrorMessage —
 * duplicated rather than shared for the same reason those two don't share
 * one: three lines, and each call site's fallback string differs. */
function extractErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return null;
}
