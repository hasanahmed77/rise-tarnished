# Sprint 6 — Builds That Matter

- **Dates:** 2026-07-22 → 2026-07-29 (1 week)
- **Sprint goal:** *A player spends earned runes on stats between fights, and
  the next attempt plays measurably differently — a dex duelist, a vit
  bruiser, and an int caster are three real ways to fight Margit, each
  clearable. The runes Sprint 5 made real now buy something that changes the
  fight.*

## Why this goal

Sprint 5 closed the earn half of the loop: win → runes → persisted. This
sprint closes the spend half — the last structural piece of the PRD's MVP
loop ("sign in → fight → win/lose → runes → **spend → re-fight differently**").
After this, every MVP mechanic exists; what remains (#13 LLM recap) is
enrichment, not a new pillar.

But "spend on stats" only means something if stats actually change combat,
and today they barely do: weapon damage is a flat constant (`ATTACK_DAMAGE`),
vitality only feeds poise, dexterity only feeds dodge i-frames, and
**intelligence does nothing at all** — its §6 role is "+sorcery scaling" and
no sorcery exists. So this sprint is deliberately larger than a "character
sheet UI" ticket sounds: it has to (a) build the damage/derived-stat scaling
§6 has only ever specified on paper, (b) give intelligence a real combat
mechanic so the int-caster archetype is more than a label, and (c) wire the
player's *actual* saved stats into the fight, retiring the hardcoded
`{ vitality: 10, dexterity: 10, intelligence: 10 }` the scene has used since
Sprint 1.

Per the same ADR-0003 rule that shaped Sprint 5: stats are client-read-only,
so spending is a **SECURITY DEFINER RPC** that validates the transaction
server-side (enough runes, atomic deduct-and-increment) — the client can no
more grant itself a stat point than it could grant itself runes.

## Committed scope

- [x] **#40** Minimal sorcery attack (makes int a real archetype) — size L, p1
      *An FP resource (max from intelligence), one castable ranged sorcery
      with cast commitment + FP cost + int-scaled damage, all in the
      Phaser-free sim layer and deterministic under the fixed-timestep/seeded
      engine (fairness tests still hold). Unit-tested headless.*
- [~] **#12** Stat spend → next-attempt scaling — size XL, p1
      *(Code delivered; the DoD's playtest note was not. See Review.)*
      *Character-sheet UI to spend runes on vitality/dexterity/intelligence;
      spend persists via a server-validated RPC and loads at the start of the
      next attempt; the §6 softcap damage/derived-stat formula implemented as
      a pure, unit-tested function and actually wired into combat; a playtest
      note confirms all three archetypes (dex/vit/int) can clear Margit.*

Sequenced #40 → #12: the scaling formula and the sorcery mechanic are the
foundation the spend loop makes meaningful, and int isn't a real archetype
to playtest until the spell exists.

## Definition of Done (per issue, from SDLC §7)

- The §6 damage/derived-stat math (softcap curve, weapon damage, max HP/FP/
  stamina from stats) is a pure function in the logic layer, unit-tested —
  no Phaser, no Supabase (CLAUDE.md: keep game logic engine-agnostic).
- Stat spend goes through a SECURITY DEFINER RPC, never a client write to
  `player_stats` (ADR-0003). Proven by a real cross-user/atomicity test in
  the RLS suite: a user can't spend runes they don't have, can't overspend
  via a double call, and can only spend their own.
- The fight loads the player's real persisted build (the `fight:start` bridge
  event, defined since Sprint 1 and never yet emitted, finally carries it) —
  the hardcoded sandbox build is gone.
- Sorcery/FP logic is deterministic under the seeded fixed-timestep loop; the
  existing `fairness.property.test.ts` still passes unchanged.
- Playtest logged in `docs/playtests/`: dex/vit/int each clear Margit
  (the §6 testable design constraint). Combat feel is subjective — this is a
  manual playtest note, not an automated assertion.
- Docs updated in the same PR: COMBAT_SYSTEM.md §6 reflects the *actual*
  shipped curves/costs (not just the original targets), BOSS_AI.md noted if
  ranged play exposes an AI gap, ADR-0003's RPC-convention list extended if
  the spend RPC needs a pattern not already captured.
- CI green; `/code-review` before merge on both PRs (real combat-sim + a new
  privileged RPC — exactly the surface prior reviews found live bugs in).

## Out of scope (explicitly)

- Weapon variety / build-defining loot (PRD "Later") — one starting weapon,
  stats scale it.
- Respec / multiple saved builds — the schema is multi-row (`player_builds`)
  but the UI commits to one active build; respec is a later affordance.
- A spell catalog — exactly one sorcery (#40's own scope cut).
- LLM post-death recap (#13) — the last MVP item, next sprint.
- Boss-AI rework for ranged players beyond the existing `rangeCamping`
  signal — flag gaps in the playtest, don't fix them here.

## Risks / watch-fors

- **This is the biggest sprint yet, and knowingly so.** It bundles a new
  combat mechanic (sorcery), the scaling math, the spend spine, and a UI. If
  #40 balloons, it is the natural split point — shipping #12's melee-only
  scaling + spend (dex/vit archetypes provable) and slipping the int-caster
  playtest to a follow-up is an acceptable fallback, not a failure. Decide
  that early if the spell fights back, don't discover it at day 6.
- **"All three clear Margit" is a balance problem, not just an implementation
  one.** §6's numbers are explicitly "tuning targets, not architecture."
  Expect the damage/HP/FP curves to need iteration against an *adaptive*
  boss — a fragile caster and a tanky bruiser being simultaneously viable is
  a tuning outcome, reached by playtesting, not a formula that's just correct
  on the first write.
- **The projectile must stay deterministic.** It enters the same
  fixed-timestep, seeded-RNG sim the fairness property tests depend on —
  travel and hit detection live in the pure layer, the scene only paints it.
  A `Math.random()` or a wall-clock timer in the sorcery path silently breaks
  replay determinism and the fairness suite.
- **The adaptive AI has never faced a real ranged player.** Sprint 3's
  `rangeCamping` signal anticipates it, but a spacing caster may still expose
  behavior gaps (e.g. Margit never closing distance). In scope to *observe*
  and note; out of scope to *fix* this sprint.

## Daily check-ins
- **07-22:** #40 built — the sorcery mechanic that makes int a real archetype.
  Added the shared §6 scaling module (`scaling.ts`: `softcap`/`scaledDamage`,
  pure + unit-tested — the foundation #12 reuses), an FP resource (max scales
  with int, regen mirrors stamina), and a committed `cast` action that emits a
  deterministic projectile in the pure sim (travel/lifetime in `step`,
  cross-entity hit resolution in the scene via a pure `projectileHits`
  predicate, matching how melee already works). The fairness property suite
  passes unchanged — confirming the projectile additions kept the sim
  deterministic. Wired into CombatScene: L to cast, an FP bar, projectile
  rendering, cast color. Verified in-browser against real Postgres: FP scaled
  correctly (70 at int 10), a cast committed the player and spent exactly 35
  FP, and the bolt spawned/travelled/hit Margit for ~19 int-scaled damage +12
  posture (boss HP 400→381) — the full loop, confirmed by the live numbers
  (the automation pane throttles the game loop, so ticks were pumped manually
  via a temporary hook, since reverted). 140 unit tests (up from 120), full
  gate green.
- **07-22 (later):** #43 review fixes landed and merged — the facing gate on
  projectile hits, `fightStarted`/boss-aggression tracking counting `cast`,
  and the doc's projectile-range math (6×90≠"~9 world-units", fixed to the
  correct ~540). No new bugs from #40 shipped forward into #12.
- **08-02:** #12 built — stat spend → next-attempt scaling, closing Sprint
  6's goal. `spend_stat_point` (new SECURITY DEFINER RPC, ADR-0003-compliant:
  a single atomic conditional UPDATE, no idempotency key needed since it's
  repeatable, not terminal — see the ADR's new bullet) lets a player trade
  100 runes for one point of vitality/dexterity/intelligence. The §6 damage
  formula now drives melee (`meleeDamage`, dex-scaled, mirroring #40's
  `sorceryDamage`), and vitality finally does something: `maxHp`/`maxStamina`
  use the same softcap curve stat-scaled damage does, linear below the cap
  (exactly matching the old flat +6/+2 rate) and softened above it. The
  hardcoded sandbox build is gone — `fight:start` (defined since Sprint 1,
  never emitted until now) finally carries the player's real persisted
  build: a new character-sheet screen (`CharacterSheet.tsx`, gating
  `GameCanvas` behind `PlayShell`) reads `player_stats`, lets the player
  spend before each attempt, then hands that build to the fight. Caught and
  fixed two bugs along the way: an ambiguous-column-reference error in the
  RPC's first draft (the OUT parameters shared names with the columns they
  read/wrote — fixed by qualifying every column reference), and a
  createPlayerState/regen-cap build mismatch that #40's review had flagged
  as latent-but-unreachable — now that stamina regen is vitality-scaled it
  was reachable in tests, so fixed there rather than left as a known gap.
  25 RLS/RPC tests (up from 18, all passing against real local Postgres) and
  147 unit tests (up from 140). Full gate green (typecheck/lint/test/build).
  **Not yet done:** a live playtest confirming all three archetypes (dex/
  vit/int) can clear Margit — the DoD's `docs/playtests/` note. Blocked on
  a real Google sign-in to drive the authenticated `/play` flow, which
  automation can't complete; this is the sprint's one remaining open item.
- **08-03:** #12 follow-up, before merge — a design pass on PR #45 surfaced
  five things worth fixing pre-merge rather than tuning later: the flat
  100-rune cost never rose no matter how deep a player went into one stat
  (fixed: cost now rises `+25` per point already bought, `SELECT … FOR
  UPDATE` locks the row so the now-state-dependent cost stays race-safe —
  new ADR-0003 bullet on locking when cost depends on the row being
  written); no stat had a real ceiling (fixed: hard cap of 60, above all
  three §6 soft caps); the character sheet showed on every single retry
  even with nothing affordable (fixed: `CharacterSheet` now checks
  affordability on load and calls straight through to `onBegin` when
  there's nothing to buy); a single click spent runes with no confirmation
  or undo (fixed: click-to-arm, click-again-to-confirm, with a 4s
  auto-disarm and a live preview of the resulting stat value); and melee's
  dex-scaling coefficients (0.8 light / 1.0 heavy) are still an unverified
  guess — noted, not fixed, since only a real playtest can tell if they're
  right. 27 RLS/RPC tests (up from 25, two new: cost escalation across
  repeated purchases, hard-cap rejection). Full gate green.

## Review (end of sprint)

> Written retrospectively on 2026-08-11, from the daily check-ins and the git
> history, as part of the Sprint 7 close-out. It was not written at the time —
> that omission is itself one of the retro's findings, and this note is here so
> a reader weights the review accordingly.

**Goal met in code, not in evidence.** The spend half of the loop is real: a
player earns runes, spends them on vitality/dexterity/intelligence through a
server-validated RPC, and the next attempt loads that build and plays
differently. Every mechanic in PRD §6's MVP list except the LLM recap (#13) now
exists. What the sprint did *not* produce is the proof that its own goal
sentence demanded — "three real ways to fight Margit, **each clearable**" was
never demonstrated.

Delivered:
- **#40** (#43) — the sorcery mechanic that makes intelligence a real archetype.
  A shared §6 scaling module (`scaling.ts`: `softcap` / `scaledDamage`, pure and
  unit-tested), an FP resource whose max scales with int and whose regen mirrors
  stamina, and a committed `cast` action emitting a deterministic projectile in
  the pure sim. `fairness.property.test.ts` passed unchanged, confirming the
  projectile did not break replay determinism — the sprint's stated third risk,
  retired properly. 140 unit tests, up from 120.
- **#12** (#45) — the spend spine. `spend_stat_point` as a SECURITY DEFINER RPC
  (a single atomic conditional UPDATE; no idempotency key, since it is repeatable
  rather than terminal — captured as a new ADR-0003 bullet), melee damage moved
  onto the §6 curve via `meleeDamage`, and vitality finally doing something
  through `maxHp` / `maxStamina` on the same softcap. The hardcoded
  `{ vitality: 10, dexterity: 10, intelligence: 10 }` sandbox build that the
  scene had carried since Sprint 1 is gone — `fight:start`, defined in Sprint 1
  and never once emitted, finally carries the player's real persisted build via
  the new `CharacterSheet` screen. 27 RLS/RPC tests (up from 18) and 147 unit
  tests (up from 140), all green against real local Postgres.
- **A pre-merge design pass on #45** that fixed five things rather than deferring
  them to "tuning later": the flat 100-rune cost that never rose (now +25 per
  point already bought, with `SELECT … FOR UPDATE` locking the row since the cost
  became state-dependent — another new ADR-0003 bullet), no stat ceiling (hard
  cap 60, above all three §6 soft caps), the character sheet interrupting every
  retry even with nothing affordable (now checks affordability and calls straight
  through to `onBegin`), and a single click irreversibly spending runes (now
  click-to-arm, click-again-to-confirm, 4s auto-disarm, live preview).
- **PR #44**, unplanned — a one-line README fix for a missing `.env.local` setup
  step.

**Not delivered: the playtest note.** The DoD required a `docs/playtests/` entry
showing dex, vit and int each clear Margit — the §6 testable design constraint.
It was blocked on a real Google sign-in to drive the authenticated `/play` flow,
which automation cannot complete, and it was never unblocked. As of the Sprint 7
close-out that directory still does not exist, which is why **#12 remains open**
while #40 was closed. Two consequences follow from it: melee's dex-scaling
coefficients (0.8 light / 1.0 heavy) are still an unverified guess, flagged
honestly at the time and still unverified; and the fourth risk — that a spacing
caster might expose AI gaps, which this sprint was meant to *observe* — was never
observed either way.

**The sprint overran by five days and nobody said so.** Planned 07-22 → 07-29.
#40 was built on 07-22, then the repository went quiet for ten days (the only
activity between 07-23 and 08-01 was PR #44's README line), and #12 landed
08-02 with its design pass on 08-03. Sprint 7's plan merged on 08-03 as well —
the same day Sprint 6's final PR did.

## Retro (end of sprint)

**What worked**

- **Sequencing #40 before #12 paid for itself.** The plan's stated reason was
  that int is not a real archetype to playtest until the spell exists. The
  larger benefit turned out to be structural: `scaling.ts` was written once for
  `sorceryDamage`, then reused unchanged for `meleeDamage`, `maxHp` and
  `maxStamina`. Building the general curve first because a *specific* feature
  needed it produced the shared module for free.
- **Review kept finding live bugs, for the fourth sprint running.** #40's review
  caught a missing facing gate on projectile hits (a bolt could connect
  backwards) and `fightStarted` / boss-aggression tracking not counting `cast`
  at all — meaning the adaptive AI would have read a pure caster as a completely
  passive player. Both are exactly the class of defect that passes every test
  because the tests encode the same blind spot.
- **A latent bug was fixed at the moment it became reachable, not filed.** #40's
  review flagged a `createPlayerState`/regen-cap build mismatch as real but
  unreachable. Once #12 made stamina regen vitality-scaled it became reachable,
  and it was fixed then rather than carried as a known gap. Knowing *why* a
  deferred bug was safe is what let it be caught the moment that reason expired.
- **The design pass on #45 was worth more than the code review.** Five findings,
  none of them correctness bugs — an economy with no cost curve, no ceiling, an
  interruption on every retry, and an irreversible one-click spend. Every one
  would have shipped as "tuning later" and been felt by a player first. Design
  passes on player-facing surfaces are a distinct review channel from code
  review, and this sprint is the evidence.
- **The unverified dex coefficients were labelled, not hidden.** "0.8 light /
  1.0 heavy is still a guess" was written down at the time rather than presented
  as tuned. That honesty is why it is still trackable now.

**What didn't**

- **The sprint had no end.** It overran 07-29 by five days, and there is no
  record of anyone noticing — no re-plan, no scope cut, no note. Sprint 7's plan
  merged the same day Sprint 6's last PR did, so Sprint 6 was never closed; it
  was simply overtaken. That is the direct cause of this review being written
  thirteen days late.
- **Ten days of silence in the middle of a one-week sprint.** 07-23 → 08-01 has
  no commits beyond a README line. Whatever the reason, a week-long sprint that
  goes quiet for ten days has stopped being a week-long sprint, and the plan was
  never amended to say so.
- **The DoD's one human requirement was dropped without escalation.** The
  playtest note was correctly identified as blocked on 08-02 and written into the
  check-in — and then nothing happened. A blocker that only the human on the
  project can clear needs to be raised *to* them as a decision, not logged in a
  file and left. Three sprints later it is still open and now blocks PRD §5's S2
  and S3 as well.
- **The risk register was never retired.** Four risks were logged. One
  (determinism) was properly discharged by the fairness suite. The other three —
  the sprint being oversized, "all three clear Margit" being a balance problem,
  and the AI never having faced a ranged player — were all answerable only by the
  playtest that never happened. A risk list where three quarters of the entries
  depend on a single unscheduled activity is a plan with one point of failure.
- **Neither committed checkbox was ever ticked**, so the backlog silently lied
  for a month: #40 was complete on 08-02 and stayed open until 08-11, and #12
  looked identically incomplete despite being in a totally different state.
  Ticking boxes is not bookkeeping; it is what makes "what is left?" answerable.

**Actions**

These were folded into Sprint 7's close-out rather than tracked separately, since
Sprint 6's were never written while they could still change Sprint 7:

1. Book five playtesters and create `docs/playtests/` — closes #12 and unblocks
   S2 and S3. This is the single highest-value unstarted item on the project.
2. Write the review and retro *before* the next sprint's plan merges. Sprint 7
   repeated this failure and is being closed late for the same reason.
3. Escalate human-only blockers as decisions, not check-in lines.
4. Tick the boxes.
