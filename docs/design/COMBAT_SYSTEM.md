# Combat System Design — Rise, Tarnished

> Status: v1 draft · Companion: `BOSS_AI.md` · Change via PR.
> This spec defines the *player-side* combat model. All numbers are initial
> tuning values, expected to change through playtesting — but the *systems* are
> commitments.

## 1. Design pillars

1. **Stamina is the language of combat.** Every meaningful action spends
   stamina. Combat is resource conversation, not button mashing.
2. **Commitment.** Attacks, dodges, and heals lock the player into animation.
   You cannot cancel out of a mistake — you plan, then commit.
3. **Readable danger.** Every boss attack has a tell. Every death is
   attributable to a decision, never to noise. (Feeds S2 and the post-death
   breakdown.)
4. **Builds change the verbs.** Stats don't just make numbers bigger — they
   change which options are viable (see §6).

## 2. Frame model

All combat logic runs on a fixed **60 ticks/second** simulation clock,
decoupled from render framerate. Every action is defined in frames:

```
        ┌─ startup ─┬─ active ─┬─ recovery ─┐
attack: │  no hit   │ hitbox on│  vulnerable │
        └───────────┴──────────┴────────────┘
```

- **Startup** — animation windup; interruptible only by getting hit.
- **Active** — hitbox live; damage dealt on hurtbox overlap.
- **Recovery** — locked; this is where punishes happen (both directions).

Hitbox/hurtbox overlap is evaluated per tick by Phaser; the *consequence*
(damage, stagger, death) is computed by the pure logic layer.

## 3. Player resources

| Resource | Base | Notes |
|----------|------|-------|
| **HP** | 100 | Scales with vitality. Death at 0 — no revives mid-attempt. |
| **Stamina** | 100 | Regenerates 25/s after a 0.5s delay from last spend. Regen paused while blocking. |
| **Flasks** | 3 per attempt | Each heals 45% max HP over a 1.2s locked animation. The heal is the riskiest action in the game — by design. |
| **Focus (FP)** | 60 | Fuel for sorcery (intelligence builds). No natural regen mid-fight; a flask variant choice (see §6.4). |

## 4. Player actions (frame data v1)

| Action | Startup | Active | Recovery | Stamina | Notes |
|--------|--------:|-------:|---------:|--------:|-------|
| Light attack | 8f | 4f | 12f | 15 | Chains ×3; each chain step +2f recovery |
| Heavy attack | 22f | 6f | 24f | 30 | High poise damage; chargeable +10f for 1.5× |
| Dodge roll | 2f | **12f i-frames** | 10f | 25 | Direction-committed; the core defensive verb |
| Block (hold) | 3f | — | 8f release | drain | Reduces damage 70%; blocked hits drain stamina; **guard break** at 0 stamina → 40f stagger |
| Flask heal | 18f | — | 54f | 0 | Fully committed; movement locked |
| Sorcery bolt | 14f | proj. | 18f | 10 + 12 FP | Ranged; damage scales with intelligence |
| Jump | 4f | — | 8f | 10 | Avoids sweeps/shockwaves |

**I-frames** (invincibility frames) on dodge are the heart of souls-like
defense: a well-timed roll *through* an attack beats retreating from it.
Dexterity extends the i-frame window (§6).

## 5. Poise & stagger (both directions)

- Every entity has **poise** — resistance to being interrupted.
- Attacks deal **poise damage** alongside HP damage. When accumulated poise
  damage reaches the target's poise threshold (**base 20**, +0.5/vitality pt,
  see §6), they're **staggered**: animation interrupted, all input locked for
  **30f**, fully vulnerable. The break consumes the accumulator. Poise damage
  decays 10/s. A guard break (§4) staggers for **40f**. Overlapping staggers
  never shorten one another — the longer remaining lockout wins.
- Bosses have a second, slower meter: **posture** (cap **100**, decays
  **3/s** — slow enough that sustained pressure matters). Filling it (heavy
  attacks, well-timed jumps over sweeps, punishing recovery) triggers a
  **posture break**: the boss collapses for a 90f **critical window** where
  the player lands a high-damage critical hit, then the meter resets to zero.
  Posture damage during an open window is ignored (the collapsed boss takes
  HP damage instead). This is the skill-expression reward loop.

## 6. Stats & builds

Runes buy stat points. Soft caps make hybrid builds viable but specialization
meaningful (diminishing returns past the soft cap).

| Stat | Primary effect | Secondary effect | Soft cap |
|------|----------------|------------------|----------|
| **Vitality** | +max HP (+6/pt) | +poise (+0.5/pt), +stamina (+2/pt) | 40 |
| **Dexterity** | +light-weapon scaling | +1 i-frame per 8 pts (max +4) | 45 |
| **Intelligence** | +sorcery scaling | +max FP (+3/pt) | 45 |

Three stats, not four: **Vitality** is the sole survivability stat (HP is
*derived* from it, never a stored "health" value), and it absorbs the stamina
scaling the old placeholder "Health" stat carried. Flask potency is flat in v1
(no stat scales it). This keeps builds legible — one survivability axis, one
melee axis, one caster axis.

