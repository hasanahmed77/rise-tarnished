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
- [x] **#42 (part 2b)** Remaining juice — hitstop, death sequences — size S, p2
      *A real-time freeze-frame on impact, weighted by hit severity; a
      two-beat death sequence (reel, then prone) instead of an instant snap.*

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

- **08-06:** #42 part 2b — the remaining combat juice: hitstop and death
  sequences. Hitstop is a hard real-time freeze-frame on impact
  (`CombatScene.triggerHitstop`), weighted the same way screenshake already
  is: a critical holds longest (90ms), then a heavy landing or a clean hit
  taken (60-80ms), then a light or a blocked hit (30-40ms). Implemented as a
  wall-clock pause at the top of `update()` — the accumulator doesn't grow
  and no ticks are consumed while frozen, so every fairness invariant that
  counts ticks (F1-F8) is untouched by construction: hitstop delays real time
  equally for both combatants without changing what a tick means, and a
  keypress during the freeze isn't lost (JustDown simply isn't polled on
  those frames, so Phaser's own edge-detection reports it truthfully once
  the freeze lifts).
  <br><br>
  Death goes from an instant snap to a two-beat sequence (reel, then the
  final prone pose) — but costs **zero new art**: `PF.death.reel` reuses the
  existing stagger frame, `MF.death.reel` reuses the existing posture-break
  collapsed frame, since both already read as "just been hit hard" or
  "barely standing." The sim itself stops advancing the instant hp hits 0
  (`finished`), so there are no ticks left to time an animation with —
  the reel→prone hold is timed off real elapsed ms tracked separately
  (`deathAnimMs`), the same real-time-not-ticks pattern hitstop uses.
  <br><br>
  167 unit tests (up from 163): the death sequence's two beats are asserted
  distinct, and the specific frame reuse (reel = stagger / collapsed) is
  pinned so a future edit can't silently drift the two apart. Both features
  are scene-only (CombatScene, the imperative shell) — no pure sim module
  touched, consistent with ADR-0001.
  <br><br>
  **#42 is now fully closed**: real sprites and arena (part 1), per-move
  tells (part 2a), and the remaining juice (part 2b).

