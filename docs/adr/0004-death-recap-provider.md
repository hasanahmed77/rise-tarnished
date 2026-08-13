# ADR-0004: LLM provider for the post-death recap

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** (you)

## Context

Issue #13 (PRD G4, success criterion S3) asks for a short, specific recap of
why the player died — "Margit read your panic-rolls," not "try dodging more."
BOSS_AI.md §8 and #55 (merged) give this a real foundation: every L2/L3
decision the boss made is now recorded, with the top-2 signals behind it, in
`attempt_logs.log`. That data makes a *grounded* recap possible for the first
time — the recap can be built from what the boss actually decided, not from a
model guessing at a genre.

This is the project's first outbound network dependency in the request path,
and the first non-deterministic one. Every other system in `rise-tarnished`
is offline, seeded, and testable without a mock. ADR-0002 chose a weighted FSM
specifically to avoid an LLM being *load-bearing* for gameplay — a live
network call is far too slow for a 60Hz loop. That reasoning still holds here:
this ADR is only about the flavor-text feature on the death screen, not a
reopening of ADR-0002. The recap is enrichment; if it never arrives, the game
is unaffected (see the Definition of Done's "non-blocking by construction").

The ticket's own text names OpenAI. That's an inherited default from when #13
was filed, not yet a confirmed decision — this ADR is where it gets confirmed
or changed, per Sprint 8's plan.

## Decision

Use **OpenAI's Chat Completions API**, called via a plain `fetch()` from a
server-only Next.js route handler — **no SDK dependency.**

- **Model: `gpt-4o-mini`**, chosen for cost and latency on a task that is
  short input, short output, and not reasoning-heavy: turning a handful of
  structured decision records into one or two sentences. The model string
  lives in one constant (`RECAP_MODEL` in `src/app/api/recap/route.ts`), not
  scattered through the request-building code, so a future swap is a one-line
  change rather than an archaeology exercise.
- **No `openai` npm package.** The Chat Completions request/response shape is
  a few well-documented JSON fields, and every other generated-content system
  in this project (pixel art, audio) was built dependency-free on the same
  reasoning: fewer transitive dependencies to audit, and — the part that
  actually matters here — a bare `fetch()` is trivial to intercept in a test
  by mocking the global, whereas mocking an SDK client means mocking its
  internal transport or its whole module shape. The DoD requires every
  provider call to be mocked in CI and never hit the live API; `fetch` makes
  that assertion cheap to write and cheap to trust.
- **The key is server-only environment config: `OPENAI_API_KEY`.** No
  `NEXT_PUBLIC_` prefix — Next.js inlines anything with that prefix into the
  client bundle at build time (`.env.example` already documents this
  convention for the Supabase keys), so the naming alone is what keeps this
  key off the client. The route handler is the only file that reads it.
- **Failure degrades to absence, not to an error the player sees.** A missing
  key, a timeout, a non-2xx response, a malformed body, or a response that
  fails grounding validation (below) all produce the same client-visible
  outcome: no recap. The resolution screen never blocks on it and never shows
  a spinner waiting for it — see the DoD's "non-blocking by construction, not
  by timeout tuning."
- **Grounding is enforced before a response ever reaches the player.** The
  route builds the prompt from the attempt's own `decisionLog` (re-fetched
  server-side by attempt id, under the caller's own RLS-scoped session —
  never from a client-submitted payload, since that would reopen exactly the
  injection surface #55's migration sanitizes against) and then checks the
  model's response for any move or tactic name that is a real
  `MoveDef`/`Tactic` id but was **not** among the moves/tactics this attempt's
  log actually recorded. A response that fails that check is treated as a
  failure — logged, discarded, never shown. An invented-but-plausible
  explanation is worse than no recap: it teaches the player something false
  about a system that is genuinely deterministic and legible, and a
  playtester has no way to tell a grounded recap from a fabricated one.
- **Mocking in CI:** the route's provider call is a single injectable
  function; the test suite replaces it with a fixture responder and asserts
  the route's behavior (prompt construction, grounding rejection, non-2xx
  handling) without any network access. `npm test` — the fast, hermetic suite
  — must never require `OPENAI_API_KEY` to pass, matching #13's own
  acceptance criterion.

## Alternatives considered

- **Anthropic (Claude) instead of OpenAI.** Equally viable technically —
  same "small, cheap, short-output" shape fits Claude Haiku just as well. Not
  chosen only because the ticket already named OpenAI and there is no
  functional reason in this codebase to override that default; the design
  here (bare `fetch`, one model constant, an injectable call site) has no
  provider lock-in, so switching later is a small, isolated change, not a
  rearchitecture.
- **The `openai` SDK.** Rejected for the mocking and dependency-surface
  reasons above. The SDK's retry/streaming machinery is aimed at
  interactive chat UIs; this route makes one short, non-streamed call.
- **A larger/more capable model (e.g., a full-size flagship model).** Rejected
  on cost and latency for no benefit this task can use — the input is a
  handful of structured records and the desired output is one or two plain
  sentences, not a task that benefits from extra reasoning depth. Revisit if
  playtesting (S3) finds the small model's recaps genuinely weak, not before.
- **Running inference locally / self-hosted.** Rejected: real engineering
  cost for a course-project timeline, no clear win over a cheap hosted model
  for this task's size, and it would reintroduce exactly the kind of
  operational surface the generated-art/audio decisions were made to avoid.
- **Skipping grounding validation and trusting the prompt to constrain the
  model.** Rejected — a system prompt lowers the *rate* of invention, it
  does not bound it, and #13's whole value proposition depends on the recap
  being trustworthy every time, not most of the time.

## Consequences

- **Positive:** #13 can proceed with a concrete, narrow integration surface —
  one route, one outbound call, one constant to change if the model needs to
  change. The grounding check makes "the recap might be lying" a tested,
  closed question rather than an open risk carried into playtesting.
- **Negative / trade-offs:** This is the project's first dependency on
  something outside its own control — provider outages, rate limits, and
  pricing/model deprecation are now real, if low-stakes, risks. A per-death
  API call has a small but real cost; volume should be sanity-checked once
  real usage exists (Sprint 8's risk log already flags this).
- **Follow-ups:** `OPENAI_API_KEY` needs to be set in Vercel project
  settings for a real deploy (same pattern as the Supabase keys, but this one
  is *not* `NEXT_PUBLIC_`, so it only needs the server-side runtime env, not a
  build-time one). If S3's playtesting finds `gpt-4o-mini`'s recaps weak,
  swap `RECAP_MODEL` — no other code should need to change.
