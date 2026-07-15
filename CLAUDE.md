# Rise, Tarnished

2D single-player boss-rush game (Elden Ring–inspired). Four fixed-order bosses,
RPG-lite stat/loot system, two AI layers (real-time FSM combat AI + async LLM
for move-reweighting and post-death breakdowns).

**Stack:** Next.js (shell/UI) · Phaser.js (combat engine) · Supabase (Google
OAuth + Postgres) · OpenAI API (async only) · Vercel (hosting).

We build this like a world-class product team, even though the team is one
person. Process is enforced by tooling, not intention.

---

## Operating rules (non-negotiable)

1. **Branch + PR for every change.** Never commit to `main` directly. One
   logical change per PR. Self-review with `/code-review` before merge — it is
   the "second engineer."
2. **CI must be green to merge.** lint + typecheck + unit tests + build all pass.
   No merging red.
3. **Vertical slices, not horizontal layers.** Ship "log in → fight one boss →
   win/lose screen" end-to-end before breadth. Never "all backend, then all
   frontend."
4. **Definition of Done** = code + tests + docs updated + CI green. A ticket is
   not done until all four hold.
5. **One sprint = one goal.** Written sprint plan at start, written retro at end.
   No grab-bag sprints.
6. **TypeScript strict.** No `any` without a written reason. No disabling lint
   rules inline without a comment saying why.
7. **Decisions that are expensive to reverse get an ADR** before the code lands
   (see `docs/adr/`).

## Testing (matched to the stack)

- **Unit** (Vitest): pure logic — FSM transitions, stat-scaling math, rune
  economy. These must be genuinely unit-testable; keep game logic pure and
  separate from Phaser rendering.
- **Integration**: Supabase queries and the OpenAI call boundary (mocked /
  contract-tested — never hit the live API in CI).
- **E2E** (Playwright): auth flow + core game-loop smoke test.
- **Manual**: combat feel is subjective — log playtests in `docs/playtests/`.

## Architecture guardrails

- **LLM latency is unacceptable in the combat loop.** All real-time boss
  decisions run in the in-engine FSM. OpenAI is async only (between attempts,
  post-death).
- **Keep game logic engine-agnostic.** Combat/stat/FSM logic lives in plain TS
  modules, unit-testable without Phaser. Phaser is the rendering/physics shell
  around it.
- **Never commit secrets.** Supabase/OpenAI keys via env vars only.

---

## Where things live

- `docs/PRD.md` — product requirements, non-goals, success criteria
- `docs/ARCHITECTURE.md` — system diagram, tech rationale
- `docs/SDLC.md` — full process: sprint cadence, board workflow, DoD, CI gates
- `docs/design/COMBAT_SYSTEM.md` — player combat: frame model, stamina, poise, stats
- `docs/design/BOSS_AI.md` — the 3-layer HFSM boss brain, signals, fairness invariants
- `docs/adr/` — Architecture Decision Records (one decision each)
- `docs/sprints/` — sprint plans + retros (one file per sprint)
- `docs/playtests/` — manual playtest logs

When working on combat or boss behavior, read the two design docs first —
they are the source of truth; code follows spec, spec changes via PR.

**Read `docs/SDLC.md` for the full process. This file is the summary the rules
live by.**
