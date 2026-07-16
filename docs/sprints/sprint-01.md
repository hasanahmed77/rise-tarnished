# Sprint 1 — Combat Foundation

- **Dates:** 2026-07-16 → 2026-07-23 (1 week)
- **Sprint goal:** *A player can move and act in the arena under a real
  souls-like combat model — commitment-based frame data, stamina economy, dodge
  i-frames, and poise/stagger — all as pure, unit-tested logic driving Phaser.*

## Why this goal

Builds directly on the Sprint 0 skeleton and turns the blank canvas into
something with actual game feel. It's almost entirely the **engine-agnostic
logic layer** (ADR-0001) — the highest unit-test value in the project (success
criterion S5, ≥80%) and the foundation every boss fight sits on. No external
services (Supabase/OpenAI) needed, so nothing blocks it.

## Committed scope

- [x] **#6** Player movement + core frame-data actions (light/heavy/dodge/block)
      — size L, p1 (PR #19)
- [x] **#7** Stamina / poise / posture system — size M, p1 (PR #21)

Sequenced #6 → #7 (stamina/poise attach to the actions #6 defines).

## Definition of Done (per issue, from SDLC §7)

- Fixed 60-tick sim clock; actions as startup/active/recovery per
  `design/COMBAT_SYSTEM.md` §2–4.
- Logic in Phaser-free TS modules; Phaser only renders results.
- Unit tests: i-frame dodge (hit during i-frames = no damage), stamina
  regen/spend, poise→stagger threshold, posture→critical window.
- CI green; `/code-review` before merge.

## Out of scope (explicitly)

- Boss AI (that's #8/#9). A static training-dummy target is fine for testing hits.
- Sprites/art — primitives are acceptable this sprint; combat *feel* tuning
  comes once the systems exist.
- Sorcery/FP, weapon variety, stat scaling (#12) — later.

## Daily check-ins
- **07-16:** Sprint planned; goal = combat foundation. #6 pulled to In Progress.
- **07-16 (cont.):** Shipped #6 (movement + frame-data action FSM, dodge
  i-frames, light chaining, block; 21 tests) + a mid-sprint viewport fix
  (full-screen responsive canvas). Then #7 (stamina regen, poise/stagger,
  boss posture; 39 tests). Both full multi-agent code review. Goal met.

## Review (end of sprint)

**Goal met: yes.** A player moves and acts under a real souls-like combat model
— commitment-based frame data (startup/active/recovery on a 60-tick clock),
stamina economy with delayed regen, dodge i-frames, poise→stagger, guard break,
and a boss posture/critical-window meter — all in Phaser-free modules driving a
playable sandbox (`CombatScene`).

Delivered:
- `combat/frameData.ts` — tuning table + constants, traceable to
  COMBAT_SYSTEM.md (spec updated to record every number).
- `combat/playerCombat.ts` — the action state machine, resources, hit
  resolution (i-frames / block / poise-stagger / guard-break).
- `combat/posture.ts` — standalone boss posture meter, ready for #8.
- `CombatScene` — full-viewport responsive render, HUD, training dummy.
- **39 unit tests** across three files; CI green on every PR.

Scope discipline: the canvas-sizing fix rode in with #6 (same branch, in
scope); an out-of-scope refactor need (entity-generic combat core) was filed as
#22 instead of expanding #7.

## Retro (end of sprint)

**What worked**
- Pure-logic-first paid off exactly as designed: combat rules are unit-tested
  headlessly, and the code review could reason precisely about them (it caught
  a real re-stagger bug by numeric simulation, not guesswork).
- Design-spec-as-source-of-truth held: the review flagged four code-only tuning
  numbers as a DoD violation, and the fix was to update the doc — the guardrail
  worked as intended.
- Deferring the entity-generic refactor to #22 kept #7 focused instead of
  ballooning into boss-shaped abstraction before the boss exists.

**What didn't**
- A backgrounded-preview-tab false alarm during #6 (rAF pauses when the tab
  isn't foreground) cost a detour before root-causing it as an artifact, not a
  bug. Lesson logged: verify the harness/tab state before suspecting the code.
- The multi-agent review hit a mid-run session limit and six of eight finders
  had to be relaunched — worked, but a reminder these reviews are token-heavy.

**One change for next sprint**
- When a change is observable only under an animation loop, confirm the preview
  tab is foregrounded (or pump the loop manually) before treating flat behavior
  as a defect — avoids chasing non-bugs.

**Sprint status: CLOSED.**
