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
