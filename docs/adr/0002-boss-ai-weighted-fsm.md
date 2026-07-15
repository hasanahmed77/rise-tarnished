# ADR-0002: Boss AI as a hierarchical behavior-weighted FSM (no LLM in the loop)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** (you)

## Context
The core pitch is a boss that adapts to the player and can't be beaten the same
way twice. Real-time combat decisions happen many times per second; any network
round-trip (e.g., to an LLM) is far too slow and too costly for the loop. We need
adaptation that is fast, deterministic enough to test, and *perceptible* to the
player (success-criterion S2).

## Decision
Model the boss as a **three-layer hierarchical finite state machine (HFSM)
whose transition probabilities are weighted by a rolling summary of recent
player behavior.** A flat FSM cannot express sustained intent (pressuring,
baiting, punishing) — the layer separation is what makes the boss read as
intelligent rather than random. Full spec: `docs/design/BOSS_AI.md`.

- **L1 Phase** (per-fight): HP-threshold phases select movesets and stat mods.
- **L2 Tactic** (2–8s): NEUTRAL / PRESSURE / BAIT / PUNISH / REPOSITION /
  RECOVER — the intent layer, where behavior weighting primarily acts.
- **L3 Action** (0.3–2s): concrete moves as **data-driven move tables** with
  branching combos, selected by weighted seeded RNG.

- A **behavior tracker** maintains cheap rolling signals: dodge frequency,
  attack cadence, heal timing, preferred range, turtling.
- FSM transitions are **weighted** by those signals within **fairness
  constraints** (caps/cooldowns so adaptation never becomes unwinnable) — e.g.
  dodge-spam raises the weight of delayed strikes; turtling raises unblockable
  grabs.
- The FSM is driven by a **seeded RNG** so runs are reproducible in tests and bug
  reports.
- **Between-attempt reweighting** (the LLM part) is a *separate, async* concern:
  OpenAI adjusts *starting* weights for the next attempt; it never participates in
  the frame loop. Falls back to heuristic weights if unavailable.

## Alternatives considered
- **LLM makes real-time decisions** — rejected: latency (100s of ms+), cost, and
  nondeterminism make it unusable and untestable for frame-level combat.
- **Flat (single-layer) FSM** — rejected: cannot express sustained intent;
  bosses read as random move dispensers, defeating perceptibility (S2).
- **Behavior trees** — closest competitor; viable, but the tactic layer of an
  HFSM gives us the same intent-expressiveness while staying trivially
  unit-testable transition-by-transition, and our designers (us) reason more
  naturally in states+weights than in tree decorators.
- **Pure scripted patterns** — rejected: no adaptation, defeats the core pitch.
- **RL-trained policy** — rejected: massive overkill, opaque, hard to keep fair.

## Consequences
- **Positive:** frame-fast, deterministic, testable (S5), tunable for fairness,
  and adaptation is authored/legible so we can guarantee it's perceptible (S2).
- **Negative:** adaptation is bounded by the signals and transitions we author —
  less "emergent" than a learned policy; requires tuning to *feel* adaptive.
- **Follow-ups (resolved in `docs/design/BOSS_AI.md`):** v1 behavior signals
  (§5), fairness invariants F1–F8 (§6), move tables as data (§4). Remaining:
  contract for the async reweighting payload.
