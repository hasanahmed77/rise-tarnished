# UML Plan — Rise, Tarnished

> Status: planning doc, written before any diagram. Every fact below is
> pulled from the actual repository (source files, DB migrations, ADRs) as
> of 2026-08-08, not invented for the diagram. Where a diagram simplifies
> something real, that's called out explicitly rather than left silent.

## Why this plan exists

Five deliverables were requested:

1. One detailed Use Case Diagram
2. A detailed use case description for one major use case
3. Two Sequence Diagrams + one Communication Diagram, covering the three
   most important use cases (main functionalities)
4. One Activity Diagram, for the use case whose logic is best read as a
   workflow/decision process
5. One detailed Class Diagram — classes, attributes, methods, relationships,
   multiplicities

This doc fixes, before any drawing happens: which use cases qualify as
"most important," which three get sequence/communication treatment (and
who draws which), which one gets the activity diagram and why, and which
real source files each diagram is traced from. That way the diagrams are a
faithful model of the shipped system, not a generic template with the
project's name pasted on top.

## Source grounding

Every diagram below is traced to specific files so a reviewer can verify it
against the repo:

- **Auth/session**: `src/app/page.tsx`, `src/app/play/page.tsx`,
  `src/app/auth/callback/route.ts`, `src/components/AuthButton.tsx`,
  `src/lib/supabase/{client,server}.ts`, `supabase/migrations/20260720193939_initial_schema.sql`
  (the `handle_new_user` trigger)
- **Character sheet / stat spend**: `src/components/CharacterSheet.tsx`,
  `src/components/PlayShell.tsx`,
  `supabase/migrations/20260802120000_spend_stat_point.sql`
- **Combat loop**: `src/game/scenes/CombatScene.ts`,
  `src/game/combat/playerCombat.ts`, `src/game/boss/bossCombat.ts`,
  `src/game/bridge.ts`, `src/game/createGame.ts`
- **Boss AI (HFSM)**: `src/game/boss/tactics.ts`,
  `src/game/boss/actionSelection.ts`, `src/game/boss/behaviorTracker.ts`,
  `src/game/boss/margitMoves.ts`, `docs/design/BOSS_AI.md`
- **Fight resolution / persistence**: `src/components/GameCanvas.tsx`,
  `supabase/migrations/20260721132716_resolve_attempt.sql`
- **Data model**: all three files in `supabase/migrations/`

## Rigor pass (post-draft self-review)

This plan was checked a second time against strict UML semantics and the
actual schema before any diagram was drawn. Six real issues were found and
are fixed at their point of use below, not just noted here:

1. **`<<include>>` was misused on optional behavior.** UML defines
   `<<include>>` as "always performed as part of the base use case's flow."
   Casting sorcery and blocking are player choices, not mandatory steps of
   every fight — that's `<<extend>>`, not `<<include>>`. Fixed in §1.
2. **`AttemptLog` was missing a real column.** `region_unlocked` (added by
   `resolve_attempt.sql`, persisted specifically so a retried RPC call can
   report it without re-deriving a now-wrong answer) was left off. Fixed
   in §5.
3. **`Boss -- AttemptLog` is not a schema-enforced relationship.** Checked
   directly: `attempt_logs.boss_id` is `text not null` with **no foreign
   key** to `bosses.id`. It's validated only inside `resolve_attempt`
   (`raise exception 'unknown boss_id'`), not by Postgres. Drawing a solid
   UML association there would claim a constraint that doesn't exist —
   fixed to a dependency, with the reasoning stated in §5.
4. **Softmax choice doesn't map cleanly onto a UML decision node.** Decision
   nodes carry mutually-exclusive boolean guards; the tactic pick in
   `tactics.ts` is a weighted probabilistic choice, not a guard evaluation.
   The activity diagram (§4) says so explicitly on the node itself rather
   than silently drawing it like an `if`.
5. **Sequence and Communication diagrams are semantically equivalent in
   UML 2.x** (same information, different layout) — worth stating outright
   in §3 rather than implying the three use cases were sorted into
   sequence/communication by some technical necessity. The split was a
   pedagogical choice (three team members, three diagrams), and the
   rationale for *which* use case got which notation is given per-diagram.
6. **The class diagram's core methodology was a judgment call, not mine to
   make unilaterally** — see §5's note. Resolved: state interfaces are
   modeled as classes with their real fields and their actual pure
   functions as operations, matching the shipped architecture exactly
   (confirmed with the project owner rather than assumed).

