# Architecture Decision Records

An ADR captures **one** significant, expensive-to-reverse decision: the context,
the choice, the alternatives we rejected, and the consequences we accept.

## Rules
- One decision per file. Number sequentially: `NNNN-short-slug.md`.
- Write the ADR **before** the implementing code lands (or alongside its PR).
- ADRs are immutable once `Accepted`. To change a decision, write a new ADR that
  supersedes the old one (and mark the old one `Superseded by ADR-XXXX`).
- Use `template.md` as the starting point.

## Status values
`Proposed` → `Accepted` → (`Deprecated` | `Superseded by ADR-XXXX`)

## Index
| ADR | Title | Status |
|-----|-------|--------|
| 0001 | Next.js ↔ Phaser integration boundary | Accepted |
| 0002 | Boss AI as a hierarchical behavior-weighted FSM (no LLM in the loop) | Accepted |
| 0003 | Supabase for auth and persistence | Accepted |
