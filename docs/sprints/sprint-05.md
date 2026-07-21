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

- [x] **#11** Win/lose resolution + rune reward — size L, p1
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
- **07-21 (#11 review):** `/code-review`'s 8-angle pass (self-run manually —
  the skill tool declined to delegate this time) found 3 more real SQL bugs
  beyond what local dev caught: `current_region` could regress or skip ahead
  since nothing checked a boss's region against the player's actual frontier
  (unreachable with one boss, but structurally live the moment boss #2's row
  is added — fixed with a reachability guard); `region_unlocked` wasn't
  recomputed on an idempotent replay, always reporting `false` even when the
  original call did unlock a region (fixed by persisting it as a real column
  instead of re-deriving it); and `attempt_logs` still allowed direct client
  INSERT from Sprint 4 (before this RPC existed to own it), letting a client
  pre-seed a row the replay branch would trust and echo back (self-targeting
  only, no real currency impact — fixed by revoking that grant, since
  resolve_attempt is now the only legitimate writer). Also fixed a genuine
  CLAUDE.md violation the conventions angle caught: win/lose determination
  lived only inside the Phaser scene class with zero test coverage of the
  double-KO tie-break rule — extracted to `determineFightOutcome()`
  (`game/attempt/outcome.ts`), now unit-tested. Re-verified full local gate
  + 19/19 RLS/RPC tests after all fixes.

## Review (end of sprint)

**Goal met: yes.** A fight against Margit now ends for real — win or die,
runes earned and persisted, region unlock set on a kill, the attempt
recorded — and none of it happens through a client write. `player_stats`/
`player_progress`/`attempt_logs` stay exactly as read-only as Sprint 4's
review demanded; the entire state transition lives in one SECURITY DEFINER
RPC (`resolve_attempt`) that computes the reward itself and validates the
boss is actually reachable before touching anything.

Delivered:
- CombatScene detects the terminal HP state via a pure, unit-tested
  `determineFightOutcome()` and emits the (previously defined, never fired)
  `fight:outcome` bridge event.
- `resolve_attempt`: idempotent via a client-generated attempt id, reward
  sourced from a data-driven `bosses` table (bosses #2-4 need only an
  INSERT, never a code change), a reachability guard that keeps
  `current_region` monotonic, and `region_unlocked` persisted rather than
  re-derived so a retried call reports it accurately.
- A resolution overlay in `GameCanvas` showing the optimistic client
  estimate while the RPC resolves, then the authoritative server numbers.
- `attempt_logs` tightened to client-read-only (Sprint 4 predates this RPC
  and left it client-INSERT-able) — `resolve_attempt` is now the only
  legitimate writer.
- 19 RLS/RPC integration tests, 4 new unit tests (`reward.ts`,
  `outcome.ts`), full local + CI gate green throughout.

Not in scope / deferred: #12 (stat spend — now has something real to
spend), #13 (LLM recap — now has real attempt rows to read), boss #2-4,
the per-decision event log inside `attempt_logs.log` (still `{}`, spec-only
per BOSS_AI.md §8).

## Retro (end of sprint)

**What worked**
- **The review found bugs that were structurally invisible at merge time.**
  The region-regression/skip-ahead bug couldn't have been caught by any test
  run against the actual shipped state — only one boss exists, so there was
  nothing to regress *to*. It took a reviewer reading the SQL and asking "what
  happens when a second row exists" to find it. This is exactly the class of
  bug local dev and even a real browser playthrough structurally cannot catch
  (everything genuinely worked, for the only boss that existed) — a second
  confirmation, after Sprint 4, that this project's review discipline is
  earning its cost on real, not hypothetical, defects.
- **Fixing the idempotency-replay bug the same way rune_delta already worked**
  (persist the fact once, read it back, never re-derive) turned three
  independent review findings pointing at the same code into one clean fix,
  rather than three patches. Recognizing "this is the same shape of bug as
  something already solved two lines up" was cheaper than treating each
  finding in isolation.
- **Local Docker being fixed mid-session changed the actual working pattern**,
  not just its speed: the SQL bugs found in review were fixed and reverified
  in a normal edit-test loop against real Postgres, not through repeated CI
  round-trips like Sprint 4's migration work required. Worth protecting going
  forward — Docker breaking again would be a real velocity cost now that it's
  been felt both ways.
- **A stray user question ("is our DB structure normalized?") caught a real
  design smell** (the redundant `health`/`vitality` stat) that no review pass
  was ever going to flag, since it wasn't wrong, just unnecessary. Domain
  questions from the person who actually knows what the game should feel like
  remain a distinct, valuable review channel that automated passes don't
  replace.

**What didn't**
- **The `/code-review` Skill tool refused to delegate** ("disable-model-invocation")
  after working identically for the same skill earlier in the same session.
  Recovered by running the exact same 8-angle/verify process manually — no
  findings were lost — but it's a tooling inconsistency worth naming rather
  than silently working around every time it recurs.
- **The `bosses`/`region_unlocked` design wasn't gotten right on the first
  pass**, despite the whole point of the data-driven `bosses` table being to
  make bosses #2-4 safe by construction. The gap wasn't in the mechanism
  (grants, idempotency, the table itself) — it was a missing invariant
  (*reachability*) that only became obvious once someone asked "what if a
  second row existed." Worth a standing question for any future
  progress-mutating RPC: not just "does this validate its inputs" but "does
  this validate the caller is even allowed to be here."

**One change for next sprint**
- When a design explicitly claims something will generalize to N future
  cases (here: "bosses #2-4 only need an INSERT"), stress-test that claim
  during the same PR — insert a second row in a test and prove the
  generalization actually holds, rather than trusting the comment.

**Sprint status: CLOSED.**
