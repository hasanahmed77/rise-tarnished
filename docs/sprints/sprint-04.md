# Sprint 4 — The Persistence Spine

- **Dates:** 2026-07-18 → 2026-07-25 (1 week)
- **Sprint goal:** *A player can sign in with Google and their stats/builds/
  progress/attempt logs persist in Postgres — the account and save-data spine
  every later feature (rune spend, win/lose, LLM recap) needs before it means
  anything.*

## Why this goal

Sprints 1–3 went deep on one thing: the combat/AI engine, entirely
Phaser-free, entirely local, no external services. That was deliberate
sequencing — the highest-uncertainty, highest-test-value work first. But the
PRD's MVP (`docs/PRD.md` §6) has always required sign-in + persistence
alongside the fight, and nothing built so far *saves* anything: runes,
progress, and stats all evaporate on reload. Every remaining engine feature
(#11 win/lose rune rewards, #12 stat spend actually changing scaling next
attempt, #13's attempt-log-driven recap) is inert without a place to persist
to. This sprint is a deliberate change of flavor — infrastructure and
external-service integration instead of pure TS logic — precisely so the
account/save spine exists *before* those features get built on top of it
twice.

## Committed scope

- [x] **#4** Google OAuth sign-in via Supabase — size M, p1
      *Supabase project with Google OAuth as sole sign-in; sign-in/out works
      end-to-end in the Next.js shell; session persists across reloads;
      protected routes redirect unauthenticated users; anon key client-side
      only, service key never reaches the browser.*
- [ ] **#5** Supabase schema + migrations — size M, p1
      *Postgres schema for stats, builds/weapons, region progress, attempt
      logs (ADR-0003); migrations checked into the repo, no dashboard-only
      changes; RLS on every user-scoped table, proven by a test that a user
      cannot read/write another user's rows; local-dev story documented.*

Sequenced #4 → #5 (schema's RLS policies reference `auth.uid()`, so a working
auth setup comes first).

## Definition of Done (per issue, from SDLC §7)

- No secrets committed; Supabase URL/anon key via env vars, service key
  server-side only, `.env.local` gitignored.
- RLS proven, not assumed: an integration test creates two users and asserts
  cross-user reads/writes fail.
- Sign-in flow manually verified in-browser (this is real external-service
  wiring; unit tests can't cover the OAuth handshake itself).
- Migrations are the only way schema changes — no dashboard edits, matching
  ADR-0003.
- CI green (mocked/contract-tested Supabase calls only — never hits the live
  project in CI, per SDLC §8); `/code-review` before merge.

## Out of scope (explicitly)

- Stat spend UI / character sheet (#12) — schema supports it, UI doesn't
  exist yet.
- Win/lose resolution writing real rune rewards (#11) — needs this spine
  first; the write path lands next, not the trigger.
- LLM post-death recap (#13) — needs attempt logs to actually accumulate
  real data first.
- Any change to the combat/boss engine — this sprint doesn't touch
  `src/game/`.

## Risks / watch-fors

- **New domain risk**: first time this repo touches a real external service.
  Unlike four sprints of pure-TS engine work, this can't be fully proven by
  unit tests — the OAuth handshake and RLS need actual manual/integration
  verification against a real (or local) Supabase instance.
- **Blocking dependency**: implementing #4 needs an actual Supabase project
  (URL + anon key) to point the code at. That's an external account the user
  needs to create or grant access to — flagging this explicitly rather than
  assuming it exists.
- Keep the schema honest to ADR-0003's four tables (stats, builds, progress,
  attempt logs) — don't let the schema grow speculative columns for features
  not yet built.

## Daily check-ins
- **07-18:** Sprint planned. Blocked on a Supabase project existing before
  #4 can start — confirming with the user before pulling it into progress.
- **07-21:** User created the Supabase project; #4 built — SSR client/server
  Supabase clients, session-refresh proxy (renamed from Next.js's deprecated
  `middleware` convention), OAuth callback route, sign-in/out UI, `/` (public
  landing) and `/play` (protected — server-side redirect if unauthenticated).
  Hit the real external-service risk named in this sprint's own risk list:
  Google provider needed enabling in Supabase (missed on first save, then a
  missing OAuth Client Secret) — each config gap surfaced as a distinct,
  correctly-worded Supabase error (`provider not enabled` →
  `missing OAuth secret`), confirming the client-side code was correct
  throughout and the problem was purely external configuration. Full round
  trip (sign-in → Google consent → `/play` → reload persists session →
  sign-out → back to `/`) manually verified by the user in their real,
  authenticated browser — the automation pane's separate unauthenticated
  profile correctly could not complete this leg (no credentials were ever
  entered on the user's behalf, by design).

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
