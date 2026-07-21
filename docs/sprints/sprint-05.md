# Sprint 5 — Win, Lose, Earn

- **Dates:** 2026-07-21 → 2026-07-28 (1 week)
- **Sprint goal:** *A fight against Margit ends — win or die — and that outcome
  is real: runes are earned and persisted, region unlock is set on a kill, and
  the attempt is recorded, all through a server-validated write path. The save
  spine built in Sprint 4 gets its first thing worth saving.*

## Why this goal

Sprint 4 built the account/persistence spine but deliberately left it inert —
`player_stats` and `player_progress` are populated with defaults and otherwise
untouched; nothing in the game currently *writes* to them. Right now a fight
against Margit can be won or lost in the sandbox and nothing happens: no
resolution screen, no reward, no record. That's the last gap before the MVP
loop (PRD §6: "sign in → fight → win/lose → runes → spend → re-fight
differently") is even partially real, and it's a hard prerequisite for both
remaining MVP tickets — #12 (stat spend) has nothing to spend until runes
exist, and #13 (LLM recap) has nothing to read until attempt logs are real
rows, not test fixtures.

This sprint also has to reckon with a decision Sprint 4's review forced:
`player_stats`/`player_progress` are **client-read-only** (ADR-0003) precisely
to close the "PATCH your own runes to a billion" hole. So win/lose can't be a
client-side `UPDATE` — it has to go through a **SECURITY DEFINER RPC**
(`resolve_attempt`, or similar) that validates the transition server-side:
confirm the requesting user owns the attempt, compute the reward from boss
kill/death per the documented rule, and atomically write the rune delta,
region-unlock flag, and the attempt_log row in one transaction. That RPC is
new schema/security surface, not just game logic — sized accordingly.

## Committed scope

- [ ] **#11** Win/lose resolution + rune reward — size L, p1
      *Boss death or player death ends the attempt cleanly and triggers a
      resolution screen; on a kill, rune reward is computed and persisted and
      the region-unlock flag is set; on a death, the outcome is persisted with
      no rune loss; the attempt log (combat decision events, BOSS_AI.md §8) is
      finalized and stored, available for #13's recap later. All state
      mutation goes through a SECURITY DEFINER RPC, proven by the same
      cross-user-isolation discipline as Sprint 4's RLS suite — a user can
      only resolve their own attempts, and the RPC's logic (not client input)
      decides the reward.*

## Definition of Done (per issue, from SDLC §7)

- `CombatScene` detects both terminal states (boss HP → 0, player HP → 0) and
  emits the existing `fight:outcome` bridge event (currently defined in
  `bridge.ts` but never emitted — this sprint wires it up) with the real
  result, duration, and rune delta.
- A resolution screen (React, outside the Phaser canvas per ADR-0001) shows
  win/lose and the rune delta, with a way to return to `/play`.
- The reward/unlock/log write happens through one `resolve_attempt` Postgres
  RPC (`security definer`), migrated in, never a direct client `UPDATE` —
  consistent with ADR-0003's read-only-authoritative-state rule.
- RLS/RPC integration test (extending `supabase/tests/rls.test.ts` or a new
  file in the same suite) proves: a user cannot resolve another user's
  attempt; a fabricated/oversized rune delta from the client is ignored (the
  RPC computes the reward, not the caller); calling it twice for the same
  attempt doesn't double-pay.
- Unit tests for the reward-computation function (pure, engine-agnostic, per
  CLAUDE.md's "keep game logic engine-agnostic" rule) — no Phaser or Supabase
  in the test.
- Docs: `docs/design/BOSS_AI.md` §8 stays accurate to whatever the finalized
  attempt-log shape actually is once it's implemented; ADR-0003 gets a short
  note that RPCs are now the established mutation pattern for authoritative
  state (the convention section added in Sprint 4 currently only covers
  reads/grants).
- CI green; `/code-review` before merge — this sprint adds a new privileged
  RPC, which is exactly the kind of surface that warrants it.

## Out of scope (explicitly)

- Stat spend UI / character sheet (#12) — reward path lands first; spending
  it is next sprint.
- LLM post-death recap (#13) — needs real attempt-log rows to exist first;
  this sprint produces them but doesn't read them.
- Flask heals, posture break/crit polish — combat-feel items, not blocking
  the resolution/persistence loop.
- Any change to boss AI/adaptation logic (Sprints 2-3) — this sprint only
  adds an ending to the fight, not new behavior during it.

## Risks / watch-fors

- **New privileged-write surface.** This is the first SECURITY DEFINER RPC
  since the signup trigger — same trust level as touching auth, and the same
  "prove it with a real cross-user test against real Postgres" discipline
  from Sprint 4 applies, not just unit tests against mocked Supabase calls.
- **Double-resolution / replay risk.** Without care, a page refresh or a
  retried request after a dropped connection could resolve the same attempt
  twice (double rune payout). The RPC needs an idempotency guard (e.g. an
  attempt identifier that can only be resolved once) — name this explicitly
  in the RPC's own design, don't discover it in review.
- ~~Local Docker is still broken~~ **Resolved 07-21**, before this sprint's
  build work started — Docker Desktop's earlier corruption cleared on its own
  after a restart. Local Supabase now works for real iteration, not just CI.

## Daily check-ins
- **07-21:** #11 built — CombatScene detects boss/player HP hitting 0,
  freezes the sim, and emits the (already-defined but previously never fired)
  `fight:outcome` bridge event. A resolution overlay in `GameCanvas` calls the
  new `resolve_attempt` RPC (`supabase/migrations`) and shows the real
  persisted reward once it responds. Reward computation itself is a pure
  `computeRuneReward()` (engine-agnostic, unit-tested) used only for the
  optimistic client-side estimate — the RPC is the authoritative source,
  computed from a new data-driven `bosses` table (id → region → reward), so
  bosses #2-4 only ever need an INSERT there, never an RPC change.
  Idempotent via the client-generated attempt id as the dedupe key. Writing
  the RPC's own integration test caught a real cross-user data-leak bug
  before merge — reusing another user's attempt id would have returned
  *their* rune total through the RPC's return value, since SECURITY DEFINER
  bypasses RLS and the replay-lookup branch wasn't scoped to the caller;
  fixed by scoping that lookup to `auth.uid()` and rejecting the reuse
  outright. Verified end-to-end in a real browser against a real local
  Postgres — both win and lose paths, correct reward/region-unlock, confirmed
  against the database directly, not just the UI. Local Docker being fixed
  today made this whole loop fast — no CI round-trips needed to iterate.

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