## 1. Use Case Diagram

**Actors** (external to the system boundary):

- **Player** — the primary actor; the only human actor.
- **Google (OAuth Provider)** — Supabase Auth's sole sign-in method
  (ADR-0003); the system never handles a password itself.
- **Supabase Platform** — the auth/Postgres backend the system depends on
  for every persisted read/write. Modeled as a secondary actor rather than
  "inside" the system boundary because the use cases describe *player*
  goals, and Supabase is a service the system calls out to, not something
  the player interacts with directly.

**Use cases**, one level, inside the system boundary:

- Sign In (with Google) — actor: Player, Google, Supabase Platform
- Resume Progress — actor: Player; `<<include>>`s nothing, reads
  `player_stats`/`player_progress` on `/play` load
- Spend Runes on Stats — actor: Player, Supabase Platform (the
  `spend_stat_point` RPC)
- Fight the Adaptive Boss — actor: Player; the central use case. Split by
  the strict UML test — "is this sub-behavior performed, unconditionally,
  at a defined point in *every* completed instance of the base use case?" —
  rather than by which actions merely *can* occur:
  - `<<include>>` Move — winning requires closing/holding distance at some
    point; the base flow can't complete without it
  - `<<include>>` Attack (Light/Heavy) — winning requires reducing the
    boss's HP to 0, which requires landing at least one attack; genuinely
    mandatory across a complete play-through, unlike the three below
  - `<<extend>>` Dodge — a defensive choice; a high-vitality build can
    clear a fight while tanking hits and never dodging
  - `<<extend>>` Block — likewise optional; not every build or playstyle
    uses it
  - `<<extend>>` Cast Sorcery — only reachable at all with intelligence
    invested (`playerBuild.intelligence`); a pure dex/vit build never
    triggers this extension point
  - `<<extend>>` Land a Critical Hit — only reachable when the boss's
    posture has broken (`isCriticalWindowOpen`); doesn't happen in every
    fight, and can fail to happen even in a won fight
- View Fight Outcome — actor: Player; triggered when Fight the Adaptive
  Boss ends
- Resolve Attempt (persist result, grant runes) — actor: Player, Supabase
  Platform; `<<include>>`d by View Fight Outcome, since the outcome screen
  is what triggers the RPC call
- Sign Out — actor: Player, Supabase Platform

