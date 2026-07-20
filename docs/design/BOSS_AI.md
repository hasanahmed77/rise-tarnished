# Boss AI Design — Hierarchical Behavior-Weighted FSM

> Status: v1 draft · Implements ADR-0002 · Companion: `COMBAT_SYSTEM.md`.
> This is the technical spec for the adaptive boss brain. It is deliberately
> concrete: layer responsibilities, data schemas, weighting math, and fairness
> constraints are commitments; individual numbers are tuning values.

## 1. Why hierarchical (not a flat FSM)

A flat FSM (`Idle → Approach → Attack → Recover`) cannot express what makes a
souls-like boss read as intelligent: *sustained intent*. Margit doesn't pick
random attacks — he **pressures** you when you heal, **baits** your roll when
you dodge on reflex, and **resets to neutral** when his stamina is spent. That
requires separating *what the boss wants* from *what the boss does*.

Three layers, each an FSM, each running at a different cadence:

```
┌────────────────────────────────────────────────────────────────┐
│ L1 · PHASE          changes ~once per fight (HP thresholds)    │
│   Phase1 → Phase2 (→ Phase3 for finale)                        │
│   Selects: moveset table, stat multipliers, arena triggers     │
├────────────────────────────────────────────────────────────────┤
│ L2 · TACTIC         changes every 2–8 seconds                  │
│   NEUTRAL · PRESSURE · BAIT · PUNISH · REPOSITION · RECOVER    │
│   Selects: which *category* of action to prefer, target range  │
│   ← this is where behavior weighting primarily acts            │
├────────────────────────────────────────────────────────────────┤
│ L3 · ACTION         changes every 0.3–2 seconds                │
│   Concrete moves from the phase's move table, filtered by      │
│   tactic + range band + cooldowns, selected by weighted RNG    │
│   Executes: startup/active/recovery frames, combo branching    │
└────────────────────────────────────────────────────────────────┘
```

All three are pure TS state machines (no Phaser imports), stepped by the
simulation clock, seeded-RNG driven, unit-testable per layer (ADR-0001/0002).

## 2. L1 — Phase machine

Data-driven per boss:

```ts
interface PhaseDef {
  id: string;                  // "phase1", "phase2"
  entryHpFraction: number;     // e.g. 0.55 → enters below 55% HP
  entryCinematicMove?: MoveId; // the phase-transition spectacle (uninterruptible, 0 damage during player knockdown grace)
  moveTable: MoveId[];         // moves legal in this phase
  statMods: { damage: number; speed: number; posture: number };
  arenaTriggers?: ArenaEventId[]; // e.g. Elden Beast arena shift
}
```

Phase transitions are one-way, fire exactly once, and grant the player a
**45f grace window** (no damage) so a phase change never converts to an
unreactable kill. Fairness rule F6, §6.

## 3. L2 — Tactic machine (the "intent" layer)

Six tactics, shared across all bosses (per-boss flavor comes from which
*moves* express them):

| Tactic | Intent | Enter when (examples) | Exit when |
|--------|--------|----------------------|-----------|
| **NEUTRAL** | Observe, walk, keep mid-range | default; after any tactic completes | tactic timer (2–5s) or trigger |
| **PRESSURE** | Close distance, chain aggression, deny stamina regen | player passive/turtling signal high; player low stamina | boss stamina spent; player creates distance |
| **BAIT** | Delayed/feint attacks that punish reflex-dodging | dodge-spam signal high | bait resolved (hit or whiffed) |
| **PUNISH** | Immediate hard response to a committed player action | player heals, casts, or whiffs a heavy in punish range | punish move completes |
| **REPOSITION** | Break line, sidestep, jump back, reset spacing | player corners boss; ranged-spam signal high → close the gap | reached target range band |
| **RECOVER** | Overextended: back off, guard, low aggression | boss poise low / posture nearly broken; long combo just ended | poise/pace recovered (1.5–3s) |

**PUNISH has trigger priority** — it interrupts any other tactic's *decision*
(never an in-flight animation) when its conditions fire. This is what makes
healing in a boss's face feel correctly lethal.

Tactic selection = weighted choice over eligible tactics:

