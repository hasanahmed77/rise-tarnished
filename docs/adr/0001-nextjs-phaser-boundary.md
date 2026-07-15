# ADR-0001: Next.js ↔ Phaser integration boundary

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** (you)

## Context
We have two runtimes in one browser app: Next.js (React) owns the shell — auth,
menus, character sheet, screens — and Phaser owns the combat canvas. React and
Phaser both want to "own" the DOM and the game state. Getting this boundary
wrong leads to re-render thrash, duplicated state, and untestable logic.

## Decision
1. **Phaser runs inside a single Next.js client component** that mounts the game
   on `useEffect` and tears it down on unmount. React never re-renders the canvas.
2. **The boundary is a thin, typed message interface**, not shared mutable state.
   React → Phaser: start fight, load build/stats. Phaser → React: fight outcome,
   rune delta, attempt log. No React state reaches into Phaser's per-frame loop.
3. **Game-logic modules are Phaser-free** (see ADR-0002 / ARCHITECTURE.md). Both
   Phaser and any test harness import them directly.

## Alternatives considered
- **Render combat in React/Canvas without Phaser** — rejected: we'd reinvent
  physics, animation, and hitbox tooling Phaser gives us for free.
- **Make Phaser the top-level app, Next.js optional** — rejected: we want SSR,
  routing, and auth ergonomics from Next.js for the shell/UI.
- **Share a global mutable store (Zustand/Redux) across both** for per-frame
  state — rejected: 60fps mutation through a React store invites re-render storms
  and blurs the tested-logic boundary.

## Consequences
- **Positive:** clean separation; React re-renders can't tank combat perf; logic
  stays unit-testable headlessly.
- **Negative:** a message interface is more upfront ceremony than shared state;
  we must design the event contract deliberately.
- **Follow-ups:** define the typed event contract; spike the mount/unmount
  lifecycle in the walking skeleton to confirm no double-mount in React strict mode.
