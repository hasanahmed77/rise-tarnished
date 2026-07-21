// Pure economy rule for a finished attempt (#11), engine- and
// Supabase-agnostic (CLAUDE.md: "keep game logic engine-agnostic").
//
// This is NOT the source of truth — the resolve_attempt Postgres RPC
// (supabase/migrations) computes and persists the real reward server-side
// and ignores anything the client claims. This function exists so the shell
// can show an immediate optimistic estimate the instant a fight ends,
// without waiting on the RPC round trip, and so the rule itself ("death
// pays nothing") is unit-tested in isolation.

export type FightResult = 'victory' | 'death';

/** Victory pays the boss's base reward; death pays nothing (issue #11 AC:
 * explicit no rune loss on death). */
export function computeRuneReward(result: FightResult, baseReward: number): number {
  return result === 'victory' ? baseReward : 0;
}