```
score(tactic) = base(tactic, phase)
              × behaviorMod(tactic, signals)     // §5 — the adaptation
              × Π fairness caps                  // §6
select via softmax(score, temperature) with seeded RNG
```

## 4. L3 — Action machine & move data

Moves are **data, not code** (ADR-0002 follow-up, resolved here). One schema
for all bosses:

```ts
interface MoveDef {
  id: string;                        // "margit.delayed_overhead"
  tags: MoveTag[];                   // delayed | grab | aoe | projectile | sweep | combo_starter ...
  tactics: Tactic[];                 // which intents this move can express
  rangeBand: [min, max];             // eligible distance (world units)
  frames: { startup: number; active: number; recovery: number };
  tellFrames: number;                // readable windup ≥ F1 minimum
  damage: number; poiseDamage: number; postureSelfRisk: number;
  staminaCost: number;
  combo?: {                          // branching combos — the souls-like feel
    next: { move: MoveId; weight: number; condition?: ComboCond }[];
    maxChain: number;                // fairness cap F3
  };
  punishes?: PlayerAction[];         // what this move exists to counter (drives the adaptation + post-death recap)
  cooldownTicks: number;
}
```

**Combo branching** is what kills flat-FSM sterility: `cane_swing_1` may branch
to `cane_swing_2` (weight 0.6), `delayed_overhead` (0.3, condition: player
rolled during swing 1), or end (0.1). Branch weights are also behavior-weighted
— a player who always rolls after swing 2 will start eating the swing-3 branch.

**Action selection pipeline (every decision point):**

```
eligible = phase.moveTable
         ∩ moves matching current tactic
         ∩ moves whose rangeBand contains current distance
         ∩ moves off cooldown
         ∩ fairness-filter (§6)
weights  = base × behaviorMod × comboContext
pick via seeded weighted RNG → execute frames → on recovery end, next decision
if eligible = ∅ → fallback: REPOSITION toward nearest eligible range band
```

**Implementation status:** L3 shipped in full with #8 (Sprint 2); the two
deferred terms — `moves matching current tactic` and `behaviorMod` — went live
with #9 (Sprint 3). The tactic filter intersects the eligible set with moves
expressing the current L2 intent, falling back to the un-filtered eligible set
when the intersection is empty (the §4 fallback rule). `behaviorMod` weights
top-level picks from the rolling signals via per-boss data rules
(`src/game/boss/weighting.ts`), F4-clamped. Combo-link weights remain
authored-only for now — extending behaviorMod to branch weights is open
tuning work, not structure.

Boss-specific tuning constants introduced by #8
(`src/game/boss/bossTuning.ts`) — flat v1 numbers, not yet spec'd elsewhere:

| Constant | Value | What |
|---|---|---|
| `BOSS_BASE_MAX_HP` | 400 | Phase-1 HP pool |
| `BOSS_POISE_THRESHOLD` | 40 | Flat poise-break threshold (no vitality-style scaling) |
| `BOSS_POISE_STAGGER_TICKS` | 45 | Lockout duration on a poise break |
| `CRITICAL_HIT_MULTIPLIER` | 2× | HP-damage multiplier during the posture critical window |
| `BOSS_MOVE_SPEED` | 2 u/tick | Approach/retreat speed while free |
| `BOSS_PREFERRED_RANGE` | 70 u | Distance the boss holds when not mid-sequence |

L2/tracker constants introduced by #9 (`behaviorTracker.ts`, `tactics.ts`):

