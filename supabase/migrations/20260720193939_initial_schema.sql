-- Initial schema (#5, ADR-0003): player stats, builds, region progress, and
-- attempt logs. Every table is user-scoped and RLS-protected — a user can
-- only ever read/write their own rows (proven by a real cross-user test
-- against this migration applied to a local Postgres, not assumed).
--
-- SECURITY POSTURE (see the RLS + grants notes below): authoritative game
-- state (stats, runes, region progress) is NOT client-writable. RLS alone
-- guards *which row* you touch, not *what value* you write — so a policy of
-- `using (auth.uid() = user_id)` on UPDATE would still let a signed-in player
-- PATCH their own runes to a billion via the raw REST API, bypassing all game
-- logic. Instead those tables are read-only to the client; mutations land
-- through SECURITY DEFINER RPCs (the rune-reward / stat-spend write path in
-- #11/#12) that validate the transition server-side. Only player-owned,
-- non-authoritative rows (builds, append-only attempt logs) are client-writable.

-- moddatetime backs the updated_at triggers below (Supabase ships it).
create extension if not exists moddatetime schema extensions;

-- Base table privileges for THIS schema, present and future. RLS (enabled
-- per-table below) is the row-level gate; these grants are the table-level
-- ACL Postgres checks *before* RLS even runs. Declaring them as DEFAULT
-- PRIVILEGES means every table a later migration adds inherits them
-- automatically — no per-table GRANT to forget (the omission that broke CI
-- twice while this very file was being written). authenticated gets SELECT
-- only by default: a new table is readable-but-RLS-gated, never silently
-- write-open (fail closed). Write grants are added explicitly, per table,
-- only where a policy actually allows the write. service_role bypasses RLS
-- and is server-side/trusted, so it gets everything.
--
-- NB: this makes SELECT-to-authenticated automatic, so a NON-user-facing
-- table added later MUST keep RLS enabled (our invariant: RLS on every table)
-- or revoke this grant — otherwise it is readable by any signed-in user.
alter default privileges in schema public grant select on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;

-- Four fixed regions/bosses, in the proposal's locked order (no boss select).
create type public.region_id as enum (
  'stormveil',
  'redmane',
  'haligtree',
  'elden_throne'
);

-- ---------------------------------------------------------------------------
-- player_stats — one row per user. Defaults (10/10/10) match the sandbox's
-- starting build (src/game/scenes/CombatScene.ts) so a fresh account plays
-- identically to the current dev sandbox. READ-ONLY to the client (see the
-- security posture note at the top): runes/stats change only via the
-- server-validated write path, never a direct client UPDATE.
-- vitality is the sole survivability stat (max HP derives from it); there is
-- deliberately no separate "health" stat — HP is derived, not stored.
-- ---------------------------------------------------------------------------
create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vitality integer not null default 10 check (vitality >= 0),
  dexterity integer not null default 10 check (dexterity >= 0),
  intelligence integer not null default 10 check (intelligence >= 0),
  runes bigint not null default 0 check (runes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

create policy "select own stats" on public.player_stats
  for select using (auth.uid () = user_id);

-- No insert/update/delete policy or grant for authenticated: rows are
-- provisioned by handle_new_user() (SECURITY DEFINER, bypasses RLS) and
-- mutated only by the server-side write path. SELECT is granted by the
-- default privileges above.

create trigger player_stats_updated_at before update on public.player_stats
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- player_progress — one row per user. Fixed linear region order; no boss
-- select, so "furthest unlocked" + a cleared-set is sufficient (no join table
-- needed for exactly four fixed regions). Also READ-ONLY to the client —
-- clearing a region is a server-validated event, not a client write.
-- ---------------------------------------------------------------------------
create table public.player_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_region public.region_id not null default 'stormveil',
  regions_cleared public.region_id[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;

create policy "select own progress" on public.player_progress
  for select using (auth.uid () = user_id);

create trigger player_progress_updated_at before update on public.player_progress
  for each row
  execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- player_builds — equipment loadout. Minimal columns: no weapon catalog
-- exists in the game yet (PRD §6 "Later"); this just gives #12/weapon-variety
-- somewhere to land without re-deriving a schema then. Multi-row (a user may
-- save >1 build later), client-writable, but with at most ONE active build
-- per user enforced below. Unlike stats/progress this is cosmetic loadout
-- state, not authoritative progression, so the client owns it directly.
-- ---------------------------------------------------------------------------
create table public.player_builds (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  weapon_id text not null default 'starting_sword',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- At most one active build per user. Without this, two concurrent inserts (or
-- a retry) both defaulting is_active=true leave the loadout ambiguous, and any
-- `where is_active` lookup expecting a single row breaks.
create unique index player_builds_one_active_per_user
  on public.player_builds (user_id)
  where is_active;

alter table public.player_builds enable row level security;

create policy "select own builds" on public.player_builds
  for select using (auth.uid () = user_id);

create policy "insert own builds" on public.player_builds
  for insert
  with check (auth.uid () = user_id);

create policy "update own builds" on public.player_builds
  for update using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

create policy "delete own builds" on public.player_builds
  for delete using (auth.uid () = user_id);

grant insert, update, delete on public.player_builds to authenticated;

-- ---------------------------------------------------------------------------
-- attempt_logs — one row per fight attempt. Append-only (no update/delete
-- policy): the log is an immutable record, feeding #13's post-death recap
-- from the structured decision events BOSS_AI.md §8 already emits.
--
-- This is UNTRUSTED client-written telemetry: the WITH CHECK ties a row to its
-- author, but the client picks the column values. rune_delta here is a *record*
-- of a fight, never a source of truth for the balance — the authoritative
-- runes total lives in player_stats and only the server write path moves it.
-- The CHECK bounds below are sanity rails (reject absurd values), not a
-- substitute for that server-side validation.
-- ---------------------------------------------------------------------------
create table public.attempt_logs (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  boss_id text not null,
  result text not null check (result in ('victory', 'death')),
  -- 60 ticks/sec; ~3h is already an absurd single-fight ceiling.
  duration_ticks integer not null check (duration_ticks between 0 and 648000),
  rune_delta integer not null default 0 check (rune_delta between -100000000 and 100000000),
  log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.attempt_logs enable row level security;

create policy "select own attempt logs" on public.attempt_logs
  for select using (auth.uid () = user_id);

create policy "insert own attempt logs" on public.attempt_logs
  for insert
  with check (auth.uid () = user_id);

create index attempt_logs_user_id_created_at_idx on public.attempt_logs (user_id, created_at desc);

grant insert on public.attempt_logs to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: these tables are intentionally NOT added to the supabase_realtime
-- publication (which is empty by default — Supabase opts tables in explicitly,
-- it is not FOR ALL TABLES). Nothing subscribes to postgres_changes today. If
-- a future feature wants live updates (e.g. a live rune counter), opt the
-- specific table in with:
--   alter publication supabase_realtime add table public.<table>;
-- Documented here so a silent zero-events subscription later isn't mistaken
-- for a client bug.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Auto-provision the per-user singleton rows on signup (the standard Supabase
-- pattern: a SECURITY DEFINER trigger function, since it must write on behalf
-- of a user before any client-side RLS-scoped request could). Provisions
-- stats, progress, AND a default active build, so every table a fresh account
-- reads has its expected first row — no ".single() on zero rows" surprise for
-- the first feature that queries player_builds.
-- ---------------------------------------------------------------------------
create function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_stats (user_id) values (new.id);
  insert into public.player_progress (user_id) values (new.id);
  insert into public.player_builds (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();
