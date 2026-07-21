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
- [x] **#5** Supabase schema + migrations — size M, p1
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
- **07-21 (cont.):** #5 built — `supabase/migrations/` (player_stats,
  player_progress, player_builds, attempt_logs, all RLS-enabled; a
  SECURITY DEFINER signup trigger auto-provisions stats/progress). RLS DoD
  ("a test creates two users and asserts cross-user reads/writes fail")
  written as a real integration test (`supabase/tests/rls.test.ts`, kept
  separate from the fast unit suite) — 8 cases covering every table's
  read/write/insert isolation plus the positive same-user case. Hit a second
  real external-tooling risk: local Docker Desktop was corrupted (image-cache
  I/O errors) and couldn't be fixed from the terminal — deferred local
  verification to CI's own clean Docker environment (new `rls` job,
  `supabase/setup-cli`), rather than block on an environment repair outside
  the project.

- **07-21 (#5 review):** CI's `rls` job (first real run vs. real Postgres)
  surfaced three migration bugs beyond the local gates — a `GITHUB_ENV`
  quoting bug, a missing table GRANT to `authenticated`, and another to
  `service_role` (BYPASSRLS ≠ table grant) — all fixed with CI as the proof.
  Then multi-agent `/code-review` (8 finder angles) found a real security
  hole: RLS gates *rows*, not *values*, so the UPDATE policies let a signed-in
  player PATCH their own runes/stats/progress to anything via the raw REST API.
  Fixed by making authoritative state (stats, progress) client-read-only —
  mutations move to the server-validated write path (#11/#12). Also hardened:
  `ALTER DEFAULT PRIVILEGES` as the durable grants baseline (no per-table GRANT
  to forget), one-active-build unique index, default-build provisioning,
  attempt_logs sanity bounds, `updated_at` triggers, documented realtime
  exclusion. Conventions recorded in ADR-0003.

## Review (end of sprint)

**Goal met: yes.** A player signs in with Google and gets a real, RLS-isolated
save spine in Postgres — stats, progress, builds, and attempt logs, each
user-scoped and *proven* isolated against a real database, not assumed. The
account/persistence layer every later feature (#11 rune rewards, #12 stat
spend, #13 LLM recap) needs now exists to build on.

Delivered:
- **#4** — Supabase Google OAuth as sole sign-in: SSR client/server clients, a
  session-refresh proxy (Next.js 16's renamed `middleware`→`proxy` convention),
  the OAuth callback route, `/` (public) and `/play` (server-side protected).
  Full round trip manually verified in a real browser.
- **#5** — the schema + migrations (stats, progress, builds, attempt logs),
  RLS on every table with a SECURITY DEFINER signup trigger provisioning the
  per-user singleton rows, and a real cross-user isolation suite (10 cases) run
  against a live local Postgres in a dedicated CI job — never the hosted
  project (SDLC §8).
- **Security + schema hardening** (from `/code-review`): closed a real
  RLS-gates-rows-not-values hole (authoritative state is now client-read-only,
  mutations reserved for the server-validated write path), moved grants to
  `ALTER DEFAULT PRIVILEGES` (fail-closed baseline, no per-table GRANT to
  forget), one-active-build constraint, default-build provisioning,
  attempt_logs sanity bounds, `updated_at` triggers, documented realtime
  exclusion. Conventions recorded in ADR-0003.
- **Dropped the redundant `health` stat** — vitality is the sole survivability
  stat, HP derives from it; cleaned from schema, the `PlayerBuild` type, seeds,
  and COMBAT_SYSTEM.md.

Not in scope / deferred: the write paths that *populate* this spine (#11
win/lose rune rewards, #12 stat spend), the LLM recap that reads attempt logs
(#13), and applying the migration to the live hosted project (needs the user's
own `supabase login` — a personal auth step, never scripted).

## Retro (end of sprint)

**What worked**
- **CI as verification ground truth when the local environment failed.** Local
  Docker Desktop was corrupted (image-cache I/O errors) and couldn't be
  repaired from the terminal, so the RLS proof couldn't run locally at all.
  Rather than block on an environment repair outside the project, the `rls` job
  ran the exact suite against CI's own clean Docker — and it earned its keep
  immediately, catching three migration bugs the local gates (typecheck, lint,
  unit, build) structurally *cannot* see: a `GITHUB_ENV` quoting bug, and two
  missing table GRANTs (`authenticated`, then `service_role`). A migration that
  "parses fine" is not a migration that "works" — only a real Postgres proves
  the second.
- **The review earned its cost decisively again.** The 8-angle pass found a
  genuine security hole — RLS policies gate *which row* you touch, not *what
  value* you write, so a signed-in player could `PATCH` their own runes to a
  billion via the raw REST API. Every test was green and the app "worked"; this
  is invisible to unit tests and to a playtester, and visible only to a
  reviewer reading the policy semantics.
- **The sprint's own risk list predicted the real friction.** Both named risks
  fired exactly as written: the OAuth provider config gaps (each surfaced as a
  distinct, correctly-worded Supabase error, proving the client code was right
  throughout) and the external-tooling dependency (Docker). Naming them up
  front turned them into expected checkpoints, not surprises.
- **A domain question sharpened the model mid-flight.** Pausing on "is this
  schema normalized?" surfaced the `health`/`vitality` redundancy — a stored
  derived value — and cutting it left a cleaner 3-stat model than we started
  with.

**What didn't**
- **Grants got fixed reactively, twice, before the durable fix landed.** The
  first two CI failures were both "forgot the GRANT," patched per-table. Only
  after the review's altitude angle did the real fix land (`ALTER DEFAULT
  PRIVILEGES` + a written ADR convention) so the *next* migration can't
  reproduce the same class of bug. The lesson: when the same failure recurs,
  stop patching instances and fix the mechanism.
- **Local Docker is still broken** — deferred by mutual agreement (it's the
  user's own machine, repairable via Docker Desktop → Troubleshoot → purge).
  Fine for now since CI is the source of truth, but local Supabase iteration is
  unavailable until it's fixed.
- **The session-limit interruption hit the review a third sprint running** —
  several finder/verify agents died mid-run and were relaunched after the reset.
  Nothing was lost, but it's now a reliable tax on multi-agent reviews worth
  planning around.

**One change for next sprint**
- For schema/migration work, wire the real-database proof into CI from the
  *first* push and treat it as the gate — don't try to verify migrations
  locally first. Local Docker proved unreliable, and CI's clean environment
  caught bugs the local gates never could. "It parses" and "it runs on real
  Postgres" are different claims; only CI cheaply proves the second.

**Sprint status: CLOSED.**
