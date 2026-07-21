-- Win/lose resolution + rune reward (#11). The client can never write runes,
-- region progress, or attempt outcomes directly — ADR-0003's read-only-
-- authoritative-state rule (Sprint 4/5's review). This migration adds the
-- one door through which a fight's result becomes persisted state: a
-- SECURITY DEFINER RPC that computes the reward itself from server-side data,
-- never from a client-supplied amount (there is no such parameter to trust or
-- distrust — it structurally does not exist).

-- ---------------------------------------------------------------------------
-- bosses — one row per boss, mapping it to the region it belongs to and its
-- rune reward. Data-driven so bosses #2-4 (PRD §6 "Later") only ever need an
-- INSERT here, never a resolve_attempt code change. Read-only reference data:
-- authenticated gets SELECT only (from the default-privileges baseline,
-- ADR-0003); nothing ever writes to it from the client.
-- ---------------------------------------------------------------------------
create table public.bosses (
  id text primary key,
  region_id public.region_id not null unique,
  -- Mirrored client-side as MARGIT_RUNE_REWARD (src/game/boss/bossTuning.ts)
  -- for the optimistic UI estimate shown before this RPC responds — that
  -- client copy is never trusted, only this row is. Keep the two in sync by
  -- hand; a mismatch is a cosmetic display flash, not a security issue.
  rune_reward integer not null check (rune_reward > 0)
);

alter table public.bosses enable row level security;

create policy "bosses are readable by any signed-in user" on public.bosses
  for select using (true);

insert into public.bosses (id, region_id, rune_reward) values ('margit', 'stormveil', 500);

-- attempt_logs was, until now, client-INSERT-able directly (Sprint 4 — it
-- predates this RPC). resolve_attempt is now the only legitimate writer, so
-- close that door: an attacker could otherwise pre-seed a row at a
-- self-chosen id with a forged rune_delta, and the idempotency guard below
-- would trust and echo it back (never touching real currency, but breaking
-- the "first-recorded outcome wins" guarantee for that attempt id).
revoke insert on public.attempt_logs from authenticated;

-- Whether resolving THIS attempt is what unlocked its region — a fact about
-- the attempt, computed once and persisted, so a retried resolve_attempt call
-- (the whole point of the idempotency guard below) can report it accurately
-- instead of re-deriving "is the region cleared *now*", which is always true
-- after the first successful call and would be a different (wrong) answer.
alter table public.attempt_logs add column region_unlocked boolean not null default false;

-- ---------------------------------------------------------------------------
-- resolve_attempt — the only path from a finished fight to persisted state.
-- Idempotent via attempt_logs.id as the dedupe key: the caller (client)
-- generates the attempt id once when the fight ends and this RPC can be
-- retried (page refresh, dropped connection) at no risk — a second call with
-- the same id is a no-op that returns the already-persisted result instead
-- of double-paying, and a call with the same id but *different* result/boss
-- is silently ignored (the first-recorded outcome always wins).
-- ---------------------------------------------------------------------------
create function public.resolve_attempt (
  p_attempt_id uuid,
  p_boss_id text,
  p_result text,
  p_duration_ticks integer
) returns table (rune_delta integer, total_runes bigint, region_unlocked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_region public.region_id;
  v_current_region public.region_id;
  v_regions_cleared public.region_id[];
  v_already_cleared boolean;
  v_next_region public.region_id;
  v_will_unlock boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_result not in ('victory', 'death') then
    raise exception 'invalid result: %', p_result;
  end if;

  select b.region_id, b.rune_reward into v_region, rune_delta
  from public.bosses b
  where b.id = p_boss_id;

  if v_region is null then
    raise exception 'unknown boss_id: %', p_boss_id;
  end if;

  -- Death pays nothing (issue #11 AC: "no rune loss"). The reward comes only
  -- from the bosses row above — p_result/p_boss_id select *which* rule
  -- applies; the client never supplies an amount.
  if p_result = 'death' then
    rune_delta := 0;
  end if;

  select current_region, regions_cleared into v_current_region, v_regions_cleared
  from public.player_progress
  where user_id = v_uid;

  v_already_cleared := v_region = any (v_regions_cleared);

  -- Reachability: only the player's current frontier boss, or one they've
  -- already cleared (re-fights are allowed but never move progress — win or
  -- lose), may be resolved. Without this, resolving a boss ahead of the
  -- frontier skips content, and resolving one *behind* an already-advanced
  -- frontier would regress current_region backward (both unreachable today
  -- with a single boss/region, but real the moment a second one is added —
  -- the bosses table is explicitly designed to add those with no RPC change).
  if not (v_region = v_current_region or v_already_cleared) then
    raise exception 'boss % is not yet reachable', p_boss_id;
  end if;

  v_will_unlock := p_result = 'victory' and not v_already_cleared;
  region_unlocked := v_will_unlock;

  -- Idempotency guard: FOUND is true only if this INSERT actually added a
  -- row. A retried call with the same p_attempt_id conflicts on the primary
  -- key, inserts nothing, and falls into the branch below instead of
  -- re-applying the reward. region_unlocked is persisted here precisely so
  -- that branch can report it accurately instead of guessing.
  insert into public.attempt_logs (
    id, user_id, boss_id, result, duration_ticks, rune_delta, region_unlocked
  )
  values (p_attempt_id, v_uid, p_boss_id, p_result, p_duration_ticks, rune_delta, v_will_unlock)
  on conflict (id) do nothing;

  if not found then
    -- Either a genuine retry of this caller's own attempt (the common case —
    -- return the persisted result), or someone reused an attempt id that
    -- belongs to a DIFFERENT user (astronomically unlikely by chance for a
    -- v4 UUID, so only reachable by deliberately reusing an id learned some
    -- other way). Scope the lookup to v_uid so that case finds nothing and
    -- falls through to the exception below, instead of leaking another
    -- user's rune_delta/total_runes through this RPC's return value — RLS
    -- doesn't apply here (SECURITY DEFINER), so this check IS the boundary.
    select a.rune_delta, a.region_unlocked, s.runes into rune_delta, region_unlocked, total_runes
    from public.attempt_logs a
    join public.player_stats s on s.user_id = a.user_id
    where a.id = p_attempt_id and a.user_id = v_uid;

    if total_runes is null then
      raise exception 'attempt_id already used by another user';
    end if;

    return next;
    return;
  end if;

  update public.player_stats
  set runes = runes + rune_delta, updated_at = now()
  where user_id = v_uid
  returning runes into total_runes;

  if v_will_unlock then
    -- Next region in the fixed enum order (PRD: four regions, locked order,
    -- no boss select). Indexing past the last element returns null in
    -- Postgres arrays, so the last region correctly leaves current_region
    -- unchanged via the coalesce below.
    select (enum_range (null::public.region_id)) [array_position (enum_range (null::public.region_id), v_region) + 1]
    into v_next_region;

    update public.player_progress
    set
      regions_cleared = array_append (regions_cleared, v_region),
      current_region = coalesce(v_next_region, current_region),
      updated_at = now()
    where user_id = v_uid;
  end if;

  return next;
end;
$$;

-- Functions default to PUBLIC-executable in Postgres (unlike tables, which
-- default-deny) — revoke that and grant only to authenticated, explicitly.
revoke all on function public.resolve_attempt (uuid, text, text, integer) from public;
grant execute on function public.resolve_attempt (uuid, text, text, integer) to authenticated;

-- Same fix for handle_new_user (Sprint 4): it's SECURITY DEFINER and was
-- never meant to be called directly by a client, only by the signup trigger
-- — but it inherited the same PUBLIC-executable default. Tightened here,
-- the first time this migration set touches function grants.
revoke all on function public.handle_new_user () from public;