| Constant | Value | What |
|---|---|---|
| `TRACKER_WINDOW_SECONDS` | 20 s | Rolling telemetry window (§5), ring of 1s buckets |
| `PANIC_ROLL_WINDOW_TICKS` | 10 | Roll within this of a boss startup = panic roll |
| `CAMPING_DISTANCE` | 140 u | Beyond this counts toward rangeCamping/turtling |
| `AGGRESSION_SATURATION_APS` | 1.5 | Attacks/sec that saturate the aggression signal |
| `PUNISH_COOLDOWN_TICKS` | 240 (4 s) | F5 — max one triggered punish per window |
| `TACTIC_MIN/MAX_HOLD_TICKS` | 120–300 (2–5 s) | Intent re-scoring cadence |
| `TACTIC_SOFTMAX_TEMPERATURE` | 0.35 | Decisiveness of tactic selection (§10) |
| `TURTLE_SATURATION_FRACTION` | 0.5 | Blocking/camping half the window saturates turtleIndex & rangeCamping |
| `MIN_RATE_WINDOW_SECONDS` | 3 s | Rate signals' denominator floor — early-fight actions can't read as saturated rates |
| `RANGE_DEADZONE` | 12 u | Movement stops within this of the tactic's target range |
| `PUNISHABLE_OPENING_RANGE` | 90 u | Max distance a committed player action reads as a PUNISH opening |

Movement is tactic-owned (one authority — `TACTIC_TARGET_RANGE` in
`bossCombat.ts`): NEUTRAL/REPOSITION hold the preferred pocket (70 u),
PRESSURE/PUNISH crowd to 45 u, BAIT hovers at 95 u, RECOVER backs off to
125 u — deliberately below `CAMPING_DISTANCE` (140), so the boss's own
retreat can never make the tracker read the player as camping. The
free-movement `approach()` walks toward the current intent's target range;
L2 REPOSITION expresses itself through this table rather than through a
second movement system. **RECOVER is movement-only**: while it is the
current intent the boss starts no new sequences — §3's "back off, guard,
low aggression" beat, enforced in `step()` rather than through move tags.

**Shipped v1 tactic semantics vs the §3 table:** the Enter-when conditions
are expressed through the score modifiers below §3 (signals raise a tactic's
softmax score), but the per-tactic *Exit-when* conditions are **not yet
implemented** — every tactic holds for a drawn 2–5 s window, then re-scores.
PUNISH's trigger + F5 rate limit is the one live trigger/exit mechanism.
Condition-based exits (REPOSITION ends on reaching the band, RECOVER on
poise recovery) are open work, not silently shipped.

## 5. The Behavior Tracker (adaptation input)

Rolling window (default **20s**, tick-resolution) of player telemetry, reduced
to normalized signals ∈ [0, 1]:

