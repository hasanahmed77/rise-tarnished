-- Backfill (#11 follow-up): handle_new_user only fires on NEW auth.users
-- inserts (AFTER INSERT trigger, Sprint 4). Real accounts that signed up
-- before that trigger existed have no player_stats/player_progress/
-- player_builds row — discovered when resolve_attempt's UPDATE against a
-- nonexistent player_stats row matched zero rows, silently leaving
-- total_runes NULL and surfacing as "resolve_attempt returned an unexpected
-- shape" client-side. One-time, idempotent backfill (safe to re-run: each
-- INSERT only targets auth.users rows that don't already have the table).
insert into public.player_stats (user_id)
select id
from auth.users u
where not exists (select 1 from public.player_stats s where s.user_id = u.id);

insert into public.player_progress (user_id)
select id
from auth.users u
where not exists (select 1 from public.player_progress p where p.user_id = u.id);

insert into public.player_builds (user_id)
select id
from auth.users u
where not exists (select 1 from public.player_builds b where b.user_id = u.id);
