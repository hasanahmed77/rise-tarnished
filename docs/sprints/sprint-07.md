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
- [x] **#42 (part 2a)** Per-move distinct tells — size M, p1
      *Every move in Margit's table gets its own tell + active pose instead
      of sharing one generic windup/swing.*
- [ ] **#42 (part 2b)** Remaining juice — hitstop, death sequences. *Still
      deferred: distinct tells were the readability-critical half of part 2
      (a shared tell meant the AI's move-selection variety was invisible to
      the player); hitstop/death polish doesn't block that.*

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

- **08-03 (third pass):** Second playtest note, and a sharper version of the
  same class of bug: *"Margit's hit reaches me even if his sword doesn't
  touch me — a little far away still registers, more far away doesn't."*
  Exactly right. Widening her frame fixed the *pose*, but she has **eight
  moves spanning 80–260px** (`margitMoves.ts`) and they all share one active
  frame with a fixed ~90px cane reach. So `holy_thrust` (140) connected from
  ~32px past the cane tip and `flying_thrust` (260) from up to 152px past it
  — and there's no lunge in the move schema, so the boss doesn't close that
  gap either. The per-move fix would be a bespoke pose each; instead the
  scene now stretches a **strike streak to `move.rangeBand[1]`** — the same
  number `resolveBossAttackOnPlayer` tests against — so visual reach equals
  hit reach for every move automatically, including any added later. Guarded
  by a test that fails if any move's range exceeds the streak's native
  length. 156 unit tests. **Second instance of the same root lesson: this
  project's readability bugs are hitbox/visual *mismatches*, and they are
  invisible when reviewing art in isolation — they only show up when the
  sprite is composited against a player standing at the move's true range.**

- **08-04:** Third piece of playtest feedback, and the first that wasn't about
  art: *"Margit is attacking constantly and not giving me a single chance."*
  Traced it rather than guessing, and the first hypothesis (that #9's tactic
  layer was never wired up) was **wrong** — L2 is fully implemented, and
  `RECOVER` already does exactly the right thing, suppressing move selection
  entirely and backing off to range 125. The real cause was a **feedback loop
  against the player**: `PRESSURE` scored higher the *less* the player
  attacked (`1 + (1 - aggression) * 0.5`), so being suppressed made the boss
  press harder — no opening → attack rate falls → PRESSURE rises → crowds to
  range 45 → still no opening. With the softmax at 0.35 that locked in at
  ~99% of re-scores, while `RECOVER` sat gated on damage the *boss* had
  taken, which stays zero precisely when the player is losing. Relief only
  arrived as a reward for already winning.
  <br><br>
  Notably this was **code diverging from its own spec**: BOSS_AI.md §5's
  signal table maps `aggression` → RECOVER frequency, and maps `turtleIndex`
  (which already folds passivity in) → PRESSURE. So PRESSURE reading
  `aggression` was double-counting passivity *and* starving RECOVER of its
  documented input. Fix moves the term where the spec always said it went.
  <br><br>
  Also split `INTER_SEQUENCE_GAP_TICKS` (45, tuned) from
  `MIN_INTER_SEQUENCE_GAP_TICKS` (30, F2's floor) so pacing can be tuned
  without editing an invariant, with a test keeping them honest, and raised
  `cane_swing_1`'s cooldown 20→45 so the main opener can't cycle back
  instantly. **Tuned by measurement, not by feel:** the first attempt scored
  RECOVER too high and handed it **75%** of the fight — trading "never lets
  up" for "barely fights". Settled at shares of ~30% RECOVER when smothered,
  ~7% when the player is landing hits freely, and ~90% PRESSURE against a
  turtler. Those bands are now asserted, ceiling included, so both failure
  modes fail CI. 161 unit tests.

- **08-05:** #42 part 2a — every move in Margit's table now has its own tell
  and active pose. Before this, all eight moves (spanning F7's longest tell
  in the table at 40f down to a 18f combo continuation) shared one generic
  windup and one generic swing, so the L3 AI's actual move variety was
  invisible: a grab telegraphed identically to a fast cane swing. Distinct
  poses per move, keyed by `MoveDef.id`: `delayed_overhead` haul both arms
  straight overhead (two-handed, unmistakably not a swing); `holy_thrust`
  charges an arcane glow at the cane tip before a level thrust; `flying_thrust`
  coils low then leaps, body committed rather than just the arm; `sweep_kick`
  keeps the cane trailing low since the leg is the weapon; `reaper_flurry`
  widens the stance and flares the cape for a wide arc; `grab` — the longest
  tell in the table — spreads both arms wide open with the cane parked at her
  side, since the claws are the threat, not the weapon.
  <br><br>
  Two real problems only showed up once frames were rendered and inspected,
  not while writing the pose math: `grab`'s "reach" arms barely cleared the
  shoulder blob (unreadable as reaching), and its cane floated disconnected
  in empty space since the reaching arms don't touch it. Both fixed by
  actually looking at upscaled renders rather than trusting the coordinates —
  the same lesson as the two strike-reach bugs earlier this sprint, applied
  one level up: correctness isn't just hitbox-to-VFX agreement, it's whether
  a pose reads as intended at all, and that only shows up in the pixels.
  <br><br>
  Guarded by three new tests: every `margitMoves` id has a matching art
  entry (a move added without art would otherwise silently render as
  `cane_swing_1` — a move-selection bug disguised as a rendering success),
  every move's tell and active are pairwise distinct from every other move's,
  and no move's tell equals its own active. 163 unit tests. Recovery stays
  one shared pose deliberately — it reads similarly across moves and wasn't
  where the illegibility complaint was.

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