- **08-08:** #51 (new, outside this sprint's original committed scope) —
  audio: combat SFX and a subtle looping dark-ambient bed. Same sourcing call
  as #42's art and for the same reason: **generated, not sourced**.
  "Dark Souls-like" is honoured as a mood target (low, sparse, muffled) via
  original synthesis, not by shipping anyone else's recordings, which would
  be a real copyright problem in a public repo.
  <br><br>
  Built a signal toolkit (`scripts/lib/audio.mjs`: oscillators, noise,
  envelopes, a feedback-delay reverb, a dependency-free 16-bit PCM WAV
  encoder) and a generator producing ten combat SFX (both swing weights, a
  heavier boss swing, hit/critical hit, block, dodge, cast, hurt, death) plus
  one 32-second ambient loop — a low drone in A with a fifth and a faint
  sour second, a wide quiet noise bed, and a distant toll every 8s.
  <br><br>
  Caught a real bug via analysis rather than by ear (I cannot listen; see
  below): the first ambience render had a seam discontinuity 6x a normal
  sample step at the loop point — an audible click every 32s. Root cause was
  that snapping every frequency to a whole number of cycles makes the
  *sources* periodic, but the render still isn't, because filters (lowpass/
  highpass/tremolo) start with zeroed internal state — so the opening seconds
  carry a warm-up transient that doesn't match the settled tail. Fixed by
  rendering two full loops and keeping only the second, now-settled one;
  seam dropped to 0.63x a normal step (within ordinary waveform motion).
  <br><br>
  `src/game/audio/soundManifest.ts` is the contract (mirrors
  `spriteFrames.ts`'s role): which keys exist and each one's mix volume.
  Ambience is asserted quieter than every SFX by test, so "subtle" holds by
  construction and can't silently drift louder in a later tune. Wired into
  `CombatScene`: SFX fire from the same event sites hitstop/shake already
  use, each with a small random detune so repeated hits don't sound
  machine-gunned; ambience respects the browser's autoplay gesture-lock,
  fades in over 2.5s once unlocked, and fades out when the fight ends; an M
  key mutes everything (no settings UI yet, same gap already noted for
  screenshake).
  <br><br>
  191 unit tests (up from 167), including the loop-seam regression test and
  the quieter-than-every-SFX assertion. Verified programmatically — every
  file confirmed non-silent, non-clipping, and reachable over HTTP from a
  running dev server — but not by ear. **I cannot hear audio.** Whether the
  actual sound design lands is a real playtest question, same open item as
  the visual pass's feel-checks.

## Review (end of sprint)

**Goal met.** The fight is no longer coloured rectangles. A knight with a real
sword fights a visibly larger, horned Margit in a moonlit Stormveil arena, and
every combat state the engine already tracked — tell, active window, recovery,
stagger, posture break, death — now reads as a distinct pose. Epic #42 closed
with all three committed parts merged.

Delivered (committed scope):
- **#42 part 1** (#46) — a dependency-free pixel toolkit and generator
  (`scripts/lib/pixel.mjs`, `scripts/generate-sprites.mjs`) producing the player
  sheet, Margit's sheet, slash VFX and four parallax layers. CombatScene swapped
  from rectangles to sprites, with every frame selected from state the sim
  already exposes and slash VFX fired off the sim's own `attack:active` event so
  they cannot drift from the hitbox.
- **#42 part 2a** (#49) — a distinct tell and active pose for all eight of
  Margit's moves, keyed by `MoveDef.id`, so the L3 AI's real move variety is
  visible instead of every move sharing one windup and one swing.
- **#42 part 2b** (#50) — hitstop weighted by hit severity, and a two-beat death
  sequence at zero new art cost. Both are timed off wall-clock rather than ticks,
  so no fairness invariant (F1-F8) changes meaning.

Delivered (unplanned, taken on mid-sprint):
- **#48** — the PRESSURE/RECOVER feedback-loop fix. See the breach note below.
- **#51** (#52) — ten generated combat SFX and a 32-second ambient loop, with
  `soundManifest.ts` as the contract and ambience asserted quieter than every
  SFX by test.
- **#47**, **#53** — the project status presentation and the full UML diagram
  set. Course deliverables, not product scope.

191 unit tests, up from 147 at sprint start. Full gate green on every merge.

**The Definition of Done was breached, deliberately.** This sprint's DoD opened
with *"No combat-logic change: `playerCombat.ts` / `bossCombat.ts` / the frame
data untouched."* #48 changed `bossCombat.ts`, `tactics.ts`, `actionSelection.ts`
and `margitMoves.ts`. That was the right call — the playtest note driving it
("Margit is attacking constantly and not giving me a single chance") described a
fight that was not playable, and shipping a beautiful unplayable fight would have
been the worse outcome. But it is recorded here as a breach rather than quietly
absorbed. The constraint existed to stop an art sprint from turning into a
balance sprint, and three days in, it half did. `playerCombat.ts` and the frame
data did survive untouched, so the blast radius stayed on the boss side.

Not in scope / deferred: **#13** (post-death LLM recap — now the *last* unshipped
line in PRD §6's MVP list), #14 (bot harness), #20 (input buffering), the settings
surface that both the screenshake toggle and the audio mute still need, and the
remaining three regions' backdrops.

Backlog correction made at close-out: **#40** (sorcery) was verified complete and
closed — its Sprint 6 checkbox was simply never ticked. **#12** (stat spend) was
*not* closed: its code shipped in Sprint 6, but its final acceptance criterion, a
`docs/playtests/` note proving all three archetypes clear Margit, remains unmet.
See the retro.

## Retro (end of sprint)

**What worked**

- **Playtest feedback found three real bugs that no test and no static review
  would have caught — and all three were the same class.** Margit striking the
  ground instead of the player, her hit landing from further away than her cane
  reached, and the boss never letting up were each a *mismatch between what the
  sim computes and what the screen shows*. Every one was invisible while
  reviewing sprite sheets in isolation and obvious the moment the sprite was
  composited against a player standing at the move's true range. This is now the
  documented default for any future art work: **review poses against the hitbox,
  never on their own.**
- **The generalised fix beat the per-case fix.** The reach mismatch spanned eight
  moves from 80px to 260px. Drawing a bespoke pose per move would have fixed the
  eight that exist and silently broken the ninth; stretching the strike streak to
  `move.rangeBand[1]` — the same number `resolveBossAttackOnPlayer` tests against
  — makes visual reach equal hit reach for every move automatically, including
  ones added later. Guarded by a test that fails if any move outgrows the streak.
- **#48's first hypothesis was wrong, and tracing rather than guessing caught
  that.** The initial theory was that #9's tactic layer had never been wired up.
  L2 was fully implemented and `RECOVER` already did exactly the right thing. The
  actual cause — PRESSURE scoring higher the *less* the player attacked, so being
  suppressed made the boss press harder — would have been missed entirely by
  fixing the thing that looked broken.
- **#48 turned out to be code diverging from its own spec.** BOSS_AI.md §5's
  signal table already said `aggression` drives RECOVER and `turtleIndex` drives
  PRESSURE. The fix moved the term to where the spec had always put it. Worth
  checking the spec *first* next time a tuning value feels wrong.
- **Tuning by measurement, not by feel.** The first attempt at #48 overcorrected
  and handed RECOVER 75% of the fight — trading "never lets up" for "barely
  fights". The final bands (~30% RECOVER when smothered, ~7% when the player is
  landing hits, ~90% PRESSURE against a turtler) are asserted *with ceilings*, so
  both failure modes fail CI rather than only the one that was noticed.

