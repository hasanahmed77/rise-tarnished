# UML Diagrams — Rise, Tarnished

Planning rationale for every diagram in this folder lives in
[`../uml-plan.md`](../uml-plan.md), including a documented rigor pass that
caught and fixed real errors before any diagram was drawn (a misused
`«include»`/`«extend»` split, a missing DB column, an inverted and
mis-notated dependency arrow, and an undocumented probabilistic-choice
issue in the activity diagram) — read it first if you want the reasoning
behind a specific modeling choice, not just the diagram itself.

Every diagram traces to specific, cited source files and was checked
against them directly rather than drawn from memory — including a second
pass specifically hunting for memory-based errors, which found three more
(all fixed, documented at their point of use in the class diagram).

| # | Deliverable | File |
|---|---|---|
| 1 | Use Case Diagram | [`01-use-case-diagram.md`](01-use-case-diagram.md) |
| 2 | Detailed use case description — Fight the Adaptive Boss | [`02-use-case-description-fight-the-adaptive-boss.md`](02-use-case-description-fight-the-adaptive-boss.md) |
| 3a | Sequence Diagram — Sign In (with Google) | [`03-sequence-sign-in.md`](03-sequence-sign-in.md) |
| 3b | Sequence Diagram — Fight the Adaptive Boss | [`04-sequence-fight-the-boss.md`](04-sequence-fight-the-boss.md) |
| 3c | Communication Diagram — Spend Runes on Stats | [`05-communication-spend-runes.md`](05-communication-spend-runes.md) |
| 4 | Activity Diagram — Boss L2→L3 decision process | [`06-activity-boss-decision.md`](06-activity-boss-decision.md) |
| 5 | Class Diagram | [`07-class-diagram.md`](07-class-diagram.md) |

## Rendering

Every diagram is Mermaid, which GitHub renders natively in the file view —
no extra tooling needed to read these in the repo. Two diagram types
(**Use Case** and **Communication**) have no native Mermaid syntax; both
are built with `flowchart` as the closest faithful approximation, with the
workaround stated explicitly at the top of each file rather than left
implicit.

## Scope

These diagrams model the **shipped MVP** as of 2026-08-08: sign in →
resume → spend runes → fight → view outcome → resolve attempt. The
post-death LLM recap (issue #13) and the headless bot-simulation harness
(issue #14) are not implemented and are excluded rather than diagrammed as
if they existed.
