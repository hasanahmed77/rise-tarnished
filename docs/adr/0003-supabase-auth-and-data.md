# ADR-0003: Supabase for auth and persistence

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** (you)

## Context
We need Google sign-in, a relational store for player stats/builds/progress/
attempt logs, and minimal ops overhead for a solo dev. Auth and data ideally come
from one managed provider to reduce integration surface.

## Decision
Use **Supabase**: Google OAuth via Supabase Auth (sole sign-in method) and
Postgres for all persistence, with **Row-Level Security on every user-scoped
table** so a user can only read/write their own rows.

- Client uses the anon key; privileged server work uses the service key
  server-side only.
- Schema (stats, builds, progress, attempt logs) is managed via **migrations
  checked into the repo** — no ad-hoc changes in the dashboard.

### Data-access rules (schema conventions, implemented in `#5`)

These are load-bearing conventions every future migration must follow, learned
the hard way while building the first one:

1. **RLS gates rows, not values.** A policy like `using (auth.uid() = user_id)`
   controls *which* row you may touch, never *what value* you write. So **any
   table holding authoritative game state (runes, stats, region progress) is
   read-only to the client** — no UPDATE/INSERT grant for `authenticated`.
   Mutating that state goes through **SECURITY DEFINER RPCs** that validate the
   transition server-side (the `#11`/`#12` write path). Only player-owned,
   non-authoritative rows (cosmetic builds, append-only attempt logs) are
   directly client-writable. Without this, a signed-in player can `PATCH` their
   own runes to a billion via the raw REST API.
2. **Table grants are a precondition RLS can't replace.** Postgres checks the
   table-level ACL *before* RLS runs, so a table with policies but no grant is
   `permission denied`, not "deny-all-rows". This schema sets it once via
   `ALTER DEFAULT PRIVILEGES` (SELECT to `authenticated`, ALL to `service_role`)
   so future tables inherit a safe, **fail-closed** baseline — a new table is
   readable-but-RLS-gated, never silently write-open. Write grants are added
   explicitly per table where a policy allows the write.
3. **Provision every per-user singleton on signup.** The `handle_new_user`
   trigger seeds stats, progress, and a default active build, so no first-read
   ever hits a missing row.
4. ~~Append-only logs are untrusted telemetry~~ **Superseded by `#11`.**
   `attempt_logs` was client-INSERT-able (Sprint 4, before any RPC existed to
   own it); once `resolve_attempt` became the real writer, the direct INSERT
   grant was revoked — a client-writable row an RPC's idempotency guard also
   trusts is a hole (see point 5's last bullet). It's now client-read-only,
   same posture as `player_stats`/`player_progress`.
5. **Writing through a SECURITY DEFINER RPC (`#11`'s `resolve_attempt`)
   needs its own care, beyond the table rules above:**
   - **Functions default PUBLIC-executable** — the opposite of tables, which
     default-deny. Every new privileged function needs an explicit
     `revoke all ... from public` + `grant execute ... to authenticated`, or
     it's silently callable by anyone signed in (or, worse, by `anon`).
   - **The client never supplies an amount.** The RPC's parameters select
     *which* server-side rule applies (a boss id, a result) — never a rune
     count or unlock flag. There is structurally nothing for a malicious
     client to override.
   - **Idempotency via a client-generated id as the dedupe key**, so a retried
     call (page refresh, dropped connection) can't double-pay: insert on that
     id with `on conflict do nothing`, branch on whether the insert actually
     happened.
   - **Scope the idempotent-replay lookup to the caller.** SECURITY DEFINER
     bypasses RLS entirely, so a replay branch that looks up "what did this
     attempt id resolve to" *without* also filtering by the caller's own
     `auth.uid()` will happily return another user's private data if they
     reuse (or guess) an id — the function's own logic is the only boundary
     left once RLS is out of the picture. Caught in `#11`'s own review before
     merge; worth stating explicitly so the next RPC doesn't reopen it.
   - **A replay branch is only as trustworthy as the row it reads.** If the
     table it reads from is (or ever was) client-writable, a client can
     pre-seed a row at a self-chosen id and have the replay branch echo it
     straight back as if it were a genuine prior result. The fix isn't in the
     RPC — it's ensuring nothing but the RPC itself can ever write that table
     (point 4 above).
   - **State transitions need a reachability check, not just a validity
     check.** Validating "is this a real boss" isn't the same as validating
     "is this boss reachable to *this* player right now." A transition RPC
     that advances progress (here: `current_region`) must verify the
     requested step is either the caller's actual current step or one
     they've already passed — otherwise a later addition (boss #2) can
     silently skip or regress progress through a path that was always
     structurally possible, just unreachable until more data existed to
     trigger it. Caught in `#11`'s own review, unreachable with one boss at
     merge time but fixed at the root rather than deferred.

## Alternatives considered
- **NextAuth + self-hosted Postgres** — rejected: more moving parts and ops for a
  solo dev; we'd hand-roll what Supabase bundles.
- **Firebase** — rejected: document model fits our relational stat/build/log data
  worse; we want SQL and RLS.
- **Clerk/Auth0 + separate DB** — rejected: two vendors, more integration surface,
  no benefit at our scale.

## Consequences
- **Positive:** one provider for auth+data, RLS security model, SQL, generous free
  tier, pairs cleanly with Vercel.
- **Negative:** vendor lock-in to Supabase specifics (RLS, auth helpers); local
  dev needs the Supabase CLI / local stack for offline work.
- **Follow-ups:** design the schema + first migration; write RLS policies and test
  them; decide local-dev story (Supabase CLI local vs. a dev project).
