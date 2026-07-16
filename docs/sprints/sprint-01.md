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

- [ ] **#6** Player movement + core frame-data actions (light/heavy/dodge/block)
      — size L, p1
- [ ] **#7** Stamina / poise / posture system — size M, p1

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

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
