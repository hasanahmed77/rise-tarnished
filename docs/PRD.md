# Product Requirements Document — Rise, Tarnished

> Status: v1 draft · Owner: (you) · Last updated: 2026-07-16
> This is a living doc. Change it via PR like code.

## 1. Problem & vision

Boss fights are the emotional peak of Soulslike games, but they're buried behind
hours of traversal, leveling, and world content. **Rise, Tarnished distills the
genre to its core: pure, escalating boss duels** where mastery — not grinding —
is the path forward. A player should feel the same "I finally got them" catharsis
of a Soulslike boss kill, in a session measured in minutes, in the browser.

The differentiator is **an AI that refuses to let you win the same way twice.**
Bosses adapt to your recent behavior in real time, and reweight their move
sequencing between attempts — so a memorized combo pattern stops working.

## 2. Target player

- Enjoys Soulslike combat but is time-constrained or bounces off open-world grind.
- Wants a skill-expression challenge, not a power-fantasy.
- Plays on desktop browser (mouse+keyboard or gamepad). Mobile is a non-goal for v1.

## 3. Goals (what success looks like)

- **G1 — Combat feels fair but punishing.** Deaths feel earned, not cheap.
- **G2 — Adaptation is *perceptible*.** A playtester can articulate "the boss
  started punishing my dodge-spam." If adaptation is invisible, the core
  premise failed.
- **G3 — The full loop is real end-to-end** for at least one boss before we add
  breadth: sign in → fight → win/lose → runes → spend → re-fight differently.
- **G4 — Post-death breakdown is specific**, not generic ("You died to Margit's
  delayed overhead after three consecutive rolls" — not "try dodging more").

## 4. Non-goals (v1)

- Multiplayer / co-op / PvP.
- Mobile or touch controls.
- Procedural bosses or a boss editor.
- More than the four canonical bosses.
- Open-world traversal, NPCs, dialogue trees, inventory beyond weapons/stats.
- Monetization.

## 5. Success criteria (measurable)

| # | Criterion | Target |
|---|-----------|--------|
| S1 | First boss playable end-to-end | Sprint goal met, demoable |
| S2 | Adaptation perceptibility | ≥3/5 playtesters name the adaptation unprompted |
| S3 | Post-death breakdown quality | ≥4/5 playtesters rate it "specific & useful" |
| S4 | Frame budget in combat | Combat loop holds 60fps on mid-tier laptop |
| S5 | Test coverage on core logic | Game-logic modules (FSM, stats, economy) ≥80% |

## 6. Feature scope

### MVP (must-have for a vertical slice)
- Google OAuth sign-in (Supabase).
- One boss (Margit) fully playable with the full souls-like combat model:
  stamina economy, dodge i-frames, commitment-based frame data, poise/stagger,
  posture break + critical hit, flask heals (spec: `design/COMBAT_SYSTEM.md`).
- Real-time hierarchical (phase/tactic/action) boss AI that reacts to player
  behavior under fairness invariants (spec: `design/BOSS_AI.md`).
- Win/lose resolution + rune reward.
- Stat spend (vitality/health/dexterity/intelligence) affecting the next fight.
- Post-death LLM breakdown.
- Persistence of stats/progress in Postgres.

### Later (breadth, after the slice proves out)
- Remaining three bosses (Radahn, Malenia, Radagon/Elden Beast).
- Per-attempt move-sequence reweighting via LLM.
- Weapon variety and build-defining loot.
- Run statistics / history UI.

## 7. Key user stories (MVP)

- *As a player, I sign in with Google so my progress persists across sessions.*
- *As a player, I fight Margit and the boss adapts when I spam one tactic, so
  every attempt demands new decisions.*
- *As a player, when I die I get a short, specific explanation of what killed me,
  so I know what to change.*
- *As a player, I spend runes on stats and feel the next attempt play differently.*

## 8. Open questions

- ~~Input~~ **Resolved:** keyboard+mouse for MVP; gamepad post-MVP
  (`design/COMBAT_SYSTEM.md` §7).
- Art: placeholder primitives vs. sourced sprites for the slice? (Affects feel
  testing — combat feel is hard to judge with boxes.)
- ~~Behavior signals~~ **Resolved:** seven signals specified in
  `design/BOSS_AI.md` §5.
- Stat naming: proposal's "health" stat overlaps with HP; consider
  Endurance/Mind split (`design/COMBAT_SYSTEM.md` §6).
