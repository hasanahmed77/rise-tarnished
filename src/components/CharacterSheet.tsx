'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlayerBuild } from '@/game/bridge';
import { createClient } from '@/lib/supabase/client';
import { themeButtonColor } from './AuthButton';

/** Mirrors spend_stat_point's v_cost_base/v_cost_step/v_hard_cap
 * (supabase/migrations/…_spend_stat_point.sql) — display only, never
 * trusted. The RPC computes and enforces the real cost and cap itself; a
 * mismatch here is a cosmetic display flash, not a security issue (same
 * convention as MARGIT_RUNE_REWARD mirroring the bosses table). */
const STAT_POINT_COST_BASE = 100;
const STAT_POINT_COST_STEP = 25;
const STAT_HARD_CAP = 60;

/** How long an armed (awaiting-confirmation) button stays armed before
 * disarming itself — a stray click days later shouldn't silently spend. */
const CONFIRM_TIMEOUT_MS = 4000;

type StatKey = 'vitality' | 'dexterity' | 'intelligence';

interface PlayerStatsRow {
  vitality: number;
  dexterity: number;
  intelligence: number;
  runes: number;
}

const STAT_LABELS: Record<StatKey, { label: string; blurb: string }> = {
  vitality: { label: 'Vitality', blurb: 'Max HP, poise, stamina — the survivability axis.' },
  dexterity: { label: 'Dexterity', blurb: 'Melee weapon scaling, extended dodge i-frames.' },
  intelligence: { label: 'Intelligence', blurb: 'Sorcery damage, max Focus Points.' },
};

/** The rune cost of this stat's next point — rises with the stat's own
 * current value, mirroring the RPC's v_cost_base + v_cost_step*(current-10). */
function nextCost(currentValue: number): number {
  return STAT_POINT_COST_BASE + STAT_POINT_COST_STEP * (currentValue - 10);
}

/** Whether there's anything at all worth showing the sheet for — false when
 * every stat is capped, or none are affordable with the runes on hand. */
function hasAnySpendableStat(stats: PlayerStatsRow): boolean {
  return (Object.keys(STAT_LABELS) as StatKey[]).some(
    (stat) => stats[stat] < STAT_HARD_CAP && stats.runes >= nextCost(stats[stat]),
  );
}

function toBuild(stats: PlayerStatsRow): PlayerBuild {
  return { vitality: stats.vitality, dexterity: stats.dexterity, intelligence: stats.intelligence };
}

/** Gate before GameCanvas mounts (#12): shows the player's real persisted
 * stats, lets them spend earned runes on a point of vitality/dexterity/
 * intelligence via the spend_stat_point RPC, then hands the resulting build
 * to the caller to start the fight. player_stats stays read-only to the
 * client throughout (ADR-0003) — every mutation here goes through the RPC.
 *
 * Skips itself straight to onBegin when the player can't afford (or is
 * capped out of) every stat — no point showing a shopping screen with
 * nothing to buy on every single retry. */
export function CharacterSheet({ onBegin }: { onBegin: (build: PlayerBuild) => void }) {
  const [stats, setStats] = useState<PlayerStatsRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [spending, setSpending] = useState<StatKey | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [armedStat, setArmedStat] = useState<StatKey | null>(null);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const row = { ...data, runes: Number(data.runes) };
      if (!hasAnySpendableStat(row)) {
        onBegin(toBuild(row));
        return;
      }
      setStats(row);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount — onBegin is a stable setState from PlayShell, and
    // re-running this on every render would refetch on each keystroke-driven
    // re-render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (disarmTimer.current) clearTimeout(disarmTimer.current);
    };
  }, []);

  function arm(stat: StatKey) {
    setSpendError(null);
    setArmedStat(stat);
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    disarmTimer.current = setTimeout(() => setArmedStat(null), CONFIRM_TIMEOUT_MS);
  }

  async function confirmSpend(stat: StatKey) {
    if (!stats || spending) return;
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
    setArmedStat(null);
    setSpending(stat);
    setSpendError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('spend_stat_point', { p_stat: stat }).single();
    setSpending(null);
    if (error || !isPlayerStatsRow(data)) {
      setSpendError(extractErrorMessage(error) ?? 'Could not spend that point.');
      return;
    }
    setStats({ ...data, runes: Number(data.runes) });
  }

  function handleClick(stat: StatKey) {
    if (armedStat === stat) void confirmSpend(stat);
    else arm(stat);
  }

  if (loadError) {
    return (
      <SheetShell>
        <p className="text-sm text-red-400">Couldn&apos;t load your stats ({loadError}).</p>
      </SheetShell>
    );
  }

  if (!stats) {
    return (
      <SheetShell>
        <p className="font-mono text-sm text-neutral-500">loading your stats…</p>
      </SheetShell>
    );
  }

  return (
    <SheetShell>
      <p className="font-mono text-sm text-neutral-400">{stats.runes} runes</p>
      <div className="flex w-full max-w-md flex-col gap-3">
        {(Object.keys(STAT_LABELS) as StatKey[]).map((stat) => {
          const value = stats[stat];
          const capped = value >= STAT_HARD_CAP;
          const cost = nextCost(value);
          const affordable = !capped && stats.runes >= cost;
          const armed = armedStat === stat;
          return (
            <div
              key={stat}
              className="flex items-center justify-between rounded border border-[#3a352c] px-4 py-3"
            >
              <div>
                <p className="font-serif text-lg text-[#d4c9a8]">
                  {STAT_LABELS[stat].label}{' '}
                  <span className="font-mono text-sm text-neutral-500">
                    {value}
                    {armed && !capped ? ` → ${value + 1}` : ''}
                  </span>
                </p>
                <p className="font-mono text-xs text-neutral-500">
                  {capped ? 'at its maximum' : `${STAT_LABELS[stat].blurb} (${cost} runes)`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleClick(stat)}
                disabled={spending !== null || !affordable}
                className={`rounded border px-3 py-1.5 font-mono text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  armed
                    ? 'border-amber-600 bg-amber-900/30 text-amber-300'
                    : 'border-[#6b5f52] bg-transparent text-[#d4c9a8] hover:bg-[#2a2a2a]'
                }`}
              >
                {spending === stat ? '…' : capped ? 'MAX' : armed ? 'confirm?' : '+1'}
              </button>
            </div>
          );
        })}
      </div>
      {spendError && <p className="text-sm text-red-400">{spendError}</p>}
      <button
        type="button"
        onClick={() => onBegin(toBuild(stats))}
        className={`mt-2 rounded border px-6 py-2 font-mono text-sm ${themeButtonColor}`}
      >
        Begin the fight
      </button>
    </SheetShell>
  );
}

function SheetShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-neutral-950 px-4 text-center">
      <h1 className="font-serif text-2xl text-[#d4c9a8]">Prepare for Margit</h1>
      {children}
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

/** Same shape Supabase's PostgrestError takes (plain object, not an Error
 * instance) as GameCanvas.tsx's extractErrorMessage — duplicated rather than
 * shared because the two call sites' fallback strings differ and the check
 * itself is three lines. */
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
