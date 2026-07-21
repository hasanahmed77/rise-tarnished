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
4. **Append-only logs are untrusted telemetry.** `attempt_logs` rows are
   client-written and only sanity-bounded by CHECKs; nothing authoritative
   (the real runes balance) is ever derived from them.

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
