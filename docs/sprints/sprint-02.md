# Sprint 2 — First Boss Brain

- **Dates:** 2026-07-17 → 2026-07-24 (1 week)
- **Sprint goal:** *Margit exists and fights back: a data-driven move table
  running on the L3 action-selection pipeline, attacking the player through an
  entity-generic combat core — deterministic, fairness-validated, and testable
  headlessly.*

## Why this goal

The combat foundation (Sprint 1) gives the player verbs; nothing punches back
yet. The boss brain is the project's thesis — "no same tactic twice" — and L3
(action selection over a data-driven move table) is its load-bearing floor:
phase/tactic layers (#9) and adaptation weights all sit on top of it. Doing #22
first pays the refactor debt the #21 review flagged *before* the boss would
otherwise duplicate the player's poise/hit-resolution logic.

## Committed scope

- [ ] **#22** Extract entity-generic combat core — size M, p1 (chore)
      *Prerequisite. PoiseState unit shared by player+boss; generic hit
      resolution with player-only block/i-frame decorators; no behavior change
      (existing 39 tests pass unmodified or import-only changes).*
- [ ] **#8** Margit move table + L3 action selection — size L, p1 (feature)
      *~14 moves as MoveDef data incl. branching combos; eligibility filtering
      (range/cooldown/fairness) → seeded weighted RNG; schema-level data test
      enforcing fairness invariants F1/F2/F7 in CI; Margit rendered in the
      sandbox actually attacking the player.*

Sequenced #22 → #8 (the boss entity consumes the extracted core).

## Definition of Done (per issue, from SDLC §7)

- Boss logic 100% Phaser-free (ADR-0001/0002); seeded RNG → same seed, same
  fight (BOSS_AI.md §4).
- Data test: every authored move satisfies the MoveDef schema and F1 (tell ≥
  18f), F2 (≥30f between combo sequences), F7 (grabs: longest tells, no
  chaining) — CI fails on an illegal move.
- Sandbox: Margit visibly fights — approaches, selects moves, deals damage the
  player must dodge/block; posture/poise wired both directions.
- CI green; `/code-review` before merge.

## Out of scope (explicitly)

- **L2 tactic machine + behavior tracker (#9)** — L3 runs under a single
  default NEUTRAL-ish tactic this sprint; the intent layer is Sprint 3.
- Between-attempt LLM reweighting (#13's sibling) and the bot-sim harness
  (#14) — need L2 signals first.
- Margit's phase-2 moveset/cinematics — one phase is enough to prove the
  pipeline; phases are data (BOSS_AI.md §2), so adding them later is authoring,
  not engineering.
- Win/lose resolution (#11) — the fight doesn't need to *end* properly yet.

## Risks / watch-fors

- #22 is a refactor under a green test suite — the tests are the safety net;
  any test rewrite beyond imports is a red flag that behavior drifted.
- #8's scope creep vector is "just add the tactic layer while I'm here" —
  resist; a NEUTRAL-only boss that fights is the deliverable.
- Combo branch weights are tuning data; don't hand-balance this sprint, just
  make them *legal* (fairness tests) and *plumbed* (seeded RNG).

## Daily check-ins
- **07-17:** Sprint planned; #22 first (prerequisite), then #8.
- **07-17 (cont.):** Shipped #22. Shipped #8: rng, MoveDef schema + fairness
  data test, Margit's 8-move table, L3 selection pipeline (F3/F7/F8 by
  construction), the boss step/hit-resolution modules, and full scene wiring
  — Margit now fights the player in the sandbox. 79 tests, incl. seeded
  2000-tick determinism and 4000-tick fairness simulations; the F2 simulation
  test caught a real bug (no-combo moves skipped the inter-sequence gap)
  before it ever reached the scene. Live-verified end-to-end via manual
  Phaser-step pumping (rAF throttles on the backgrounded automation tab —
  known from Sprint 1's retro).

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
