# Sprint 3 — The Adaptation Layer

- **Dates:** 2026-07-17 → 2026-07-24 (1 week)
- **Sprint goal:** *Margit reads the player and shifts intent: the behavior
  tracker computes real signals from play, the L2 tactic machine turns them
  into intent, and L3 selection is weighted by both — with the F1–F8 fairness
  invariants proven by property-based tests against adversarial actors.*

## Why this goal

This is the project's thesis. Sprints 0–2 built the body (combat, moves,
deterministic selection); #9 builds the mind — the layer that makes dodge-spam
get punished and turtling get grabbed. BOSS_AI.md §4 already documents the two
seams left for it (`tactic filter`, `behaviorMod`), and §3/§5 spec the tactic
table and the seven signals. #10 rides along because the fairness net must be
proven *under adaptation pressure* — F4 (weight clamps) and F5 (punish rate
limit) only become testable once behavior weighting exists, and the Sprint 2
retro's lesson (passive-boss sims missed interrupt bugs) says these tests need
adversarial actors, not observation.

## Committed scope

- [ ] **#9** L2 tactic machine + behavior tracker signals — size L, p1
      *Seven rolling signals (BOSS_AI.md §5, 20s window); six tactics with
      entry/exit conditions (§3); PUNISH trigger priority; behaviorMod clamped
      to [0.25×, 4×] (F4); tactic filtering + behaviorMod wired into L3.*
- [ ] **#10** Fairness invariants F1–F8 as property-based tests — size M, p2
      *fast-check (or equivalent) over randomized signal streams and
      adversarial scripted players (roll-spammer, turtle, heal-greedy);
      ≥10k simulated decisions; any invariant breach fails CI.*

Sequenced #9 → #10 (the property tests exercise the finished adaptation).

## Definition of Done (per issue, from SDLC §7)

- All logic Phaser-free, seeded, deterministic; behavior signals unit-tested
  per signal (e.g. dodge-spam stream → dodgeReflex ≥ 0.7).
- PUNISH rate-limited (F5: ≤1 triggered punish per 4s); multipliers clamped
  (F4) — both enforced by construction *and* property-tested.
- Perceptibility smoke check in the sandbox: dodge-spamming visibly shifts
  Margit toward BAIT/delayed moves (S2's first evidence).
- Design docs updated in the SAME edit as any new constant (Sprint 2 retro).
- CI green; `/code-review` before merge.

## Out of scope (explicitly)

- Between-attempt LLM reweighting (#13's sibling) — needs attempt logs +
  server route; the in-fight loop must exist first.
- The bot-sim harness as a *product* (#14) — but #10's adversarial scripted
  players are its seed; #14 later grows them into the full CI harness.
- Win/lose resolution (#11), phase 2, other bosses.
- Signal *tuning* for feel — plumb and clamp now, tune when playtesting.

## Risks / watch-fors

- L2 is the most design-heavy code yet: keep the tactic machine's transition
  table as data where possible (mirrors the move-table philosophy).
- The approach()/REPOSITION boundary flagged in #26's review: L2 REPOSITION
  must *subsume* approach(), not fight it — one authority for "where does the
  boss walk."
- behaviorMod changes selection distributions → the seeded determinism tests
  must still hold (same seed + same input stream = same fight).

## Daily check-ins
- **07-17:** Sprint planned; #9 pulled to In Progress.
- **07-18:** #9 built: behavior tracker (7 signals, 20s bucket-ring window),
  L2 tactic machine (softmax intent, PUNISH priority + F5), move-level
  behaviorMod (F4-clamped, data rules), tactic filter + weighting wired into
  L3, movement unified under TACTIC_TARGET_RANGE (one authority — the #26
  seam). Adversarial roll-spammer sim proves delayed-strike frequency rises
  (S2 evidence). 102 tests. Also fixed a latent spawn bug (create()-time
  canvas width can be pre-layout junk; pre-fight relayouts now respawn at
  ratio positions).

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
