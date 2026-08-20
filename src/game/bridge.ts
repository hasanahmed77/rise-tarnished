// The typed message boundary between the React shell and the Phaser runtime
// (ADR-0001). React talks to the game and the game talks back exclusively
// through this bridge — no shared mutable state, and no React state ever
// reaches the per-frame loop.
//
// These are the v1 stubs; the contract grows via PR as features land.

import type { DecisionEvent } from './boss/decisionLog';
import type { ScoredTactic } from './boss/tactics';
import type { MoveTag } from './boss/types';
import type { GameSettings } from '@/lib/settings';

export interface PlayerBuild {
  vitality: number;
  dexterity: number;
  intelligence: number;
}

/** #64 — a player's persisted, between-attempt drift for one boss, read from
 * `boss_weight_overrides` before the fight starts. Absent entirely (rather
 * than present-but-empty) on a player's first attempt against a boss, or if
 * the fetch fails — both cases fall back to the boss's hardcoded defaults,
 * per ADR-0002 ("falls back to heuristic weights if unavailable"). */
export interface WeightOverrides {
  tacticBaseScore: Partial<Record<ScoredTactic, number>>;
  weightRuleGains: Partial<Record<MoveTag, number>>;
}

export interface FightOutcome {
  /** Client-generated once when the fight ends; the id resolve_attempt (#11)
   * uses to dedupe retries — never regenerated for the same fight. */
  attemptId: string;
  bossId: string;
  result: 'victory' | 'death';
  durationTicks: number;
  /** Optimistic client-side estimate only (see game/attempt/reward.ts) — not
   * the persisted amount. The shell must call the resolve_attempt RPC for
   * the authoritative reward; this is never sent to that RPC as an amount. */
  estimatedRuneDelta: number;
  /**
   * The boss's own L2/L3 decisions for this attempt (#55, BOSS_AI.md §8), in
   * tick order, for the shell to persist via `resolve_attempt(p_log)`.
   *
   * Telemetry, never authority: like `estimatedRuneDelta`, nothing here is
   * trusted to compute a reward. It is written to `attempt_logs.log` so #13's
   * recap has something true to be specific about.
   */
  decisionLog: DecisionEvent[];
}

/** React → Phaser */
export interface ShellToGameEvents {
  'fight:start': {
    bossId: string;
    build: PlayerBuild;
    /** #64 — optional: undefined means "use the hardcoded defaults", not
     * "wait for this". The shell resolves this before emitting, so
     * CombatScene never blocks fight start on a network round trip. */
    weightOverrides?: WeightOverrides;
  };
  /** #56 — pushed once the game is created and again on every change from
   * SettingsPanel, so a toggle mid-fight (e.g. muting) applies immediately
   * rather than waiting for the next fight. CombatScene also reads
   * `loadSettings()` directly at creation (see its own comment) — this event
   * is only for *live* updates to an already-running scene. */
  'settings:update': GameSettings;
}

/** Phaser → React */
export interface GameToShellEvents {
  'game:ready': void;
  'fight:outcome': FightOutcome;
}

type Handler<P> = (payload: P) => void;

class TypedEmitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Snapshot before iterating so a handler that unsubscribes (or disposes
    // the bridge) mid-emit can't silently skip the remaining handlers.
    for (const h of [...set]) {
      (h as Handler<Events[K]>)(payload);
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}

export class GameBridge {
  /** Shell publishes here; game subscribes. */
  readonly toGame = new TypedEmitter<ShellToGameEvents>();
  /** Game publishes here; shell subscribes. */
  readonly toShell = new TypedEmitter<GameToShellEvents>();

  dispose(): void {
    this.toGame.removeAll();
    this.toShell.removeAll();
  }
}