**What didn't**

- **Scope discipline.** The sprint committed to three art items and shipped
  seven things. #48 was genuinely urgent and #47/#53 were externally driven
  course deliverables, but #51 (audio) was a whole extra discipline picked up
  voluntarily, in a sprint whose own "Out of scope (explicitly)" section listed
  *"Audio. Not mentioned in #42 and a separate discipline."* Nothing was dropped
  to make room, which means the estimate was never tested.
- **Verification debt is compounding, and it is now blocking a real acceptance
  criterion.** Two of this sprint's deliverables shipped without being checked
  against their actual quality bar: the audio was verified as non-silent,
  non-clipping and reachable over HTTP, but nobody has *heard* it; the visual
  feel-check still needs a signed-in in-engine session that has not happened.
  This is the same blocker Sprint 6 closed on, and it has not moved — **#12's
  last acceptance criterion, a `docs/playtests/` note proving dex/vit/int all
  clear Margit, is still unmet, and that directory still does not exist.** That
  issue therefore stays open at the end of Sprint 7 despite its code being
  complete since Sprint 6. PRD §5's S2 and S3 have the same shape and the same
  blocker. None of it can be discharged from inside the repo, and it is now
  three sprints deep.
- **This retro is being written a day late, and Sprint 6's is still empty.** Two
  consecutive sprints closed without their review written at the time. The daily
  check-ins are excellent and did most of the remembering here — but they are a
  log, not a retrospective, and the DoD breach above went unremarked for a week
  because nobody stopped to re-read the DoD.

**Actions into Sprint 8**

1. Backfill Sprint 6's review/retro, or explicitly mark it closed-without-retro.
   Leaving `_(pending)_` in the repo is the worst of both.
2. Book five playtesters before Sprint 8's midpoint, and create `docs/playtests/`
   with the dex/vit/int note that closes #12. S2 and S3 are the only two success
   criteria that cannot be satisfied by writing code, #12 has been waiting on
   exactly this since Sprint 6, and #13 lands straight into S3.
3. Re-read the DoD at each merge, not only when writing it.
4. Give the settings surface a ticket. It has now been deferred twice (screenshake
   in #42, mute in #51) and both features currently ship as undiscoverable
   keypresses.