**Damage formula (v1):**

```
damage = weapon_base × (1 + scaling_coeff × softcap(stat)) × type_modifier
softcap(s) = s ≤ cap ? s/cap : 1 + 0.3 × (s - cap)/cap   (normalized)
```

Shipped as pure, unit-tested functions in the logic layer
(`src/game/combat/scaling.ts`: `softcap`, `scaledDamage`). Exact curves are
tuning targets, not architecture.

**Sorcery & FP (#40, the int mechanic).** Intelligence is a real archetype,
not just a stat: a caster spends **Focus Points** on a committed ranged
sorcery. Shipped v1 values (`frameData.ts`, all tuning targets):

- **FP pool** = `40 + 3 × int` (§6 secondary), regenerating out of combat
  commitment like stamina (a slower trickle — a caster shouldn't spam).
- **Cast** is a slow, hard-committed action (18-tick startup / 20-tick
  recovery, no stamina cost) gated on **35 FP**. On its active frame it emits
  one projectile travelling at 6 u/tick, lifetime 90 ticks (max range ~540
  world-units before it fizzles), carrying HP damage
  `scaledDamage(14, 1.5, int, cap 45)` (≈19 at int 10,
  35 at the cap) plus flat poise/posture damage.
- The projectile lives in the pure sim (deterministic travel + lifetime,
  fairness suite unaffected); cross-entity hit resolution stays the scene's
  job, same as melee, via the pure `projectileHits` predicate.

**Melee scaling, max HP/stamina, and stat spend (#12).** The damage formula
above now drives melee, not just sorcery, and vitality's HP/stamina bonuses
are real. Shipped v1 values (`frameData.ts`, all tuning targets):

- **Melee HP damage** = `scaledDamage(weapon_base, dex_coeff, dexterity, cap 45)`
  — light: base 8, coeff 0.8; heavy: base 18, coeff 1.0. Poise damage per hit
  stays the flat `ATTACK_DAMAGE` value (§6 doesn't specify dex-scaled poise).
- **Max HP** = `100 + 6 × 40 × softcap(vitality, 40)` — linear +6/pt up to the
  cap (exactly the §6 secondary-effect rate), then the same 30%-of-normal
  softening `softcap` gives stat-scaled damage above its cap.
- **Max stamina** = `100 + 2 × 40 × softcap(vitality, 40)` — same curve, +2/pt
  below the cap.
- **Stat spend**: `spend_stat_point` (SECURITY DEFINER RPC,
  `supabase/migrations/…_spend_stat_point.sql`) atomically deducts a flat
  **100 runes** and increments one of vitality/dexterity/intelligence by 1.
  No hard ceiling on a stat — only the soft cap's diminishing-returns curve
  above (§6's table lists soft caps, not hard maximums). Idempotency isn't
  needed the way `resolve_attempt` needs it (#11): each call spends exactly
  one point via a single conditional `UPDATE … WHERE runes >= cost`, so a
  retried call either succeeds once or fails cleanly, never double-spends.
- The player's real persisted build now drives every fight: the character
  sheet screen (`CharacterSheet.tsx`) reads `player_stats`, and `PlayShell`
  hands the resulting build to `GameCanvas`, which emits it via the
  `fight:start` bridge event (defined since Sprint 1, first used here) —
  `CombatScene` builds its sim/boss state from that event instead of the
  hardcoded sandbox build it used through Sprint 6's first half.

### Build archetypes we commit to supporting
1. **Dex duelist** — fast light chains, extended i-frames, low HP margin.
2. **Vit bruiser** — heavy weapon, tanks hits via poise, out-trades.
3. **Int caster** — spacing game, punishes from range, fragile up close.

Each boss must be **clearable by all three archetypes** — this is a testable
design constraint (playtest matrix in `docs/playtests/`).

## 7. Input mapping (MVP: keyboard + mouse)

| Input | Action |
|-------|--------|
| WASD | Move |
| Space | Dodge roll (direction = movement) |
| LMB / RMB | Light / Heavy |
| Shift (hold) | Block |
| F | Flask |
| Q | Sorcery |
| E | Jump |

Gamepad support is post-MVP (PRD open question resolved: **keyboard-first**).

## 8. Camera & arena

- Side-view 2D, arena-bounded (no ring-outs). Boss arenas are flat with
  occasional hazard zones (Radahn's arena scale, Haligtree rot pools) — arena
  features are per-boss data, not engine features.
- Camera: smoothed follow with lookahead toward the boss; screen shake budgeted
  (accessibility toggle).

## 9. What this spec deliberately excludes (v1)

- Parry/riposte (high animation cost; posture break covers the fantasy).
- Weapon arts / ashes of war.
- Status effects beyond Malenia's scarlet rot (per-boss special, see BOSS_AI).
- Difficulty settings — adaptation *is* the difficulty system.
