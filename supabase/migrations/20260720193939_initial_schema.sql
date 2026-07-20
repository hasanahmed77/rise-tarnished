-- Initial schema (#5, ADR-0003): player stats, builds, region progress, and
-- attempt logs. Every table is user-scoped and RLS-protected — a user can
-- only ever read/write their own rows (proven by a real cross-user test
-- against this migration applied to a local Postgres, not assumed).
--
-- Four fixed regions/bosses, in the proposal's locked order (no boss select).
create type public.region_id as enum (
  'stormveil',
  'redmane',
  'haligtree',
  'elden_throne'
);

-- ---------------------------------------------------------------------------
-- player_stats — one row per user. Defaults (10/10/10/10) match the sandbox's
-- starting build (src/game/scenes/CombatScene.ts) so a fresh account plays
-- identically to the current dev sandbox.
-- ---------------------------------------------------------------------------
create table public.player_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vitality integer not null default 10 check (vitality >= 0),
  health integer not null default 10 check (health >= 0),
  dexterity integer not null default 10 check (dexterity >= 0),
  intelligence integer not null default 10 check (intelligence >= 0),
  runes bigint not null default 0 check (runes >= 0),
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

create policy "select own stats" on public.player_stats
  for select using (auth.uid () = user_id);

create policy "update own stats" on public.player_stats
  for update using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

-- No insert/delete policy: rows are provisioned by handle_new_user() below
-- (SECURITY DEFINER, bypasses RLS) and never deleted directly by the client.

-- ---------------------------------------------------------------------------
-- player_progress — one row per user. Fixed linear region order; no boss
-- select, so "furthest unlocked" + a cleared-set is sufficient (no join table
-- needed for exactly four fixed regions).
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

create policy "update own progress" on public.player_progress
  for update using (auth.uid () = user_id)
  with check (auth.uid () = user_id);

-- ---------------------------------------------------------------------------
-- player_builds — equipment loadout. Minimal columns: no weapon catalog
-- exists in the game yet (PRD §6 "Later"); this just gives #12/weapon-variety
-- somewhere to land without re-deriving a schema then. Multi-row (a user may
-- have >1 saved build later), client-inserted.
-- ---------------------------------------------------------------------------
create table public.player_builds (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  weapon_id text not null default 'starting_sword',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

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

-- ---------------------------------------------------------------------------
-- attempt_logs — one row per fight attempt. Append-only (no update/delete
-- policy): the log is an immutable record, feeding #13's post-death recap
-- from the structured decision events BOSS_AI.md §8 already emits.
-- ---------------------------------------------------------------------------
create table public.attempt_logs (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references auth.users (id) on delete cascade,
  boss_id text not null,
  result text not null check (result in ('victory', 'death')),
  duration_ticks integer not null check (duration_ticks >= 0),
  rune_delta integer not null default 0,
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

-- ---------------------------------------------------------------------------
-- Auto-provision player_stats + player_progress on signup (the standard
-- Supabase pattern: a SECURITY DEFINER trigger function, since it must write
-- on behalf of a user before any client-side RLS-scoped request could).
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
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row
execute function public.handle_new_user ();
