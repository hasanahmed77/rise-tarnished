# Detailed Use Case Description — Fight the Adaptive Boss

> Chosen as the one detailed description because it's the only use case in
> the system with real alternate flows, a real failure path, and real
> business rules (the F1–F8 fairness invariants) — every other use case is
> either infrastructure (auth) or a single RPC call. Traced to:
> `src/game/scenes/CombatScene.ts`, `src/game/combat/playerCombat.ts`,
> `src/game/boss/bossCombat.ts`, `src/game/attempt/outcome.ts`,
> `docs/design/COMBAT_SYSTEM.md`, `docs/design/BOSS_AI.md`.

| Field | Detail |
|---|---|
| **Use Case ID** | UC-05 |
| **Use Case Name** | Fight the Adaptive Boss |
| **Primary Actor** | Player |
| **Secondary Actors** | None (fully client-side simulation; no network call during the fight itself) |
| **Level** | User goal |
| **Stakeholders and interests** | **Player** — wants a fair, readable, genuinely adaptive fight, and to walk away with runes on a win. **System** — wants the fight to stay deterministic and provably fair (F1–F8) regardless of how the AI adapts. |

## Preconditions

1. Player is signed in and has landed on `/play`.
2. `CombatScene.create()` has finished static setup and emitted `game:ready`.
3. `PlayShell` has resolved a `PlayerBuild` (via `CharacterSheet`, reading
   `player_stats`) and emitted `fight:start` — `CombatScene.startFight()`
   has run, so `sim`, `boss`, `ctx`, and `bossCtx` all exist
   (`this.ready === true`).

## Postconditions

**Success (victory)**

- `determineFightOutcome(boss.hp, sim.hp)` returns `'victory'`
  (`boss.hp <= 0`, `sim.hp > 0`).
- `CombatScene.finished` is set `true`; the sim loop stops permanently.
- `fight:outcome` is emitted on the bridge with `result: 'victory'` and an
  *optimistic* `estimatedRuneDelta` (not yet the authoritative amount).
- Use case **Resolve Attempt** (`«include»`d by View Fight Outcome) then
  persists the real reward via `resolve_attempt`.

**Failure (death)**

- `determineFightOutcome` returns `'death'` (`sim.hp <= 0`).
- Same `fight:outcome` event, `result: 'death'`,
  `estimatedRuneDelta` computed as 0 by `computeRuneReward` — death pays
  nothing, by design (issue #11's acceptance criterion, enforced again
  server-side in `resolve_attempt`, never trusted from the client).

## Trigger

The `fight:start` bridge event, fired once `PlayShell` has a resolved
`PlayerBuild` in hand.

## Main Success Scenario

1. Every real-time frame, `CombatScene.update(delta)` accumulates elapsed
   time and consumes it in whole 60Hz ticks (fixed-timestep simulation —
   determinism depends on this).
2. Each tick, the scene samples keyboard input into a `CombatInput`
   (edge-triggered flags for light/heavy/dodge/cast; held for
   move/block).
3. `playerCombat.step(sim, input, ctx)` advances the player's state
   machine one tick: free movement while idle, or the current committed
   action's `startup → active → recovery` phase progression.
4. Simultaneously, `bossCombat.step(boss, bossCtx)` advances the boss:
   the L2 tactic machine re-scores intent on its own cadence (2–5s hold,
   softmax-weighted); L3 selects or continues a move from the current
   phase's table, filtered by range, cooldown, and fairness rules
   (F3/F7/F8), weighted by the active tactic and the rolling player-
   behavior signals.
5. When either combatant's action reaches its `active` phase and the two
   are in range and facing each other, the scene resolves the hit: damage
   via the §6 stat-scaling formula, poise/posture accumulation, and
   (player→boss only) a chance at hitting during the boss's posture-broken
   critical window for bonus damage.
6. The scene renders the result — sprite pose from state, HUD bars,
   hitstop/screenshake/SFX weighted by hit severity — every frame.
7. Steps 1–6 repeat until `determineFightOutcome` returns non-null.
8. On a terminal result, `reportOutcome()` fires the death SFX, fades the
   ambience, sets `finished = true`, and emits `fight:outcome` — handing
   off to **View Fight Outcome**.

## Alternate Flows

- **A1 — Player dodges.** During a dodge's `active` phase the player is
  fully invulnerable (i-frames); dexterity extends the window
  (`dodgeIframes`). A well-timed roll through an attack beats retreating
  from it — the core defensive verb.
- **A2 — Player blocks.** Held stance; incoming damage reduced 70%, but
  stamina drains per blocked hit. Emptying the stamina bar while blocking
  triggers a **guard break** — a long, fully-vulnerable stagger.
- **A3 — Player casts sorcery.** Only reachable with FP available
  (`FRAME_DATA.cast.fp`); a slow, hard-committed action that spawns a
  deterministic projectile in the pure sim. The scene's `spawnSlash`-style
  strike streak is stretched to match the projectile's real reach — the
  visual never claims more range than the hitbox has.
- **A4 — Boss's `PUNISH` tactic pre-empts.** If the player is caught
  mid-recovery on a whiffed heavy within range, `PUNISH` interrupts the
  current tactic's *decision* immediately (never an in-flight boss
  animation), rate-limited to once per 4 seconds (F5).
- **A5 — Boss's `RECOVER` tactic engages.** When active, the boss skips
  move-selection entirely for that tick and only repositions — the
  mechanism `PR #48` added so a smothered player gets real relief instead
  of facing escalating pressure.
- **A6 — Boss posture breaks.** Sustained pressure fills the posture meter
  to its cap; the boss collapses for a 90-tick critical window where a
  landed hit deals bonus (multiplied) damage, then the meter resets.

## Exception Flows

- **E1 — Player HP reaches 0 mid-recovery of a boss move.** The tick order
  resolves both entities' actions before checking the terminal condition,
  so a mutual near-simultaneous exchange still produces exactly one
  outcome, never a double-report (`finished` gates further ticks the
  instant it's set).
- **E2 — Tab backgrounded / frame stall.** The fixed-timestep accumulator
  is capped at 5 ticks' worth of catch-up per frame, so a long stall can't
  trigger a runaway burst of simulated time.

## Business Rules (fairness invariants, `docs/design/BOSS_AI.md` §6)

| # | Rule | Enforced by |
|---|---|---|
| F1 | Every move's tell ≥ 18 ticks — nothing is unreactable | `moveSchema.ts` data-level test on every authored move |
| F2 | ≥ 30-tick gap between boss attack *sequences* (tuned to 45, never below the floor) | `MIN_INTER_SEQUENCE_GAP_TICKS` / `INTER_SEQUENCE_GAP_TICKS` |
| F3 | Combo chains hard-capped at `maxChain` | Enforced by construction in `selectComboBranch` |
| F5 | `PUNISH` rate-limited to 1 per 4s | `PUNISH_COOLDOWN_TICKS` in `tactics.ts` |
| F7 | Grab moves never combo-chain, always have the longest tells | Authored data property, schema-validated |
| F8 | Same move never selected 3× consecutively | `wouldViolateF8` in `actionSelection.ts` |

## Frequency of Use

Once per attempt; an attempt may be retried immediately after a death or a
victory (both loop back through the character sheet to a fresh
`fight:start`).
