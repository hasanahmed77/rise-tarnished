-- Between-attempt LLM reweighting (#64, ADR-0002's promised sibling to #13).
-- Persists per-(player, boss) drift on the two constant tables that already
-- drive combat — tactics.ts's BASE_SCORE and weighting.ts's WeightRule
-- gains — so a habit shown across several attempts amplifies faster next
-- time, instead of every fight starting from the same fixed numbers.
--
-- Same read/write split as player_stats (ADR-0003): the client can SELECT
-- its own row (CombatScene needs it to start a fight), but only a SECURITY
-- DEFINER RPC can write it. This is not currency, but it is still something
-- a client must not be able to fake its own way into — a player editing
-- their own row directly could zero out every gain the boss is supposed to
-- be leaning on and hand themselves an easier fight; the RPC is the only
-- legitimate path so the values written are always what the (already
-- clamped, server-side) reweight route actually computed.
-- ---------------------------------------------------------------------------

create table public.boss_weight_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  boss_id text not null,
  -- Both jsonb: a partial map of tag/tactic -> number. Only keys already
  -- known to the game (Object.keys(BASE_SCORE), the tags real WeightRules
  -- use) are ever written — enforced in application code (recap.ts's
  -- isGrounded()-style closed-vocabulary check, applied to numbers here
  -- instead of prose), not by a schema constraint, since the known-key set
  -- lives in TypeScript next to the tables it overrides.
  tactic_base_score jsonb not null default '{}'::jsonb,
  weight_rule_gains jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, boss_id)
);

alter table public.boss_weight_overrides enable row level security;

create policy "select own boss weight overrides" on public.boss_weight_overrides
  for select using (auth.uid () = user_id);

-- No insert/update/delete grant to authenticated — every write goes through
-- upsert_boss_weight_overrides below, matching player_stats' convention.
grant select on public.boss_weight_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_boss_weight_overrides — the one door through which a player's
-- weight overrides for a boss change. Called only from the server-side
-- /api/reweight route (src/app/api/recap-style handler.ts), under the
-- caller's own session — never a raw client call with untrusted numbers,
-- but a second, cheap sanity check here costs nothing and matches
-- resolve_attempt's p_log layered-defense precedent (#55): a TypeScript
-- layer validates first, this is the backstop, not the primary guard.
-- ---------------------------------------------------------------------------
create function public.upsert_boss_weight_overrides (
  p_boss_id text,
  p_tactic_base_score jsonb,
  p_weight_rule_gains jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_tactic_base_score) <> 'object' or jsonb_typeof(p_weight_rule_gains) <> 'object'
  then
    raise exception 'weight overrides must be objects';
  end if;
  -- Backstop against a pathological payload parking unbounded data on this
  -- row — the real vocabulary/value clamp already happened in TypeScript
  -- before this was called; five-ish keys is generous headroom for Margit's
  -- five tags and five scored tactics without hardcoding either set here.
  if
    (select count(*) from jsonb_object_keys(p_tactic_base_score)) > 20
    or (select count(*) from jsonb_object_keys(p_weight_rule_gains)) > 20
  then
    raise exception 'too many weight override keys';
  end if;

  insert into public.boss_weight_overrides (user_id, boss_id, tactic_base_score, weight_rule_gains)
  values (v_uid, p_boss_id, p_tactic_base_score, p_weight_rule_gains)
  on conflict (user_id, boss_id) do update
  set
    tactic_base_score = excluded.tactic_base_score,
    weight_rule_gains = excluded.weight_rule_gains,
    updated_at = now();
end;
$$;

revoke all on function public.upsert_boss_weight_overrides (text, jsonb, jsonb) from public;
grant execute on function public.upsert_boss_weight_overrides (text, jsonb, jsonb) to authenticated;
