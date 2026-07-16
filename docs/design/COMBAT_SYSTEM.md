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
| **Vitality** | +max HP (+6/pt) | +poise (+0.5/pt) | 40 |
| **Health**¹ | +flask potency (+2%/pt) | +stamina (+2/pt) | 30 |
| **Dexterity** | +light-weapon scaling | +1 i-frame per 8 pts (max +4) | 45 |
| **Intelligence** | +sorcery scaling | +max FP (+3/pt) | 45 |

¹ Working name per the proposal; consider renaming to *Endurance/Mind* split
later — flagged as PRD open question.

**Damage formula (v1):**

```
damage = weapon_base × (1 + scaling_coeff × softcap(stat)) × type_modifier
softcap(s) = s ≤ cap ? s/cap : 1 + 0.3 × (s - cap)/cap   (normalized)
```

Pure function, unit-tested, lives in the logic layer. Exact curves are tuning
targets, not architecture.

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
