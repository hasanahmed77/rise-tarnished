'use client';

import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type GameSettings } from '@/lib/settings';

/**
 * The settings surface (#56) — deferred twice (#42's screenshake toggle,
 * #51's mute) for lack of anywhere to put it. Lives at the PlayShell level
 * (not inside CharacterSheet) so it's reachable the whole time PlayShell is
 * mounted: CharacterSheet skips itself when nothing's affordable, which
 * would make it an unreliable host for the only accessibility control this
 * game has.
 *
 * A fixed corner button rather than inline UI, so it never competes for
 * space with the character sheet or the fight itself, and stays reachable
 * during combat the same way the M-key mute shortcut always has been.
 */
export function SettingsPanel({ onChange }: { onChange: (settings: GameSettings) => void }) {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [open, setOpen] = useState(false);

  // Loaded after mount, not in a lazy useState initializer: this component
  // renders during SSR/prerender with no localStorage, and reading it in the
  // initializer would make the client's first render disagree with the
  // server's, which React reports as a hydration mismatch. Deferring to an
  // effect keeps the very first paint identical on both sides — this is
  // exactly the sanctioned exception to "don't setState in an effect" (a
  // one-time read of a genuinely external, browser-only store, not state
  // derived from props/other state), not the derived-state anti-pattern the
  // lint rule exists to catch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
  }, []);

  if (!settings) return <div className="pointer-events-none absolute top-3 left-3 h-9 w-9" />;

  function update(patch: Partial<GameSettings>) {
    const next = { ...settings!, ...patch };
    setSettings(next);
    saveSettings(next);
    onChange(next);
  }

  return (
    // Left corner deliberately: PlayPage already anchors SignOutButton at
    // top-3 right-3, and this needs to never collide with it.
    <div className="absolute top-3 left-3 z-10 font-mono text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded border border-neutral-700 bg-neutral-950/80 text-neutral-300 transition hover:bg-neutral-800"
      >
        ⚙
      </button>
      {open && (
        <div className="mt-2 flex w-56 flex-col gap-3 rounded border border-neutral-700 bg-neutral-950/95 p-4 text-neutral-200 shadow-lg">
          <p className="text-xs tracking-wide text-neutral-500 uppercase">Settings</p>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={settings.screenshakeEnabled}
              onChange={(e) => update({ screenshakeEnabled: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Screen shake
              <span className="block text-xs text-neutral-500">
                Camera shake on hits. Off for motion sensitivity.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={settings.muted}
              onChange={(e) => update({ muted: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Mute audio
              <span className="block text-xs text-neutral-500">Same as pressing M in-fight.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
