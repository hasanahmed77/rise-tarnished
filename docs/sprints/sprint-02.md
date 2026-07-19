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

- [x] **#22** Extract entity-generic combat core — size M, p1 (chore, PR #25)
      *Prerequisite. PoiseState unit shared by player+boss; generic hit
      resolution with player-only block/i-frame decorators; no behavior change
      (existing 39 tests pass unmodified or import-only changes).*
- [x] **#8** Margit move table + L3 action selection — size L, p1 (feature, PR #26)
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

**Goal met: yes.** Margit exists and fights back: an 8-move data-driven table
(6 combo branches) on the L3 selection pipeline, running through the
entity-generic combat core, deterministic (seeded PRNG, 2000-tick replay test)
and fairness-validated (schema data test + 4000-tick × multi-seed simulations
for F2/F3/F8).

Delivered:
- #22: shared `poise.ts` (decay/accumulate/undefended-hit core); player
  delegates to it, boss consumes it — zero behavior change, old tests untouched.
- #8: `boss/` module — seeded rng, MoveDef schema + fairness validator (CI
  fails on an illegal move), Margit's phase-1 table, L3 selection
  (range/cooldown/condition/F8 filtering → weighted pick, F2/F3 by
  construction), boss entity step + hit resolution with posture-break
  critical hits, full scene wiring. **83 tests.**

The review pass on #8 was the most productive yet — 8 verified findings, five
of them real correctness bugs in the fairness accounting (frozen cooldowns
during move execution, combo-link cooldown bypass, dead combo conditions, F2
bypass on interrupt, missing player hit-feedback). All fixed and pinned by
tests before merge.

## Retro (end of sprint)

**What worked**
- The two-layer test strategy earned its keep twice: the F2 *simulation* test
  caught a real gap-skipping bug during development, and the multi-agent
  review's verify pass then caught four more accounting bugs the simulations
  missed (because the sims never attacked the boss — no interrupts, no
  cooldown pressure). Different bug classes, different nets.
- Sequencing #22 before #8 worked exactly as intended: the boss reused the
  shared poise core with zero duplication.
- Model-switching mid-sprint (Opus/Fable/Sonnet authored different parts)
  proved a non-issue in practice — the artifacts (tests, review, CI) carry the
  trust, not the author. Worth remembering when the anxiety resurfaces.

**What didn't**
- The DoD docs gap recurred a third time (bossTuning constants + behaviorMod
  deferral undocumented) — the same class of finding #7's review caught.
  Clearly a blind spot in how features get authored, not a one-off.
- Simulation tests only exercised a passive boss (no player bot attacking it),
  which is why the interrupt-path and cooldown-freeze bugs survived to review.

**One change for next sprint**
- When authoring any new tuning constant or deferring any spec'd term, update
  the design doc *in the same edit* — treat the doc line as part of the code
  change, not a follow-up. And when writing simulation tests, include at least
  one adversarial actor (hits landing both ways), not just observation.

**Sprint status: CLOSED.**
