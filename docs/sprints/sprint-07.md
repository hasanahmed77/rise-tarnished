# Sprint 7 — Give It a Face

- **Dates:** 2026-08-03 → 2026-08-10 (1 week)
- **Sprint goal:** *The fight stops being coloured rectangles. A knight with a
  real sword fights a visibly larger, horned Margit in a moonlit Stormveil
  arena, and every combat state the engine already tracks — tell, active
  window, recovery, stagger, critical — reads as a distinct pose.*

## Why this goal

Every mechanic the MVP promised now exists (Sprint 6 closed the last one).
What's missing isn't logic, it's legibility: PRD §8 flagged from the start
that *feel* can't be judged with boxes, and Sprint 6's own review noted the
tension — "all three archetypes clear Margit" proves balance, not whether the
fight is good to play. This sprint is the rendering-layer swap #42 scoped:
no combat-logic changes, since ADR-0001 already keeps the sim engine-agnostic
and every animation maps 1:1 onto a state the sim exposes.

## Committed scope

- [x] **#42 (part 1)** Sprite/animation layer + Stormveil arena — size L, p1
      *Generated pixel-art sheets for the player and Margit, parallax
      backdrop, slash VFX, screenshake; frames selected purely from existing
      sim state.*
- [ ] **#42 (part 2)** Boss combo animation coverage + remaining juice —
      hitstop, per-move distinct tells, death sequences. *Deferred to a
      follow-up ticket: part 1 gives every move the same tell/active/recovery
      poses, which is honest but not yet expressive per-move.*

## The art-sourcing decision, revisited

The issue committed to a **licensed asset pack** (itch.io / Kenney /
OpenGameArt). That's changed to **generated art**, deliberately:

- A checked-in generator (`scripts/generate-sprites.mjs`, dependency-free —
  it ships its own PNG encoder over Node's zlib) makes the art original, so
  there's no attribution or licence-compliance surface on a graded project.
- It's regenerable and reviewable as a diff, not an opaque binary drop.
- It costs nothing and needs no account or purchase.

The trade is fidelity: hand-drawn or professionally-packed art would look
better than programmatic pixel art. The rendering layer is agnostic either
way — `src/game/render/spriteFrames.ts` owns the frame indices, so swapping
in a bought pack later is replacing PNGs, not rewriting the scene. PRD §8's
open art question is updated to record this.

## Definition of Done

- No combat-logic change: `playerCombat.ts` / `bossCombat.ts` / the frame
  data untouched, and the fairness property suite passes unchanged (ADR-0001
  — the scene reads state, it never decides).
- Every animation frame is chosen from state the sim already exposes
  (`action.id` + `action.phase`, stagger, posture) — no parallel animation
  state machine that could drift out of sync with the real hitboxes.
- The sprite-sheet layout is asserted, not assumed: a headless test reads the
  committed PNGs and proves they contain every frame the scene indexes, and
  that startup/active/recovery are distinct poses (a collapsed tell would
  break COMBAT_SYSTEM.md §1's readability pillar silently).
- Generated assets are committed, so a fresh clone renders without running
  the generator; `npm run assets` regenerates deterministically (seeded RNG —
  reruns must not churn the diff).
- CI green; `/code-review` before merge.

## Out of scope (explicitly)

- The other three regions' backdrops — Stormveil only (the only boss that
  exists).
- Audio. Not mentioned in #42 and a separate discipline.
- Hitstop and per-move distinct tells — part 2 above.
- An accessibility toggle for screenshake. COMBAT_SYSTEM.md §8 calls for one;
  shake is budgeted low here, and the toggle needs a settings surface that
  doesn't exist yet. Tracked as a follow-up.

## Risks / watch-fors

- **Programmatic pixel art has a quality ceiling.** It reads well at a
  glance; it will not look hand-drawn. If it undersells the project, the
  swap path above is the mitigation, not a rewrite.
- **Frame indices are a contract split across two files** (the generator and
  `spriteFrames.ts`). The new test covers count/range, but *not* that frame
  17 is the pose someone thinks it is — a renumber that stays in range still
  needs eyes on the sheet.
- **In-engine visual verification needs a signed-in session.** The art was
  verified by rendering the sheets and a composited arena preview directly;
  confirming it in a live fight carries the same blocker as Sprint 6's
  outstanding playtest note.

## Daily check-ins

- **08-03:** #42 part 1 built. Wrote a dependency-free pixel toolkit
  (`scripts/lib/pixel.mjs`: RGBA canvas, shape primitives, nearest-neighbour
  upscale, PNG encoder over zlib, seeded RNG) and a generator producing a
  20-frame player sheet, an 8-frame Margit sheet, a 4-frame slash arc, and
  four parallax backdrop layers. Two iterations on the art after actually
  looking at the output: the first pass clipped the sword at the canvas edge
  (widened the player canvas 16→22 base px and repositioned every sword pose)
  and gave Margit vertical horns that ran off the top of the frame (reworked
  them to sweep outward, dropped the body 3px, thickened the staff so it
  reads as a held weapon). A third fix killed loose gold pixels the thin
  diagonal crossguard was scattering — invisible at base resolution, 3×3
  blocks after upscale. Swapped CombatScene's rectangles for sprites with
  feet-anchored origins, frame selection driven entirely off sim state,
  parallax tied to player offset from centre, pooled slash VFX fired from the
  sim's own `attack:active` event (so VFX can't drift from the hitbox), and
  budgeted screenshake weighted by hit severity. 153 unit tests (up from
  147). Full gate green.

- **08-03 (later):** First real playtest feedback on the art, and it caught
  something the static previews couldn't: *"Margit's strikes feel bad — he's
  striking the ground, it should strike me."* Correct, and the root cause was
  a sizing mistake, not a pose one. Her sprite was 108px wide while her melee
  moves hit from **80–140px** (`margitMoves.ts` rangeBand) — the canvas
  physically could not contain a strike that reached the player, so the only
  direction the cane had left to travel was down, which reads as slamming the
  floor beside her. Widened her frame to 204px (her body is unchanged; the
  extra is reach), and reworked the three attack poses so the cane pulls back
  over the shoulder on the tell, extends *forward to the player's chest* on
  the active frame, and follows through low on recovery. Also fixed the cane
  detaching from her hand in the staggered/collapsed frames — the grip sat
  where no arm reached. Verified by compositing the strike against a player
  placed at the move's true 100px hit range, rather than eyeballing the sheet
  in isolation. **Lesson worth keeping: sprite dimensions are a gameplay
  decision, not an art one** — an attack animation that can't reach as far as
  its hitbox is a readability bug (§1), and reviewing frames in isolation
  hides it completely.

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