| Signal | Measures | Primarily feeds |
|--------|----------|-----------------|
| `dodgeReflex` | rolls within 10f of *any* boss startup (panic-rolling) | BAIT tactic, `delayed` tagged moves |
| `dodgeTiming` | i-frame success rate of recent rolls | global aggression scaling (good dodgers get faster pace) |
| `turtleIndex` | block-hold time + passivity + distance-keeping | PRESSURE, `grab` tagged moves (blocks don't stop grabs) |
| `healGreed` | heals attempted within punish range | PUNISH triggers, punish-move weights |
| `rangeCamping` | time spent beyond boss melee band + projectile count | REPOSITION→gap-close, `projectile`-answer moves |
| `punishPattern` | which boss recovery the player punishes most | boss varies which combos it ends early (denies the learned punish) |
| `aggression` | attack rate + trade willingness | RECOVER frequency, spacing choices |

**behaviorMod** maps signals → per-tactic/per-move multipliers, clamped to
**[0.25×, 4×]** of base weight (fairness F4). The mapping table itself is data
(per boss), so tuning is a data change with a unit test, not a code change.

**Two adaptation timescales:**
1. **In-fight (this doc, deterministic):** the rolling window above.
2. **Between attempts (async, ADR-0002):** attempt logs → server → LLM proposes
   *starting* base-weight adjustments within the same clamps, with a heuristic
   fallback. The LLM never sees or affects a live fight.

## 6. Fairness constraints (hard rules, all unit-tested)

Adaptation must never become unwinnable. These are **invariants**, not tuning:

| # | Rule |
|---|------|
| **F1** | Every move's tell ≥ **18f** (300ms) — nothing is unreactable. Delayed moves may *extend* tells, never shorten below this. |
| **F2** | ≥ **30f** of boss non-attack time between combo *sequences* (breathing room is authored, not emergent). |
| **F3** | Combo chains hard-capped at `maxChain` (≤ 5 in phase 1, ≤ 6 later). |
| **F4** | Behavior multipliers clamped to [0.25×, 4×]; adaptation shifts *tendencies*, never creates new moves mid-fight. |
| **F5** | PUNISH tactic rate-limited: max 1 triggered punish per 4s — the boss punishes patterns, it doesn't own every mistake. |
| **F6** | Phase transitions grant a 45f no-damage grace window. |
| **F7** | Grab moves (anti-turtle) always have the longest tells in the moveset and never combo-chain. |
| **F8** | Same L3 move never selected 3× consecutively (forced variety floor, independent of weights). |

The **fairness-filter** in §4's pipeline enforces F3/F5/F7/F8 by construction;
F1/F2/F6 are validated by a schema-level test over every boss's move table
(a *data test* — CI fails if a designer authors an illegal move).

## 7. The four bosses — differentiation at a glance

Each boss = same engine, different data + one **signature mechanic** (the only
per-boss code):

| Boss | Fantasy | Tactic bias | Signature mechanic | Phases |
|------|---------|------------|--------------------|--------|
| **Margit** | The examiner — punishes bad habits | BAIT-heavy; famous delayed overheads | *Judgment*: his between-attempt LLM reweighting is the most aggressive — he's the tutorial for "no same tactic twice" | 2 |
| **Radahn** | Spectacle & scale — a battlefield, not a duel | REPOSITION/PRESSURE; arena-wide gravity projectiles, charge patterns | *Starfall*: mid-fight arena-scale meteor phase transition | 2 |
| **Malenia** | The skill check — aggression that heals | PRESSURE-dominant; **lifesteal on hit** (her HP is your discipline meter) | *Waterfowl-style flurry*: the one move with an F1-exception long-range dodge *sequence* (multi-tell, choreographed, 3-part) + scarlet rot pools | 2 |
| **Radagon / Elden Beast** | The finale — two bosses, one HP journey | Radagon: PUNISH/holy AoE · Beast: RANGE game inversion (player must chase) | *Duality*: full moveset + arena swap mid-fight; tests every signal the player has trained | 2+2 |

Margit's full move table (~14 moves incl. combo branches) is the Sprint-1
authoring target and the template that proves the schema.

## 8. Observability & the post-death recap

Every L2/L3 decision emits a structured event to the attempt log:

```ts
{ tick, layer: "tactic"|"action", chose: id, becauseSignals: {...top-2 contributing signals}, playerStateSnapshot }
```

This gives us, for free:
1. **The LLM recap's raw material** — "you died to `margit.delayed_overhead`,
   selected because `dodgeReflex=0.82`" → "Margit read your panic-rolls."
   Specific by construction (PRD G4).
2. **Deterministic replay** — log + seed reproduces any fight for debugging.
3. **Balance telemetry** — which moves kill, which tactics never fire.

## 9. Testing strategy (maps to SDLC §8)

| Layer | Test type | Example |
|-------|-----------|---------|
| Signals | unit | dodge-spam input stream → `dodgeReflex` ≥ 0.7 |
| L2 transitions | unit | `healGreed` high + in range → PUNISH eligible & prioritized |
| L3 selection | unit (seeded) | given seed S and state X, selection is exactly move M |
| Fairness | **property-based** | ∀ signal combinations: F1–F5/F7/F8 hold over 10k+ simulated decisions (shipped: `fairness.property.test.ts` — fast-check pure properties + 5 adversarial bots × 5 seeds × 2500 ticks + a chaos bot; F6 joins when phases land) |
| Move tables | data test | every authored move satisfies schema + F1/F2/F7 |
| Full fight | simulation | scripted "player bots" (roll-spammer, turtle, range-camper) vs. Margit → assert the counter-tactic rate rises |

The **player-bot simulation harness** is the crown jewel: it proves *adaptation
works* in CI, headlessly, before a human ever playtests — and it's only
possible because the whole brain is Phaser-free.

## 10. Open tuning questions (not blockers)

- Softmax temperature per boss (how "decisive" each boss feels).
- Rolling-window length: 20s default; Malenia may want 12s (faster reads).
- Whether `punishPattern` denial is too cruel for Margit (tutorial boss).
