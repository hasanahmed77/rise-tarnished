# Architecture — Rise, Tarnished

> Status: v1 draft · Change via PR. Decisions with long-term consequences get an
> ADR in `docs/adr/`; this doc is the current-state overview.

## 1. System overview

```
                          ┌────────────────────────────────────────┐
                          │              Browser (client)           │
                          │                                         │
   Google OAuth ──────────┤  Next.js app shell                      │
                          │   • menus, character sheet, region map  │
                          │   • run stats, win/lose screens         │
                          │                                         │
                          │  Phaser game canvas (mounted in a       │
                          │  Next.js client component)              │
                          │   • rendering, physics, hitbox/hurtbox  │
                          │   • input handling                      │
                          │        │                                │
                          │        ▼                                │
                          │  ┌──────────────────────────────────┐   │
                          │  │ Engine-agnostic game logic (TS)  │   │
                          │  │  • Boss HFSM (phase/tactic/action│   │
                          │  │    — see design/BOSS_AI.md)      │   │
                          │  │  • Combat model: stamina, poise, │   │
                          │  │    frame data (COMBAT_SYSTEM.md) │   │
                          │  │  • Stat scaling / damage math    │   │
                          │  │  • Rune economy                  │   │
                          │  │  • Player-behavior tracker       │   │
                          │  │  ↑ pure, unit-tested, no Phaser  │   │
                          │  └──────────────────────────────────┘   │
                          └───────────┬─────────────────┬───────────┘
                                      │                 │
                        (persist)     │                 │  (async, non-blocking)
                                      ▼                 ▼
                     ┌────────────────────────┐   ┌──────────────────────┐
                     │ Supabase               │   │ Next.js Route Handler│
                     │  • Auth (Google OAuth) │   │  (server-side)       │
                     │  • Postgres            │   │   proxies OpenAI     │
                     │    stats, builds,      │   │   • post-death recap │
                     │    progress, logs      │   │   • move reweighting │
                     └────────────────────────┘   └──────────┬───────────┘
                                                             ▼
                                                     ┌──────────────┐
                                                     │  OpenAI API  │
                                                     └──────────────┘
```

## 2. Components & responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| **Next.js shell** | Auth, navigation, menus, character sheet, stats UI, screens | Server components where possible; game canvas is a client component |
| **Phaser scene** | Rendering, animation, physics, hitbox/hurtbox, input | Thin — delegates *decisions* to game-logic modules |
| **Game logic (TS)** | FSM, stat math, economy, behavior tracking | **No Phaser imports.** Pure functions + small state machines. This is the heavily-tested layer |
| **Supabase** | Google OAuth, Postgres persistence | Row-Level Security on all user data |
| **Route handlers** | Server-side OpenAI proxy | Keeps the OpenAI key off the client; also where we mock in tests |
| **OpenAI** | Async only: post-death recap, move reweighting | Never in the combat loop |

## 3. The critical boundary: logic vs. engine

The single most important architectural rule (see `CLAUDE.md`): **game logic must
not depend on Phaser.** Phaser calls *into* pure logic each frame and applies the
result to sprites; it never embeds decision-making.

```ts
// good — testable without a browser or Phaser
const decision = bossFsm.next(bossState, playerBehavior, rng);
phaserSprite.play(decision.animation);

// bad — decision logic entangled with rendering, untestable
if (this.sprite.anims.currentAnim.key === 'idle' && Math.random() > 0.5) { ... }
```

This is what makes success-criterion S5 (≥80% coverage on core logic) achievable.

## 4. Real-time vs. async AI

- **Real-time (in-engine FSM):** every frame-level boss decision. Deterministic
  given (state, behavior signals, seeded RNG) — which also makes it testable and
  reproducible. See ADR-0002.
- **Async (OpenAI, server-side):** runs *between* fights or after death. Latency
  and cost are acceptable there; failures degrade gracefully (a missing recap
  never blocks gameplay).

## 5. Data flow — one attempt

1. Player signs in (Supabase) → stats/progress loaded from Postgres.
2. Fight starts. Each frame: input → behavior tracker → FSM → boss action.
3. Combat events appended to an in-memory attempt log.
4. On death/victory: outcome + rune delta persisted; attempt log sent to the
   server route → OpenAI → recap shown (async, non-blocking).
5. Player spends runes → stat changes persisted → next attempt loads new scaling.

## 6. Cross-cutting concerns

- **Secrets:** OpenAI key server-side only; Supabase anon key client, service key
  server. Never committed.
- **Determinism/testing:** seedable RNG so combat and FSM behavior are
  reproducible in tests and bug reports.
- **Performance:** 60fps combat budget (S4). Profile before optimizing.
- **Error handling:** async AI is best-effort; the game is fully playable if
  OpenAI is down.
