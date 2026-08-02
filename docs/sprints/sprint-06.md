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

- [ ] **#40** Minimal sorcery attack (makes int a real archetype) — size L, p1
      *An FP resource (max from intelligence), one castable ranged sorcery
      with cast commitment + FP cost + int-scaled damage, all in the
      Phaser-free sim layer and deterministic under the fixed-timestep/seeded
      engine (fairness tests still hold). Unit-tested headless.*
- [ ] **#12** Stat spend → next-attempt scaling — size XL, p1
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
_(pending)_

## Retro (end of sprint)
_(pending)_
