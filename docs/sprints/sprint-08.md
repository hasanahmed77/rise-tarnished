# Sprint 8 — Tell Me Why I Died

- **Dates:** 2026-08-11 → 2026-08-18 (1 week)
- **Sprint goal:** *A player dies and is told, specifically and truthfully, what
  killed them and why the boss chose it — grounded in the boss's own recorded
  decisions, not a generic tip. "Margit read your panic-rolls," not "try dodging
  more."*

## Why this goal

**#13 is the last unshipped line in PRD §6's MVP list.** Sign-in, the full
combat model, the adaptive AI, win/lose resolution, rune reward, stat spend and
persistence all exist. When the recap lands, the MVP loop closes and every
pillar the PRD promised is real. That makes this the sprint that finishes the
product, and it should be scoped as carefully as that deserves.

It is also **the sprint that decides two of the five success criteria**. PRD §5
S3 ("post-death breakdown quality — ≥4/5 playtesters rate it *specific &
useful*") is entirely about this feature, and G4 is the goal it serves. S3 is a
human judgement, which is why the playtest debt below is committed scope rather
than a nice-to-have.

**#13 has a prerequisite that was never ticketed, and it is the real work.**
BOSS_AI.md §8 says so directly: the per-decision event log *"is still the spec,
not yet collected; it stays `{}` until the L2/L3 decision points actually emit
into it. That's #13's prerequisite."* `resolve_attempt` today writes six columns
and `log` is not among them. So a recap built now would have nothing true to be
specific about, and the model would fill the gap by inventing — which is exactly
the failure mode G4 exists to prevent. #55 is therefore sequenced first and is
the larger half of this sprint.

## Committed scope

- [ ] **#55** Per-decision event log into `attempt_logs.log` — size M, p1
      *L2/L3 emit `{tick, layer, chose, becauseSignals, playerStateSnapshot}`
      per BOSS_AI.md §8, bounded to decisions rather than ticks, persisted
      through a new `p_log jsonb` parameter on `resolve_attempt`. Deterministic,
      fairness suite unchanged, frame budget untouched.*
- [ ] **#13** Post-death LLM recap (server route) — size M, p1
      *A server-side route handler that proxies the model with the key never
      reaching the client, reads the attempt log, and returns a short recap
      naming the killing move and the signal that selected it. Async and
      non-blocking — a slow or failed recap never blocks the resolution screen.
      Provider mocked in CI, never live.*
- [ ] **#12** Close it — the `docs/playtests/` note — size S, p1, **human-blocked**
      *Dex, vit and int each clear Margit. Open since Sprint 6, blocked on a real
      Google sign-in that automation cannot complete. Committed here as scope,
      not carried silently for a fourth sprint.*

Sequenced #55 → #13 → #12. The recap cannot be specific until the log exists,
and the playtest wants a build worth playtesting.

## Definition of Done (per issue, from SDLC §7)

- **The recap is grounded, and that is enforced, not hoped for.** The killing
  move id and at least one real `becauseSignals` entry from the attempt log must
  appear in the model's input, and a contract test asserts the route rejects or
  flags a response that names a move which never occurred in that fight. An
  ungrounded recap is worse than no recap — it teaches the player something
  false about a system that is actually deterministic and legible.
- The API key is server-only. No `NEXT_PUBLIC_` prefix, never in a client
  bundle, never in the attempt payload. A test asserts the client bundle does
  not contain it.
- **Non-blocking by construction, not by timeout tuning.** The resolution screen
  renders and is fully interactive with the recap absent; the recap arrives
  later or never. A dead provider must degrade to silence, not to a spinner that
  outlives the player's patience.
- Provider calls are mocked/contract-tested in CI and never hit a live API
  (issue #13's own criterion, and a cost/flakiness gate).
- #55's emission keeps the sim deterministic — `fairness.property.test.ts`
  passes unchanged, as it did for #40's projectile — and holds the frame budget
  (PRD §5 S4).
- The event log is **bounded and asserted so**. Emit on tactic *changes* and move
  *selections*, never per tick. A test pins an upper bound on events per fight;
  a 3-minute fight yields tens of events, not ~10,800.
- `resolve_attempt`'s idempotency guard still holds with the new parameter: a
  retried call must not double-write or corrupt the log.
- **ADR-0004 records the provider decision** — which model, why, how the key is
  handled, how failure degrades, and how it is mocked. This repo has an ADR for
  the Phaser boundary, the AI architecture and the data layer; a third-party
  dependency in the request path with a spend attached belongs in the same
  record. Issue #13 names OpenAI; that is a decision to confirm and write down,
  not inherit silently.
- Docs updated in the same PR: BOSS_AI.md §8's status line changes from "still
  the spec" to shipped, PRD §8's open questions updated if the provider choice
  resolves one.
- CI green; `/code-review` before merge on both PRs — a new privileged RPC
  parameter and a new external network dependency are exactly the surfaces
  prior reviews found live bugs in.

## Out of scope (explicitly)

- **#56** (settings surface) — ticketed this sprint, deliberately *not* committed
  to it. Sprint 7's retro found that four unplanned items shipped with nothing
  dropped to make room; declining a small, tempting, unrelated ticket is the
  first test of whether that finding changed anything.
- **#14** (bot harness) — size L spike. It would prove S2 in CI, which is
  valuable, but pairing a size-L spike with a greenfield external integration is
  how Sprint 6 became a twelve-day week.
- **#20** (input buffering) — polish, no dependency on this sprint.
- Per-attempt move-sequence reweighting via LLM (PRD "Later"). This sprint reads
  the log to *explain*; it does not feed it back to *change* boss behaviour.
- Deterministic replay and balance telemetry. #55 unlocks both for free per
  BOSS_AI.md §8, but building either is separate work.
- Bosses #2-4, and the remaining three regions' backdrops.

## Risks / watch-fors

- **The model will happily lie, and a confident lie is the worst outcome here.**
  This is the sprint's central risk and the reason the grounding assertion is in
  the DoD rather than the backlog. The recap's whole value proposition is that
  this boss's decisions are *actually* legible — every tactic switch has a
  recorded reason. A plausible invented explanation destroys that credibility
  more thoroughly than a missing recap would, and a playtester cannot tell the
  difference. Ground it, then verify the grounding.
- **Prompt size grows with fight length.** Even bounded to decisions, a long
  attrition fight logs more than a fast one. Decide the truncation rule
  deliberately — the killing blow and the last N decisions are worth more than
  the opening minute — rather than discovering it as a context-limit error on the
  one fight a playtester cares about.
- **S3 needs five playtesters, and so does S2 and #12.** All three depend on the
  same unscheduled activity. Sprint 6's retro found that three of its four risks
  hinged on a playtest that never happened; that pattern repeats here unless the
  playtest is booked early. **Book it in the first half of the sprint, not the
  second.** This is the fourth sprint carrying this debt.
- **New failure modes are external and non-deterministic** — rate limits,
  timeouts, malformed responses, provider outages. The sim has been deterministic
  and offline for eight sprints; this is the first dependency that can fail for
  reasons no test controls. Treat every provider response as untrusted input.
- **Cost is real, if small.** A per-death API call has a bill attached. Worth a
  sanity check on expected volume and a note in ADR-0004, not a surprise later.
- **`resolve_attempt` is being changed, and it is the project's most
  safety-critical function.** It is SECURITY DEFINER, it is the sole writer to
  three tables, and prior reviews found live bugs in it twice (the region
  skip-ahead and the idempotency replay). Adding a parameter is low risk; adding
  a parameter carelessly is not.

## Process changes carried in from the Sprint 6 and 7 retros

Both retros were written on 2026-08-11, late, and both found process failures
rather than only technical ones. Carrying them forward explicitly so they are
testable at this sprint's close:

1. **Write the review and retro before the next plan merges.** Sprint 6 was never
   closed because Sprint 7's plan landed the same day its last PR did. This plan
   merges *after* both were written — the first time that ordering has held.
2. **Escalate human-only blockers as decisions, not check-in lines.** #12's
   playtest was correctly identified as blocked on 2026-08-02 and then simply
   logged. It is committed scope now.
3. **Re-read the DoD at each merge, not only when writing it.** Sprint 7 breached
   its own "no combat-logic change" constraint and nobody noticed for a week.
4. **Tick the boxes.** #40 was complete on 08-02 and stayed open until 08-11
   because nobody ticked anything.

## Daily check-ins

_(none yet)_

## Review (end of sprint)
_(pending)_

## Retro (end of sprint)
_(pending)_
