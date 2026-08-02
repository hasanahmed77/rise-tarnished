-- Stat spend → next-attempt scaling (#12). player_stats stays read-only to
-- authenticated (ADR-0003) — this is the one door through which runes buy
-- vitality/dexterity/intelligence. A flat cost per point (tuning target, not
-- architecture, per COMBAT_SYSTEM.md §6) — no stat_costs table needed yet;
-- add one if the design ever wants per-stat or scaling costs.

-- ---------------------------------------------------------------------------
-- spend_stat_point — atomic deduct-and-increment. p_stat selects *which*
-- column to bump; the client never supplies a rune amount or resulting
-- value, only which rule applies (ADR-0003's "params select a rule, not an
-- amount" convention, same as resolve_attempt's p_boss_id/p_result).
--
-- Idempotency: unlike resolve_attempt (a one-shot terminal event that must
-- never double-pay on retry), each call here spends exactly one point. A
-- dropped/retried network call either succeeds once or fails cleanly with
-- insufficient runes — there's no double-spend risk to guard against, so no
-- attempt-id dedupe key is needed.
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
  v_cost constant integer := 100;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_stat not in ('vitality', 'dexterity', 'intelligence') then
    raise exception 'invalid stat: %', p_stat;
  end if;

  -- Single conditional UPDATE is the atomic guard: the WHERE clause checks
  -- runes >= v_cost in the same statement that spends them, so two
  -- concurrent calls can't both read a stale balance and both succeed (the
  -- SELECT-then-UPDATE pattern this avoids would race). Every column
  -- reference is qualified with the table name — the OUT parameters above
  -- share names with these columns, and plpgsql resolves an unqualified
  -- name against either, ambiguously, without the qualifier.
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
