# SDLC & Process — Rise, Tarnished

> How we work. Solo dev operating as a world-class product team: the process is
> enforced by tooling (CI, PR gates, board automation), not willpower.

## 1. Methodology

**Scrumban** — Scrum's cadence and ceremonies (adapted for solo), Kanban's flow
and WIP discipline.

- **Sprint length:** 1 week. Short cycles keep scope drift visible.
- **WIP limit:** 1 item In Progress at a time. Finish before starting.
- **One sprint = one goal.** If a ticket doesn't serve the sprint goal, it waits.

## 2. Board — GitHub Projects + Issues

Board columns (Projects, board layout):

| Column | Meaning |
|--------|---------|
| **Backlog** | Everything not yet scheduled |
| **Sprint** | Committed to the current sprint |
| **In Progress** | Actively being worked (WIP limit: 1) |
| **In Review** | PR open, CI running / self-review via `/code-review` |
| **Done** | Merged, CI green, Definition of Done met |

- **Every unit of work is a GitHub Issue.** No untracked work.
- **Every Issue is closed by a PR** (`Closes #NN`), never manually.
- Issues carry: a clear title, acceptance criteria, and labels.

### Labels
- Type: `feature` · `bug` · `chore` · `docs` · `spike`
- Area: `area:engine` · `area:ui` · `area:ai` · `area:db` · `area:infra`
- Priority: `p0` (blocker) · `p1` · `p2`
- Size: `xs` · `s` · `m` · `l` (relative effort, not hours)

## 3. Ceremonies (solo-adapted, written)

Written artifacts replace the team conversation — they're what keep a solo dev
honest, since no one else catches drift.

- **Sprint Planning** (start): write `docs/sprints/sprint-NN.md` — the one goal,
  the committed issues, and why. Commit it.
- **Daily check-in** (async): a one-line note in the sprint file — what moved,
  what's blocked.
- **Sprint Review** (end): does the increment meet the sprint goal? Demo/record it.
- **Retro** (end): append to the sprint file — what worked, what didn't, one
  change for next sprint. This is non-optional.

## 4. Branching & PRs

**Trunk-based.** `main` is always releasable and protected.

- Branch naming: `feat/NN-short-slug`, `fix/NN-...`, `chore/NN-...` (NN = issue).
- One logical change per PR. Small PRs > big PRs.
- **Self-review with `/code-review` before requesting merge** — it's the second
  engineer. Address findings.
- PR description links the issue (`Closes #NN`) and states how it was tested.
- Squash-merge to keep `main` history linear.
- **No direct commits to `main`.** Enforce via branch protection.

## 5. CI gates (must be green to merge)

GitHub Actions on every PR:

1. **Lint** — ESLint, no errors.
2. **Typecheck** — `tsc --noEmit`, strict mode.
3. **Unit tests** — Vitest.
4. **Build** — `next build` succeeds.
5. (later) **E2E** — Playwright smoke test on the core loop.
6. Vercel preview deploy per PR for manual verification.

A red pipeline blocks merge. No exceptions, no "fix it after."

## 6. Definition of Ready (before a ticket enters a Sprint)

- Clear title + acceptance criteria.
- Sized and labeled.
- Dependencies known / unblocked.
- Serves the sprint goal.

## 7. Definition of Done (before a ticket is Done)

- Code implements the acceptance criteria.
- Tests written and passing (unit for logic; integration/E2E where relevant).
- Docs updated (PRD/ARCHITECTURE/ADR/README as needed).
- `/code-review` findings addressed.
- CI green, PR merged, issue auto-closed.

## 8. Testing strategy (see CLAUDE.md for the short version)

- **Unit (Vitest):** FSM transitions, stat/damage math, rune economy — the pure
  logic layer. Target ≥80%.
- **Integration:** Supabase queries; OpenAI boundary mocked/contract-tested.
  Never call the live OpenAI/Supabase prod in CI.
- **E2E (Playwright):** auth + core game-loop smoke.
- **Manual:** combat feel. Log every session in `docs/playtests/`.

## 9. Versioning & releases

- **SemVer.** Pre-1.0 while in development.
- `CHANGELOG.md` updated per notable PR (Keep a Changelog format).
- Tag releases; `main` deploys to Vercel production.

## 10. Sprint 0 checklist (foundations before feature work)

- [ ] PRD, ARCHITECTURE, SDLC docs (this batch)
- [ ] First ADRs: Next↔Phaser boundary, Boss FSM, Supabase
- [ ] Repo pushed to GitHub; branch protection on `main`
- [ ] GitHub Project board created with the columns above
- [ ] Next.js + Phaser walking skeleton (renders a blank canvas)
- [ ] CI pipeline (lint/typecheck/test/build) green
- [ ] Pre-commit hooks (format + lint)
- [ ] Vitest + Playwright configured with one trivial passing test each
