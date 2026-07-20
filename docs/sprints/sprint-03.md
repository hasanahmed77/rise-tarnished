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

- [x] **#9** L2 tactic machine + behavior tracker signals — size L, p1
      *Seven rolling signals (BOSS_AI.md §5, 20s window); six tactics with
      entry/exit conditions (§3); PUNISH trigger priority; behaviorMod clamped
      to [0.25×, 4×] (F4); tactic filtering + behaviorMod wired into L3.*
- [x] **#10** Fairness invariants F1–F8 as property-based tests — size M, p2
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
- **07-18 (cont.):** Full multi-agent review on #9 found 5 real correctness
  bugs (dodge triple-counted from state-shape probing; RECOVER's own backoff
  self-inflated the camping signal; PUNISH triggered on a live hitbox instead
  of a whiff; RECOVER never suppressed attacks; an early-fight rate spike
  saturated aggression) — all fixed, 108 tests, merged. Shipped #10: fairness
  invariants proven via fast-check (pure clamp properties + 5 adversarial bots
  × 5 seeds × 2500 ticks = 62.5k decisions, zero violations). Sprint goal met.
  113 tests total.

## Review (end of sprint)

**Goal met: yes.** Margit reads the player and shifts intent — 7 rolling
signals, 6 tactics with PUNISH priority, behaviorMod wired into L3 selection —
and the fairness net (F1–F5, F7, F8) is proven under genuinely adversarial
simulation, not passive observation. S2 (perceptibility) has its first hard
evidence: a roll-spamming bot measurably sees more delayed strikes than a calm
player across seeds.

Delivered:
- `behaviorTracker.ts` — rolling 20s window, ring of 1s buckets, 7 signals.
- `tactics.ts` — L2 softmax intent machine, PUNISH trigger + F5 rate limit.
- `weighting.ts` — F4-clamped move-level behaviorMod from per-boss data rules.
- L3 wiring: tactic filter (with spec fallback) + behaviorMod, both live.
- Movement unified under one authority (`TACTIC_TARGET_RANGE`), closing the
  seam #26's review flagged.
- `fairness.property.test.ts` — property-based proof, 62.5k+ adversarial
  decisions, zero invariant violations.
- 113 tests total; both PRs code-reviewed (#9 found and fixed 5 real bugs).

Not in scope / deferred: LLM reweighting, the bot-sim harness as a product
(#14), win/lose resolution, phase 2, signal tuning for feel.

## Retro (end of sprint)

**What worked**
- The review earned its cost again, decisively: #9's 8-angle pass (with 2
  agents relaunched after a session-limit hiccup) found the dodge triple-count
  and the RECOVER feedback loop — both would have shipped invisibly, since
  every existing test passed and the sandbox looked fine. Bugs in *signal
  computation* don't crash anything; they just make the adaptation quietly
  wrong, which is exactly the class of bug a human playtester struggles to
  notice ("the boss feels a little off") but a reviewer reading the math
  catches immediately.
- Naming the #26 seam (approach()/REPOSITION) as a sprint risk up front meant
  it got resolved as a first-class part of #9 instead of another deferred
  finding — the plan's "risks / watch-fors" section is pulling real weight.
- Sequencing #10 after #9 (not in parallel) meant the property tests exercised
  the *fixed* adaptation code, not the buggy first draft — the fairness suite
  shows zero violations because the bugs it would have caught were already
  gone.

**What didn't**
- Same session-limit interruption pattern as Sprint 2's review — two finder
  agents died mid-run and needed relaunching. Not a process failure (the retry
  worked, nothing was lost), but a recurring cost worth naming again.
- The dodge triple-count bug traces back to a design shortcut in #9's first
  draft: deriving "did the player just dodge" from state *shape* instead of
  the sim's own `action:start` events, which already existed and already
  disambiguated this exactly. Cheaper to reach for the existing event stream
  first next time a scene needs "did X just happen."

**One change for next sprint**
- When a scene needs to know "did the player just do X," check for an
  existing sim event before re-deriving it from state shape — the sim usually
  already published it.

**Sprint status: CLOSED.**
