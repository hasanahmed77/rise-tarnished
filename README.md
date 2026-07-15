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

## Status

🚧 Sprint 0 — foundations. See [docs/sprints/](docs/sprints/sprint-00.md).