**Deliberately excluded**: the post-death LLM recap (issue #13) and the
headless bot-simulation harness (issue #14) are not implemented — including
them would misrepresent what the system actually does today. The diagram
models the shipped MVP loop only: *sign in → resume → spend → fight → view
outcome → resolve*.

## 2. Detailed Use Case Description

**Chosen use case: "Fight the Adaptive Boss."**

Reasoning: every other use case is either infrastructure (auth) or a single
RPC call (spend runes, resolve attempt). This is the one with real actors,
real alternate flows, real business rules (the fairness invariants F1–F8 in
`docs/design/BOSS_AI.md` §6), and a real failure/exception path (the
player dies). It's also the use case the entire project pitch is built
around (`docs/PRD.md`'s framing: "an adaptive AI that refuses to let you
win the same way twice"), so it's the one a reader most needs spelled out
in full.

Fields to fill from the real system (not placeholders):

- **Preconditions**: signed in, on `/play`, `fight:start` has fired with a
  real `PlayerBuild` (`CombatScene.startFight`)
- **Postconditions (success)**: `determineFightOutcome` returns `'victory'`;
  `fight:outcome` emitted; `resolve_attempt` eventually called
- **Postconditions (failure)**: `determineFightOutcome` returns `'death'`;
  same event, `p_result: 'death'`, RPC pays 0 runes
- **Main flow**: sampled input → `playerCombat.step` → boss L2/L3 decision
  → `bossCombat.step` → cross-entity hit resolution in `CombatScene` → HUD/
  audio/VFX → repeat at 60Hz until HP hits 0 on either side
- **Alternate flows**: dodging (i-frames), blocking (stamina drain, guard
  break), casting (FP-gated), the boss's `PUNISH` tactic pre-empting on an
  opening
  **Business rules**: F1 (18f min tell), F2 (30f+ gap between sequences),
  F3 (chain cap), F5 (1 punish/4s), F8 (no 3rd consecutive repeat) — cited
  directly from `docs/design/BOSS_AI.md` §6, not paraphrased

## 3. Sequence + Communication Diagrams — which three use cases, and why

The brief asks for the **three most important use cases representing the
main functionalities of the system**. Read against this project's own
framing of its MVP loop (`docs/PRD.md`, `docs/sprints/sprint-05.md`:
*"sign in → fight → win/lose → runes → spend → re-fight differently"*),
three use cases cover the system end to end without overlapping:

| # | Use case | Layer | Diagram type | Drawn by |
|---|---|---|---|---|
| 1 | **Sign In (with Google)** | Auth/session — the entry point | Sequence | Member A |
| 2 | **Fight the Adaptive Boss** (one resolved attack, player→boss) | Core gameplay — the reason the project exists | Sequence | Member B |
| 3 | **Spend Runes on Stats** | Progression/economy — the persistence half of the loop, and the one with a real atomic-transaction story worth showing | Communication | Member C |

This spread was chosen deliberately over three gameplay-only diagrams: it
demonstrates the three architecturally distinct kinds of interaction the
system has — an OAuth redirect flow, a client-authoritative real-time sim
loop, and a server-validated financial transaction (ADR-0003) — rather
than three near-identical "attack lands" variations.

**On the sequence/communication split specifically**: UML 2.x defines these
two diagram types as *semantically equivalent* — both are interaction
diagrams over the same underlying model, differing only in whether time
(sequence) or object links (communication) is the primary layout axis. No
use case here technically *requires* one notation over the other; nothing
would be lost by drawing all three as sequence diagrams. The split into
2 sequence + 1 communication is a **pedagogical/organizational choice**
(three team members, three diagrams, one of each required style), not a
technical necessity — and Spend Runes on Stats was picked for the
communication treatment specifically because its story is about which
*object* (the RPC vs. the row it locks) is responsible for which piece of
validation, which a hub-and-spoke layout foregrounds more naturally than a
tall vertical timeline does.

### 3a. Sequence Diagram — Sign In (with Google)

Traced to: `AuthButton.tsx` (`SignInButton`), `src/lib/supabase/client.ts`,
`src/app/auth/callback/route.ts`, `supabase/migrations/...initial_schema.sql`
(`handle_new_user` trigger), `src/app/play/page.tsx`.

Participants: `Player`, `SignInButton`, `Supabase Auth`, `Google`,
`AuthCallbackRoute`, `Postgres (handle_new_user trigger)`, `PlayPage`.

Flow: click → `supabase.auth.signInWithOAuth({provider:'google', redirectTo})`
→ redirect to Google → Google redirects to `/auth/callback?code=...` →
route handler exchanges the code for a session → **on first-ever sign-in**,
the `handle_new_user` trigger fires server-side, provisioning one row each
in `player_stats`, `player_progress`, `player_builds` → redirect to `/play`
→ `PlayPage` (server component) calls `supabase.auth.getUser()`, finds a
session, renders `PlayShell` instead of redirecting to `/`.

The trigger firing is drawn as an **optional fragment** (`alt`/`opt` in
sequence-diagram terms) — it only happens the very first time a given
Google account signs in, and that conditionality is worth being explicit
about rather than implying it happens on every login.

### 3b. Sequence Diagram — Fight the Adaptive Boss (one resolved light attack)

Traced to: `CombatScene.update`, `playerCombat.step`, `bossCombat.step`
(specifically `selectTopLevel`/`tickTactic` inside it),
`CombatScene.resolvePlayerAttackOnBoss`, `resolveBossHit`,
`determineFightOutcome`.

Participants: `Player`, `CombatScene`, `playerCombat (pure)`,
`bossCombat (pure)`, `TacticMachine`, `ActionSelection`.

Scope deliberately narrowed to **one tick where a light attack connects**
rather than the whole multi-minute fight — a sequence diagram showing
"loop 3600 times" end to end would be unreadable and would not actually
communicate more than one representative tick does. The 60Hz loop itself
is shown as a single `loop` fragment wrapping the tick, with a note that
it repeats until `determineFightOutcome` returns non-null.

Flow: `update(delta)` → sample input → `playerCombat.step(sim, input, ctx)`
→ returns `attack:active` event → `resolvePlayerAttackOnBoss` → computes
`meleeDamage` → `resolveBossHit(boss, {hp, poise, postureDamage})` → boss
HP/poise/posture updated, returns `wasCritical` → scene triggers hitstop/
shake/SFX → `bossCombat.step` advances the boss's own L2 (`tickTactic`) and
L3 (`selectTopLevel`, weighted by the current tactic + behavior signals) →
render.

### 3c. Communication Diagram — Spend Runes on Stats

Traced to: `CharacterSheet.tsx` (`confirmSpend`),
`supabase/migrations/20260802120000_spend_stat_point.sql`.

Objects: `:Player`, `:CharacterSheet`, `:SupabaseClient`, `:PostgREST`,
`:spend_stat_point (RPC, SECURITY DEFINER)`, `:player_stats (table)`.

Numbered messages (communication-diagram style, since the point of this
one is the *object collaboration and the RPC's internal atomicity*, which
reads more naturally as a small hub-and-spoke than as a long vertical
sequence):

1. `Player → CharacterSheet`: click "+1" on a stat, already armed
2. `CharacterSheet → SupabaseClient`: `rpc('spend_stat_point', {p_stat})`
3. `SupabaseClient → PostgREST`: HTTPS call carrying the caller's JWT
4. `PostgREST → spend_stat_point`: invoke as the authenticated role
5. `spend_stat_point → player_stats`: `SELECT ... FOR UPDATE` (row lock —
   the cost depends on the row's own current value, so it must be locked
   before being read; see ADR-0003's dedicated bullet on this)
6. `spend_stat_point → spend_stat_point`: compute
   `cost = 100 + 25×(current−10)`; check `current < 60` (hard cap)
7. `spend_stat_point → player_stats`: atomic `UPDATE ... WHERE runes >= cost`
8. `player_stats → spend_stat_point`: `RETURNING` the new row (or `NOT FOUND`)
9. `spend_stat_point → PostgREST → SupabaseClient → CharacterSheet`:
   new `{vitality, dexterity, intelligence, runes}` or a
   `'not enough runes'` / `'stat is already at its maximum'` exception

This is the one use case in the set where the *interesting* part is not
message order but which object owns which piece of state and validation —
exactly what a communication diagram is for, and why it's the one assigned
that notation rather than sequence.

## 4. Activity Diagram

**Chosen use case: the boss's L2→L3 decision process inside "Fight the
Adaptive Boss"** — specifically, one tick of `tactics.tickTactic` feeding
`actionSelection.selectTopLevel`/`selectComboBranch`.

Reasoning: this is explicitly named as the criterion — "whose workflow or
decision-making process is best understood through an activity diagram."
Nothing else in the system comes close on decision density. This single
process has, in order: a trigger-priority check (`PUNISH`), a rate-limit
guard (F5), a hold-timer gate, a softmax-weighted choice among five
tactics, a range/cooldown/repeat-history filter (F8) over the move table,
a tactic-match filter with a documented fallback rule, a weighted pick, and
then a *separate* combo-branch decision tree for follow-up hits
(condition-gated links, `maxChain` cap, weighted "end the sequence" mass).
A sequence diagram would show *who calls whom*; only an activity diagram
with real decision/merge nodes shows *why the boss picked what it picked*,
which is the actual subject of the project's pitch.

Traced to: `tactics.ts::tickTactic`, `actionSelection.ts::selectTopLevel`
and `::selectComboBranch`, `docs/design/BOSS_AI.md` §3–§4.

Structure: swimlanes for **L2 (Tactic Machine)** and **L3 (Action
Selection)**. Decision nodes drawn for: punishable opening? → cooldown
elapsed? → hold expired? → softmax pick → (separately, on the L3 lane)
mid-combo or fresh pick? → eligible set empty? → tactic-matched subset
empty? (fallback) → weighted pick → move started, or `no-action` (approach).

**Notation caveat, stated on the diagram itself, not hidden**: standard UML
decision nodes carry *mutually-exclusive boolean guards* (`[x > 0]` /
`[else]`). The two weighted picks in this process — the L2 softmax over
five tactics, and the L3 weighted pick over eligible moves/combo links —
are **probabilistic**, not guard-evaluated: nothing about the system state
alone determines which branch is taken, only a distribution over branches
does. Both weighted-pick nodes are annotated `{probabilistic — weights from
BASE_SCORE × behaviorMod}` / `{probabilistic — weights from behaviorMod ×
tacticFilter}` rather than drawn as if they were ordinary `if`/`else`
branches, so the diagram doesn't silently misrepresent a random weighted
choice as a deterministic one.

## 5. Class Diagram

The system is a **functional core / imperative shell** (ADR-0001) — most
"state" is plain data (TypeScript `interface`s) transformed by pure
top-level functions, not objects with methods. A class diagram that
pretends otherwise (inventing methods that don't exist) would be
inaccurate. The honest, defensible UML treatment used here — standard for
modeling a functional core — is:

- Each state interface **is** a class, with its real fields as attributes.
- The pure functions that operate on that state (`create*`, `step`,
  `tick*`) are attached to that class as its **operations**, since that is
  the closest UML has to "the functions this data's lifecycle is defined
  by," and it's what a reader actually needs to know to use the type
  correctly.
- The two real OOP classes in the codebase (`GameBridge`, `CombatScene`)
  are drawn as actual classes with actual methods — no translation needed.
- The five Postgres tables are drawn as a small persistence-layer class
  block (or a separate ER-style corner of the same diagram), connected to
  the domain classes they back, with real multiplicities from the FK/unique
  constraints (e.g. `auth.users "1" -- "0..1" player_stats`, enforced by
  `user_id` being both PK and FK; `auth.users "1" -- "0..*" player_builds`,
  enforced by the partial unique index only capping *active* builds at one).

**Classes included** (all real, all confirmed against source):

- `PlayerCombatState` (`playerCombat.ts`) — attributes: `x, facing, hp,
  stamina, fp, action, poiseDamage, staggerTicks, ticksSinceStaminaSpend,
  ticksSinceFpSpend, projectiles: Projectile[], nextProjectileId`.
  Operations: `createPlayerState(), step(), poiseThreshold(), isStaggered(),
  isInvulnerable(), resolveIncomingHit()`
- `Projectile` — `id, x, facing, ticksAlive, damage`. Composition:
  `PlayerCombatState "1" *-- "0..*" Projectile`
- `BossCombatState` (`bossCombat.ts`) — `x, facing, hp, poiseDamage,
  posture, action, staggerTicks, selection, tactic, tracker`. Operations:
  `createBossState(), step(), resolveBossHit(), isPunishableOpening()`
- `PostureState` (`posture.ts`) — `value, criticalTicks`. Composition:
  `BossCombatState "1" *-- "1" PostureState`
- `TacticState` (`tactics.ts`) — `current: Tactic, ticksInTactic, holdTicks,
  punishCooldown, rng`. Operation: `tickTactic()`. Composition:
  `BossCombatState "1" *-- "1" TacticState`
- `SelectionState` (`actionSelection.ts`) — `rng, cooldowns:
  Record<string,number>, chainDepth, recentMoves: string[],
  gapTicksRemaining`. Operations: `selectTopLevel(), selectComboBranch()`.
  Composition: `BossCombatState "1" *-- "1" SelectionState`
- `TrackerState` (`behaviorTracker.ts`) — `buckets: Bucket[], cursor,
  tickInBucket, ticksSinceBossStartup`. Operation: `computeSignals() :
  BehaviorSignals`. Composition: `BossCombatState "1" *-- "1" TrackerState`
- `MoveDef` (`types.ts`) — `id, tags, tactics, rangeBand, frames,
  tellFrames, damage, poiseDamage, postureSelfRisk, staminaCost, combo?,
  cooldownTicks, comboOnly?`. Association: `SelectionState ..> MoveDef :
  selects` (dependency, not composition — the move table is shared,
  read-only reference data, not owned per-boss-instance)
- `PlayerBuild` (`bridge.ts`) — `vitality, dexterity, intelligence`.
- `StepContext` (`playerCombat.ts`) — `build: PlayerBuild, minX: number,
  maxX: number`. **Corrected on the second pass**: the first draft claimed
  `PlayerCombatState "1" --> "1" PlayerBuild` directly, but checked against
  the actual interface, `PlayerCombatState` has no `build` field —
  `build` lives on `StepContext`, a separate object passed alongside the
  state into `step(state, input, ctx)`. The correct relationship is
  `StepContext "1" o-- "1" PlayerBuild` (composition — a `StepContext` is
  constructed fresh with one build and doesn't outlive it), and
  `PlayerCombatState ..> StepContext` as a **dependency** (used as an
  input parameter to `step`, never stored on the state itself).
  The first draft's `BossCombatState ..> PlayerBuild` claim is dropped
  entirely rather than corrected — checked `BossStepContext` directly and
  it has no `build` field and no relationship to `PlayerBuild` at all; the
  boss's step function never reads the player's stat build.
- `GameBridge` (`bridge.ts`) — real class. Attributes: `toGame:
  TypedEmitter<ShellToGameEvents>, toShell: TypedEmitter<GameToShellEvents>`.
  Methods: `dispose()`
- `CombatScene` (`scenes/CombatScene.ts`) — real class, `extends
  Phaser.Scene`. Attributes limited to the ones that matter for the
  diagram's story (`sim, boss, ctx, bossCtx, bridge, hitstopMs,
  deathAnimMs, finished, ready`), not all 40+ private fields — a class
  diagram that lists every render-pool sprite field stops being readable
  and starts being noise. Methods: `preload(), create(), update(),
  startFight(), resolvePlayerAttackOnBoss(), resolveBossAttackOnPlayer(),
  reportOutcome()`. Association: `CombatScene "1" o-- "1" PlayerCombatState`,
  `CombatScene "1" o-- "1" BossCombatState`, `CombatScene "1" --> "1"
  GameBridge`
- **Persistence classes** (Postgres tables, `supabase/migrations/`):
  `PlayerStats(user_id PK/FK, vitality, dexterity, intelligence, runes,
  updated_at)`, `PlayerProgress(user_id PK/FK, current_region,
  regions_cleared, updated_at)`, `PlayerBuildRow(id PK, user_id FK,
  weapon_id, is_active, created_at)`, `AttemptLog(id PK, user_id FK,
  boss_id, result, duration_ticks, rune_delta, region_unlocked, log,
  created_at)`, `Boss(id PK, region_id, rune_reward)`.

  Multiplicities, read off the actual constraints rather than assumed:
  `AuthUser "1" -- "0..1" PlayerStats` and `AuthUser "1" -- "0..1"
  PlayerProgress` — **`0..1`, not `1`**, because `handle_new_user` is an
  application-level trigger that provisions the row on signup, not a schema
  constraint that guarantees it exists (there is no `NOT NULL`-style rule
  on `auth.users` forcing a matching row; a backfill migration
  (`20260721150053_backfill_missing_player_rows.sql`) existed precisely
  because pre-trigger accounts had none). `AuthUser "1" -- "0..*"
  PlayerBuildRow` (a partial unique index caps *active* builds at one, but
  places no ceiling on inactive ones). `AuthUser "1" -- "0..*" AttemptLog`.

  `AttemptLog "0..*" --> "1" Boss «not FK-enforced»` — corrected twice over
  from the first draft, which had this backwards in two separate ways.
  First error: the arrow was drawn `Boss ..> AttemptLog`, but a UML
  dependency points from the *dependent* class to what it depends on —
  `AttemptLog` is the one holding a reference that must resolve to a real
  `Boss`, so the arrow has to originate at `AttemptLog`, not `Boss`.
  Second, more basic error: **multiplicity is specifically an
  association-end concept in UML** — a `<<use>>`-style dependency arrow
  doesn't carry cardinality at all, so attaching `"1"`/`"0..*"` to one was
  a notation error, not just an inaccurate one. Checked against the schema:
  `attempt_logs.boss_id` is `text not null` with **no foreign key**
  constraint to `bosses.id` — integrity is enforced only inside
  `resolve_attempt` (`raise exception 'unknown boss_id: %'`), never by
  Postgres. Since the 1-to-many relationship genuinely exists at the data
  level (it's just not DB-enforced), the correct UML treatment is what
  real-world reverse-engineering of a "soft" foreign key normally uses: a
  regular navigable **association** (not a bare dependency) carrying the
  real multiplicity, with a stereotype/note flagging that it's
  application-enforced rather than schema-enforced — not a change of
  relationship type, just an honest label on it.

**Deliberately excluded from the class diagram**: the ~15 pure utility
modules with no state of their own (`scaling.ts`, `weighting.ts`,
`reward.ts`, `outcome.ts`, `rng.ts`) — they're function libraries, not
classes, and forcing them into boxes with no attributes would be padding,
not information.

## Execution order

1. This plan (done).
2. Use Case Diagram — unblocks everything downstream, since the three
   sequence/communication use cases and the activity-diagram use case are
   all named relative to it.
3. Detailed use case description (Fight the Adaptive Boss).
4. Sequence Diagram — Sign In.
5. Sequence Diagram — Fight the Adaptive Boss (one tick).
6. Communication Diagram — Spend Runes on Stats.
7. Activity Diagram — Boss L2/L3 decision process.
8. Class Diagram.

Each diagram is delivered as a Mermaid source block (renders natively,
version-controllable, and matches how this repo already documents
everything else) plus a short caption tying it back to the exact source
files it was traced from.
