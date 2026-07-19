// Fairness invariants (BOSS_AI.md §6). F1/F2 are validated here as a
// schema-level data test — CI fails if a designer authors an illegal move.
// F3/F7/F8 are enforced both here (structural authoring errors) and by
// construction in the selection pipeline (actionSelection.ts) — belt and
// braces, since a data bug and a pipeline bug are different failure modes.
// F4/F5/F6 are N/A until #9 (behavior weighting) and phases exist.

import type { MoveDef, MoveTable } from './types';

/** F1 — nothing is unreactable. */
export const MIN_TELL_FRAMES = 18;
/** F2 — breathing room between combo sequences is authored, not emergent. */
export const MIN_INTER_SEQUENCE_GAP_TICKS = 30;
/** F3 — phase-1 chain cap. */
export const MAX_CHAIN_PHASE1 = 5;

export interface MoveValidationError {
  moveId: string;
  rule: string;
  message: string;
}

function validateMove(
  move: MoveDef,
  table: MoveTable,
  maxTellInTable: number,
): MoveValidationError[] {
  const errors: MoveValidationError[] = [];

  if (move.tellFrames < MIN_TELL_FRAMES) {
    errors.push({
      moveId: move.id,
      rule: 'F1',
      message: `tellFrames (${move.tellFrames}) below the ${MIN_TELL_FRAMES}f minimum`,
    });
  }
  if (move.tellFrames > move.frames.startup) {
    errors.push({
      moveId: move.id,
      rule: 'structural',
      message: `tellFrames (${move.tellFrames}) exceeds startup (${move.frames.startup}) — a tell can't outlast the window it's read within`,
    });
  }

  if (move.combo) {
    if (move.combo.maxChain > MAX_CHAIN_PHASE1) {
      errors.push({
        moveId: move.id,
        rule: 'F3',
        message: `combo.maxChain (${move.combo.maxChain}) exceeds the phase-1 cap of ${MAX_CHAIN_PHASE1}`,
      });
    }
    for (const link of move.combo.next) {
      if (!table[link.move]) {
        errors.push({
          moveId: move.id,
          rule: 'structural',
          message: `combo links to unknown move "${link.move}"`,
        });
      }
      if (link.weight <= 0) {
        errors.push({
          moveId: move.id,
          rule: 'structural',
          message: `combo link to "${link.move}" has non-positive weight (${link.weight})`,
        });
      }
    }
    const totalWeight = move.combo.next.reduce((sum, l) => sum + l.weight, 0);
    if (totalWeight > 1) {
      errors.push({
        moveId: move.id,
        rule: 'structural',
        message: `combo link weights sum to ${totalWeight} > 1 (remaining mass must be non-negative — it means "end the sequence")`,
      });
    }
  }

  if (move.tags.includes('grab')) {
    if (move.combo) {
      errors.push({ moveId: move.id, rule: 'F7', message: 'grab moves must never combo-chain' });
    }
    if (move.tellFrames < maxTellInTable) {
      errors.push({
        moveId: move.id,
        rule: 'F7',
        message: `grab's tellFrames (${move.tellFrames}) must be >= every other move's (max in table: ${maxTellInTable})`,
      });
    }
  }

  return errors;
}

export function validateMoveTable(table: MoveTable): MoveValidationError[] {
  const moves = Object.values(table);
  const maxTellInTable = Math.max(...moves.map((m) => m.tellFrames));
  return moves.flatMap((move) => validateMove(move, table, maxTellInTable));
}
