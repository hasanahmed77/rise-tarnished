# Rise, Tarnished

[![CI](https://github.com/hasanahmed77/rise-tarnished/actions/workflows/ci.yml/badge.svg)](https://github.com/hasanahmed77/rise-tarnished/actions/workflows/ci.yml)

A 2D souls-like **boss-rush** for the browser, built as a CSE327 (Software
Engineering) course project. No filler, no exploration — just bosses, and an
AI that refuses to let you win the same way twice.

🎥 [Gameplay demo](docs/rise-tarnished-gameplay.mp4)

## The pitch

Bosses run a three-layer hierarchical finite state machine (phase → tactic →
action) whose weights adapt to *your* recent behavior, within hard fairness
invariants so it never becomes unwinnable:

- Panic-roll and you'll eat delayed strikes.
- Turtle behind a block and the grabs come out.
- Heal greedily in range and get punished.

Between attempts, an LLM reweights the boss's opening tendencies from your
attempt log — a habit shown over several fights amplifies faster next time.
When you die, it also tells you exactly what killed you, grounded in the
real decision that ended the fight (never a hallucinated reason).

## Features

- **Adaptive boss AI** — a data-driven, seeded, fully unit- and
  property-tested hierarchical FSM. See [`docs/design/BOSS_AI.md`](docs/design/BOSS_AI.md).
- **Real-time combat** — frame-accurate startup/active/recovery windows,
  poise, posture-break criticals, stamina/Focus Point economy. See
  [`docs/design/COMBAT_SYSTEM.md`](docs/design/COMBAT_SYSTEM.md).
- **Between-attempt LLM reweighting** — OpenAI proposes closed-vocabulary,
  bounds-clamped adjustments to the boss's tactic/move weights after each
  attempt; never participates in the real-time frame loop.
- **Post-death recap** — a one-sentence, fact-checked explanation of what
  killed you, generated from the same decision log the boss AI itself
  produced.
- **Persistent character progression** — runes earned per attempt, spent on
  vitality/dexterity/intelligence, all server-authoritative via RLS-gated
  Postgres RPCs (a client can never award itself runes or stats).
- **A player-bot simulation harness** — scripted adversarial bots (roll-spammer,
  turtle, range-camper, masher, chaos) prove the boss actually adapts, in CI,
  headlessly, before any human ever playtests.
- **Google OAuth**, a main menu with live stat display, and in-fight
  pause/resume.

**Boss roster:** Margit is fully implemented today. Radahn, Malenia, and
Radagon & Elden Beast are designed (see `BOSS_AI.md` §7) and the codebase now
has a `BossDefinition` seam (`src/game/boss/bossDefinition.ts`) specifically
so a new boss plugs in as a new definition rather than a combat-code rewrite —
but they are not built yet.

## Stack

Next.js (shell) · Phaser (engine) · TypeScript strict · Supabase (Google OAuth
+ Postgres + RLS) · OpenAI (async only — never in the combat loop) · Vercel.

## Documentation

| Doc | What |
|-----|------|
| [PRD](docs/PRD.md) | Product goals, non-goals, success criteria |
| [Architecture](docs/ARCHITECTURE.md) | System overview, logic/engine boundary |
| [Combat System](docs/design/COMBAT_SYSTEM.md) | Frame model, stamina, poise, builds |
| [Boss AI](docs/design/BOSS_AI.md) | The HFSM brain, behavior signals, fairness rules, LLM reweighting |
| [SDLC](docs/SDLC.md) | Process: Scrumban, CI gates, Definition of Done |
| [ADRs](docs/adr/README.md) | Architecture decisions, with rationale and alternatives considered |
| [Sprints](docs/sprints/) | Weekly sprint logs — goal, what shipped, retro |

## Getting started

### Prerequisites

- **Node ≥ 20.12** (CI runs on 22; `.nvmrc` pins 22). Older 20.x releases lack
  `node:util.styleText`, which the toolchain (Vitest, lint-staged) requires —
  if you see a `styleText` error, your Node is too old. With nvm: `nvm use`.
- npm 11 (what the lockfile is authored with).
- A [Supabase](https://supabase.com) project (free tier is enough) — needed
  for auth and persistence. [Docker](https://docker.com) if you also want to
  run Supabase locally (recommended for schema work).
- An [OpenAI API key](https://platform.openai.com/api-keys) — optional. The
  app runs fully without one; the recap and reweighting features just
  degrade to "nothing to show" rather than erroring (see ADR-0004).

### Clone and install

```bash
git clone https://github.com/hasanahmed77/rise-tarnished.git
cd rise-tarnished
nvm use            # or ensure node -v is >= 20.12
npm ci
```

### Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Required | Where to get it |
|----------|----------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase → Project Settings → API (the publishable/anon key — safe for the client, RLS is what actually protects data) |
| `OPENAI_API_KEY` | No | [platform.openai.com](https://platform.openai.com/api-keys) — powers the death recap and between-attempt reweighting; both features silently no-op without it |

Your Supabase project also needs the schema applied and Google OAuth
configured:

1. Push the migrations: `npx supabase login`, then `npx supabase link
   --project-ref <your-project-ref>`, then `npx supabase db push`.
2. In Supabase → Authentication → Providers, enable **Google** and set the
   OAuth redirect URL to `<your-site-url>/auth/callback` (for local dev,
   `http://localhost:3000/auth/callback`).

`NEXT_PUBLIC_*` variables are inlined into the browser bundle at **build**
time — for a real Vercel deploy, set them in the Vercel project's own
environment variables too, not just `.env.local`.

### Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with Google,
and fight.

## Scripts

| Script | Does |
|--------|------|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm start` | Serve a production build (run `build` first) |
| `npm test` | Unit tests (Vitest, run once) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:rls` | RLS cross-user isolation tests — needs local Supabase running (below) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run format` | Prettier write across the repo |
| `npm run format:check` | Prettier check (no writes) |
| `npm run assets` | Regenerate the sprite/background PNGs (below) |
| `npm run audio` | Regenerate the SFX/ambience WAVs (below) |

## Testing

The test suite (`npm test`) is Vitest-only and hermetic — no network calls,
no live Supabase, no real OpenAI. Every provider/database boundary is
dependency-injected and mocked at the test layer (see e.g.
`src/app/api/recap/handler.test.ts`).

- **Unit tests** cover the pure combat/boss-AI logic layer directly — FSM
  transitions, damage/stamina math, the rune economy, weight-override
  merging, prompt construction and response validation for both LLM
  features.
- **Property-based tests** (`fast-check`) prove fairness invariants
  (`fairness.property.test.ts`) hold for arbitrary signals, rule gains, and
  even adversarial between-attempt override values — not just the specific
  numbers anyone happened to hand-author.
- **Adversarial simulation**: scripted player bots drive the full boss
  sim for thousands of ticks per seed, asserting every fairness invariant
  holds under real (if synthetic) adversarial play.
- **RLS tests** (`npm run test:rls`) prove row-level security actually
  isolates users — two throwaway accounts against a real local Postgres,
  asserting cross-user reads/writes fail and same-user access works. See
  [Local Supabase](#local-supabase) below.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the unit suite, the RLS
suite (against a fresh local Supabase instance it spins up itself — **never**
the live project), and a production build on every PR.

## Local Supabase

Schema changes are migrations only (`supabase/migrations/`, ADR-0003) — never
dashboard edits. To develop or test against a real local Postgres running
those migrations:

```bash
npx supabase start          # spins up local Postgres/Auth/Storage via Docker,
                             # applies every migration in supabase/migrations/
npx supabase status -o env  # prints API_URL / ANON_KEY / SERVICE_ROLE_KEY
```

Export those three as `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`, then:

```bash
npm run test:rls
```

This never touches the live hosted project — CI runs the identical suite
against its own fresh local Supabase instance, per SDLC §8 ("never hit live
prod in CI").

New schema change → `npx supabase migration new <name>`, write the SQL, then
apply it to your local instance with `npx supabase db reset` (rebuilds local
Postgres from all migrations) before pushing to the real project with
`npx supabase db push` (requires `supabase login` — a personal auth step, not
something to script or share, and a genuinely live write — double-check
you mean it).

## Art assets

All sprites and backdrops are **generated, not sourced** — `npm run assets`
runs `scripts/generate-sprites.mjs`, which draws pixel-art sheets and the
Stormveil parallax layers into `public/sprites/`. The output is committed, so
a fresh clone renders without running it; regenerate only after editing the
generator.

The generator writes frames in a fixed order that
`src/game/render/spriteFrames.ts` indexes into, and `spriteFrames.test.ts`
asserts the committed PNGs actually contain every frame the scene asks for —
so a regenerate that changes the frame count fails CI rather than silently
animating the wrong pose.

## Audio

Same policy as the art: all SFX and the ambient loop are **synthesised, not
sourced** — `npm run audio` runs `scripts/generate-audio.mjs`
(`scripts/lib/audio.mjs` is the underlying signal toolkit: oscillators,
noise, envelopes, a feedback-delay reverb, and a dependency-free WAV
encoder). "Dark Souls-like" is honoured as a mood target — low, sparse,
muffled — not by shipping anyone else's recordings, which would be a real
licensing problem in a public repo.

`src/game/audio/soundManifest.ts` is the contract (which keys exist, how
loud each sits) and `soundManifest.test.ts` asserts every key has a real,
non-silent, non-clipping WAV behind it, and that the ambience loop's seam
stays within normal waveform motion.

## Contributing

The full process lives in [`docs/SDLC.md`](docs/SDLC.md); the short version:

1. **Every unit of work is a GitHub Issue** — clear title, acceptance
   criteria, labeled (`type:*`, `area:*`, `p0`–`p2`, `size:*`).
2. **Branch per issue**: `feat/NN-short-slug`, `fix/NN-...`, `chore/NN-...`
   (`NN` = the issue number). No direct commits to `main` — it's protected.
3. **One logical change per PR.** Small PRs over big ones. The PR
   description links the issue (`Closes #NN`) and states how it was tested.
4. **Definition of Done**, before a PR is mergeable:
   - Code implements the acceptance criteria.
   - Tests written and passing (unit for logic; RLS/integration where a
     Supabase boundary is touched).
   - Docs updated where relevant (PRD/ARCHITECTURE/an ADR/this README).
   - CI green: lint, typecheck, unit tests, RLS tests, build.
5. **Pre-commit hook** (Husky + lint-staged) ESLint-fixes and Prettier-formats
   every staged code file automatically, and **blocks the commit** on any
   remaining lint error. `git commit --no-verify` bypasses it — don't; CI
   runs the same checks and will fail the PR anyway, so bypassing only moves
   the failure later.
6. Squash-merge to keep `main`'s history linear.

New to the codebase? Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the Next.js/Phaser boundary, then [`docs/design/BOSS_AI.md`](docs/design/BOSS_AI.md)
for how the adaptive AI actually works — it's the most-tested, most-documented
part of the project on purpose.

## Status

Core loop, persistence, and adaptive AI (both the real-time layer and the
between-attempt LLM reweighting) are complete and shipped for Margit, the
first boss. See [`docs/sprints/`](docs/sprints/) for the full week-by-week
log of what landed when and why.

Remaining roadmap: additional bosses (Radahn, Malenia, Radagon & Elden Beast)
using the `BossDefinition` seam, and broader manual playtesting.
