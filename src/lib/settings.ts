// Client display preferences (#56) — screenshake and audio mute. Explicitly
// NOT authoritative game state: ADR-0003's client-read-only/RPC discipline
// governs runes/stats/progress, none of which this touches. This is a pure,
// local UI preference, so plain localStorage is the right amount of
// infrastructure — no player_stats column, no RPC, no round-trip.
//
// Framework-free on purpose: both a React component (SettingsPanel) and a
// Phaser scene (CombatScene) read and write this, and neither should have to
// go through the other to do it.

export interface GameSettings {
  /** COMBAT_SYSTEM.md §8: screen shake is budgeted "with an accessibility
   * toggle planned" — this is that toggle. A motion-sensitivity concern, not
   * a taste one, so it defaults on (shake ships as designed) rather than
   * requiring a player who needs it off to already know it exists. */
  screenshakeEnabled: boolean;
  /** Mirrors CombatScene's `sound.mute` — the M-key shortcut and this panel
   * both read/write the same preference, so neither goes stale against the
   * other across a reload. */
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  screenshakeEnabled: true,
  muted: false,
};

const STORAGE_KEY = 'rise-tarnished:settings';

function hasLocalStorage(): boolean {
  // Guards two real cases, not just SSR: `next build`'s prerender pass has no
  // `window` at all, and a browser with storage disabled (private mode in
  // some browsers, or a locked-down environment) has `window.localStorage`
  // throw on *access*, not just return undefined — hence the try/catch below
  // rather than only checking for existence here.
  return typeof window !== 'undefined';
}

/** Loads persisted settings, falling back to defaults for anything missing,
 * unreadable, or malformed — a corrupt or hand-edited localStorage value
 * degrades to "as if never set," never a crash. */
export function loadSettings(): GameSettings {
  if (!hasLocalStorage()) return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return {
      screenshakeEnabled:
        typeof (parsed as Partial<GameSettings> | null)?.screenshakeEnabled === 'boolean'
          ? (parsed as GameSettings).screenshakeEnabled
          : DEFAULT_SETTINGS.screenshakeEnabled,
      muted:
        typeof (parsed as Partial<GameSettings> | null)?.muted === 'boolean'
          ? (parsed as GameSettings).muted
          : DEFAULT_SETTINGS.muted,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persists settings. Best-effort — a write failure (storage disabled, quota
 * exceeded) silently no-ops rather than breaking the toggle the player just
 * clicked; the preference simply won't survive a reload, which is a strict
 * improvement over the M-key-only status quo, not a regression from it. */
export function saveSettings(settings: GameSettings): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // See above — degrade silently.
  }
}
