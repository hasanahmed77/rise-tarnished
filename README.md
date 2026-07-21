# Rise, Tarnished

A 2D souls-like **boss-rush** for the browser. Four bosses, fixed order, no
filler — and an adaptive AI that refuses to let you win the same way twice.

## The pitch

Bosses run a three-layer hierarchical FSM (phase → tactic → action) whose
weights adapt to *your* recent behavior: panic-roll and you'll eat delayed
strikes; turtle and the grabs come out; heal greedily and get punished — all
under hard fairness invariants so it never becomes unwinnable. Between
attempts, an LLM reweights the boss's opening tendencies from your attempt log
and, when you die, tells you *exactly* what killed you.

**Bosses:** Margit → Radahn → Malenia → Radagon & Elden Beast.

## Stack

Next.js (shell) · Phaser (engine) · TypeScript strict · Supabase (Google OAuth
+ Postgres) · OpenAI (async only — never in the combat loop) · Vercel.

## Documentation

| Doc | What |
|-----|------|
| [PRD](docs/PRD.md) | Product goals, non-goals, success criteria |
| [Architecture](docs/ARCHITECTURE.md) | System overview, logic/engine boundary |
| [Combat System](docs/design/COMBAT_SYSTEM.md) | Frame model, stamina, poise, builds |
| [Boss AI](docs/design/BOSS_AI.md) | The HFSM brain, behavior signals, fairness rules |
| [SDLC](docs/SDLC.md) | Process: Scrumban, CI gates, Definition of Done |
| [ADRs](docs/adr/README.md) | Architecture decisions |

## Development

### Prerequisites

- **Node ≥ 20.12** (CI runs on 22; `.nvmrc` pins 22). Older 20.x releases lack
  `node:util.styleText`, which the toolchain (Vitest, lint-staged) requires — if
  you see a `styleText` error, your Node is too old. With nvm: `nvm use`.
- npm 11 (what the lockfile is authored with).

### Setup

```bash
nvm use            # or ensure node -v is >= 20.12
npm ci
npm run dev        # http://localhost:3000
```

### Scripts

| Script | Does |
|--------|------|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm test` | Unit tests (Vitest, run once) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:rls` | RLS cross-user isolation tests — needs local Supabase running (below) |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run format` | Prettier write across the repo |
| `npm run format:check` | Prettier check (no writes) |

### Local Supabase

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
npm run test:rls   # proves RLS: two throwaway users, asserts cross-user
                    # reads/writes fail and same-user access works
```

This never touches the live hosted project — CI runs the identical suite
against its own fresh local Supabase instance (`.github/workflows/ci.yml`,
job `rls`), per SDLC §8 ("never hit live prod in CI").

New schema change → `npx supabase migration new <name>`, write the SQL, then
apply it to your local instance with `npx supabase db reset` (rebuilds local
Postgres from all migrations) before pushing to the real project with
`npx supabase db push` (requires `supabase login` — a personal auth step, not
something to script or share).

### Pre-commit hook

Husky runs `lint-staged` on every commit: staged code files are ESLint-fixed
(commit **blocked** on any remaining error/warning) and Prettier-formatted;
staged JSON/CSS/YAML are Prettier-formatted. Design docs under `docs/` and
Markdown are intentionally left alone (hand-authored tables/diagrams).

`git commit --no-verify` bypasses the hook. Don't: CI runs the same checks and
will fail the PR anyway, so bypassing only moves the failure later. The only
legitimate use is an unrelated emergency where the hook infrastructure itself is
broken.

## Status

🚧 Sprint 4 — the persistence spine (Google OAuth, Supabase schema/RLS). See
[docs/sprints/](docs/sprints/sprint-04.md) and the full log in
[docs/sprints/](docs/sprints/).
