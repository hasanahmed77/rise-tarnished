# Sprint 0 — Foundations

- **Dates:** 2026-07-16 → 2026-07-22 (1 week)
- **Sprint goal:** *Every future change flows through a professional pipeline:
  specs exist, the repo is on GitHub with protected main + board, CI is green
  on a walking skeleton.*

## Committed scope

- [x] CLAUDE.md (operating rules)
- [x] docs: PRD, ARCHITECTURE, SDLC
- [x] ADRs 0001–0003 (Proposed)
- [x] Design specs: COMBAT_SYSTEM.md, BOSS_AI.md (souls-like combat + 3-layer HFSM)
- [x] ADRs reviewed → Accepted
- [x] Initial commit; repo pushed to GitHub
- [x] Branch protection on `main`; GitHub Project board (columns per SDLC §2)
- [x] Backlog seeded as GitHub Issues (#1–#14, labeled + on the board)
- [x] Walking skeleton: Next.js + Phaser blank canvas, mount/unmount verified
      (ADR-0001 follow-up: React strict-mode double-mount check — passed,
      1 canvas after double-mount; registry-set-before-create() ordering
      verified against Phaser source in code review)
- [x] CI: lint + typecheck + unit (Vitest — 4 real GameBridge tests) + build, green
- [x] Pre-commit hooks (husky + lint-staged: eslint --fix + prettier on staged
      files; blocks on lint error — verified block & auto-fix cases)

## Daily check-ins
- **07-16:** Docs + design specs drafted. Combat/HFSM specs reviewed against
  "souls-like, not simple" bar. ADRs accepted, pushed to GitHub, branch
  protection + Project board (#1) + labels set up. Next: seed Sprint 1 backlog
  as issues, then walking skeleton + CI.
- **07-16 (cont.):** Backlog seeded (#1–#14). Shipped #1 (walking skeleton,
  full multi-agent code review), #2 (CI + required status check on `main`),
  #3 (pre-commit hooks). Sprint goal met.

## Review (end of sprint)

**Goal met: yes.** Every future change now flows through the intended pipeline —
branch → PR → CI (lint/typecheck/test/build, *required* on `main`) → squash-merge.
Demonstrated live across three PRs (#15, #16, #17).

Delivered:
- Full doc set (PRD, ARCHITECTURE, SDLC) + 3 accepted ADRs + two design specs
  (souls-like combat model, 3-layer HFSM boss brain with fairness invariants).
- GitHub repo with protected `main`, Project board (5 SDLC columns), 16 labels,
  14 issues.
- Walking skeleton: Next.js 16 + Phaser 4, StrictMode-safe, typed React↔Phaser
  bridge (ADR-0001), verified in-browser.
- CI pipeline enforced as a required check; first real unit tests (GameBridge).
- Husky + lint-staged pre-commit (eslint --fix + prettier), verified both the
  block and auto-fix paths.

Not in scope / deferred: no game logic yet (combat, FSM) — that's Sprint 1+.

## Retro (end of sprint)

**What worked**
- Docs/ADRs-first paid off immediately: the HFSM + combat specs gave #1's review
  concrete architecture (ADR-0001) to check against.
- Vertical-slice discipline held — resisted breadth, shipped a thin end-to-end
  spine (render + bridge) before features.
- Multi-agent code review on #1 earned its keep: caught a real emitter-hardening
  bug and refuted three plausible-but-wrong race reports by reading Phaser source.

**What didn't**
- Node-version drift bit us twice (Vitest, then lint-staged) — both needed
  `node:util.styleText` (Node ≥ 20.12). Root cause: the Bash tool runs a
  non-login shell that resolves the stale `/usr/local/bin/node` v20.10; the
  user's real terminal is fine (v23 via brew). Cost ~two detours.
- CI needed an npm pin (11.x) after a lockfile-validation disagreement on the
  runner — found only after the first push, not locally.

**One change for next sprint**
- Pin the toolchain environment up front: `.nvmrc` (done, → 22) plus assume
  Node ≥ 20.12 in any local command, so version drift stops costing detours.

**Sprint status: CLOSED.**
