-- Stat spend → next-attempt scaling (#12). player_stats stays read-only to
-- authenticated (ADR-0003) — this is the one door through which runes buy
-- vitality/dexterity/intelligence. Cost rises with the stat's own current
-- value and there's a hard cap beyond the §6 soft caps — both tuning
-- targets, not architecture, per COMBAT_SYSTEM.md §6.

-- ---------------------------------------------------------------------------
-- spend_stat_point — atomic deduct-and-increment. p_stat selects *which*
-- column to bump; the client never supplies a rune amount, a resulting
-- value, or a cost, only which rule applies (ADR-0003's "params select a
-- rule, not an amount" convention, same as resolve_attempt's
-- p_boss_id/p_result) — the RPC computes the cost itself from the stat's
-- current value, server-side, every time.
--
-- Idempotency: unlike resolve_attempt (a one-shot terminal event that must
-- never double-pay on retry), each call here spends exactly one point. A
-- dropped/retried network call either succeeds once or fails cleanly with
-- insufficient runes or a capped stat — there's no double-spend risk to
-- guard against, so no attempt-id dedupe key is needed (ADR-0003).
-- ---------------------------------------------------------------------------
create function public.spend_stat_point (p_stat text) returns table (
  vitality integer,
  dexterity integer,
  intelligence integer,
  runes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_cost_base constant integer := 100;
  -- Each point already bought raises the next one's cost — buying deep into
  -- one stat gets progressively more expensive relative to spreading runes
  -- across all three, without touching the softcap damage curve itself.
  v_cost_step constant integer := 25;
  -- Above the §6 soft caps (40/45/45) diminishing returns already discourage
  -- overinvestment; this hard ceiling is a separate, simpler backstop so no
  -- stat grows without bound no matter how many runes are farmed.
  v_hard_cap constant integer := 60;
  v_current integer;
  v_cost integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_stat not in ('vitality', 'dexterity', 'intelligence') then
    raise exception 'invalid stat: %', p_stat;
  end if;

  -- Lock the row before computing cost from it: without FOR UPDATE, two
  -- concurrent calls could both read the same pre-spend stat value, both
  -- compute the same (too-low) cost, and both pass the balance check below
  -- against a balance neither has actually paid yet. The lock makes the
  -- second call wait for the first to commit, then read the post-spend
  -- value — the same atomicity the single-statement UPDATE gave the flat-
  -- cost version, extended to a cost that now depends on current state.
  select
    case p_stat
      when 'vitality' then player_stats.vitality
      when 'dexterity' then player_stats.dexterity
      when 'intelligence' then player_stats.intelligence
    end
  into v_current
  from public.player_stats
  where user_id = v_uid
  for update;

  if v_current is null then
    raise exception 'no player_stats row for this user';
  end if;
  if v_current >= v_hard_cap then
    raise exception 'stat is already at its maximum (%.)', v_hard_cap;
  end if;

  v_cost := v_cost_base + v_cost_step * (v_current - 10);

  update public.player_stats
  set
    runes = player_stats.runes - v_cost,
    vitality = player_stats.vitality + case when p_stat = 'vitality' then 1 else 0 end,
    dexterity = player_stats.dexterity + case when p_stat = 'dexterity' then 1 else 0 end,
    intelligence = player_stats.intelligence
      + case when p_stat = 'intelligence' then 1 else 0 end,
    updated_at = now()
  where user_id = v_uid and player_stats.runes >= v_cost
  returning player_stats.vitality, player_stats.dexterity, player_stats.intelligence, player_stats.runes
  into vitality, dexterity, intelligence, runes;

  if not found then
    raise exception 'not enough runes';
  end if;

  return next;
end;
$$;

revoke all on function public.spend_stat_point (text) from public;
grant execute on function public.spend_stat_point (text) to authenticated;
