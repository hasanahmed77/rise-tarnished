'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
 * Read-only (ADR-0003) — spending stays CharacterSheet's job via the RPC;
 * this only ever selects.
 */
export function MainMenu({ onPlay }: { onPlay: () => void }) {
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
        <p className="mt-1 font-mono text-xs text-neutral-500">Margit, the Fell Omen awaits.</p>
      </div>

      {loadError && (
        <p className="text-sm text-red-400">Couldn&apos;t load your stats ({loadError}).</p>
      )}
      {!loadError && !stats && (
        <p className="font-mono text-sm text-neutral-500">loading your stats…</p>
      )}
      {stats && (
        <div className="flex w-full max-w-xs flex-col gap-2 rounded border border-[#3a352c] px-5 py-4">
          <StatRow label="Vitality" value={stats.vitality} />
          <StatRow label="Dexterity" value={stats.dexterity} />
          <StatRow label="Intelligence" value={stats.intelligence} />
          <div className="mt-2 border-t border-[#3a352c] pt-2">
            <StatRow label="Runes" value={stats.runes} />
          </div>
        </div>
      )}

      {/* Play is never blocked on the stats load — a failed/slow fetch here
       * is a display problem, not a reason to keep the player off the game. */}
      <button
        type="button"
        onClick={onPlay}
        className="rounded border border-amber-700 bg-transparent px-8 py-2.5 font-mono text-sm text-amber-300 transition hover:bg-amber-900/30"
      >
        Play
      </button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between font-mono text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className="text-[#d4c9a8]">{value}</span>
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
