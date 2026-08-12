-- #55 — persist the boss's per-decision event log (BOSS_AI.md §8).
--
-- attempt_logs.log has existed since Sprint 4 and has always been `{}`: the
-- column was created for this and resolve_attempt never wrote it. §8 records
-- that gap explicitly ("still the spec, not yet collected... that's #13's
-- prerequisite"). This migration closes it by giving resolve_attempt a p_log
-- parameter, keeping the RPC the single writer to attempt_logs (#11 revoked
-- client INSERT precisely so that stays true).
--
-- Why DROP + CREATE rather than CREATE OR REPLACE: adding a parameter changes
-- the signature, so REPLACE would leave the 4-arg function in place alongside
-- the new one. With p_log defaulted, a 4-argument call would then match BOTH
-- and Postgres would reject it as ambiguous — the deploy would break exactly
-- the call the old clients are making. Dropping first means there is only ever
-- one resolve_attempt, and the default keeps an in-flight client that hasn't
-- reloaded yet working through the change.
--
-- The reward logic below is BYTE-IDENTICAL to 20260721132716_resolve_attempt.
-- The only additions are the p_log parameter, the sanitising block, and `log`
-- in the INSERT column list. Nothing about rune payment, reachability or
-- idempotency is touched — this is telemetry, and it must not be able to move
-- authoritative state.
-- ---------------------------------------------------------------------------

drop function if exists public.resolve_attempt (uuid, text, text, integer);

create function public.resolve_attempt (
  p_attempt_id uuid,
  p_boss_id text,
  p_result text,
  p_duration_ticks integer,
  p_log jsonb default '{}'::jsonb
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
  v_decisions jsonb;
  v_log jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_result not in ('victory', 'death') then
    raise exception 'invalid result: %', p_result;
  end if;

  -- Sanitise the log before it is stored. This is untrusted client input
  -- written into a column no other code validates, so:
  --   * only `decisions` survives — any other key a client invents is dropped
  --     rather than persisted into a row #13 will later feed to a model;
  --   * a non-array `decisions` is discarded instead of stored malformed;
  --   * an oversized array is replaced by a marker rather than stored, so one
  --     attempt row cannot be used to park unbounded data in the database.
  -- The cap is well above the client's own MAX_LOGGED_DECISIONS (400): the
  -- client bounds for prompt size, this bounds for abuse, and they are
  -- deliberately independent — a client is not a permission check.
  --
  -- Oversized truncates rather than raising: the log is telemetry and the rune
  -- payment is not. Failing the whole call would cost a player their reward
  -- over a defect in data that earns them nothing.
  v_decisions := p_log -> 'decisions';
  if v_decisions is null or jsonb_typeof(v_decisions) <> 'array' then
    v_log := '{}'::jsonb;
  elsif jsonb_array_length(v_decisions) > 1000 then
    v_log := jsonb_build_object('truncated', true);
  else
    v_log := jsonb_build_object('decisions', v_decisions);
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
  -- lose), may be resolved.
  if not (v_region = v_current_region or v_already_cleared) then
    raise exception 'boss % is not yet reachable', p_boss_id;
  end if;

  v_will_unlock := p_result = 'victory' and not v_already_cleared;
  region_unlocked := v_will_unlock;

  -- Idempotency guard, unchanged: FOUND is true only if this INSERT actually
  -- added a row. A retried call with the same p_attempt_id conflicts on the
  -- primary key, inserts nothing, and falls into the branch below.
  --
  -- This also settles what a retry does to the log: `do nothing` means the
  -- FIRST log recorded wins and a later call cannot overwrite it, matching the
  -- rule the rest of this function already follows (the first-recorded outcome
  -- always wins). A retry therefore cannot corrupt or replace the decisions of
  -- the attempt that was actually played.
  insert into public.attempt_logs (
    id, user_id, boss_id, result, duration_ticks, rune_delta, region_unlocked, log
  )
  values (p_attempt_id, v_uid, p_boss_id, p_result, p_duration_ticks, rune_delta, v_will_unlock, v_log)
  on conflict (id) do nothing;

  if not found then
    -- Either a genuine retry of this caller's own attempt (the common case —
    -- return the persisted result), or someone reused an attempt id that
    -- belongs to a DIFFERENT user. Scope the lookup to v_uid so that case
    -- finds nothing and falls through to the exception below, instead of
    -- leaking another user's rune_delta/total_runes through this RPC's return
    -- value — RLS doesn't apply here (SECURITY DEFINER), so this check IS the
    -- boundary.
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

-- Functions default to PUBLIC-executable in Postgres — revoke and grant only
-- to authenticated, explicitly. Re-applied here because the grants were tied
-- to the dropped 4-argument signature and do not carry over.
revoke all on function public.resolve_attempt (uuid, text, text, integer, jsonb) from public;
grant execute on function public.resolve_attempt (uuid, text, text, integer, jsonb) to authenticated;
