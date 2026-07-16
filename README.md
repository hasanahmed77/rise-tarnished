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
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run format` | Prettier write across the repo |
| `npm run format:check` | Prettier check (no writes) |

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

🚧 Sprint 0 — foundations. See [docs/sprints/](docs/sprints/sprint-00.md).
