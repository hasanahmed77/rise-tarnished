'use client';

import { useState } from 'react';
import type { PlayerBuild } from '@/game/bridge';
import type { GameSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { CharacterSheet } from './CharacterSheet';
import { GameCanvas } from './GameCanvas';
import { SettingsPanel } from './SettingsPanel';

/** Gates GameCanvas behind the character sheet (#12): the player spends
 * runes on stats first, then that exact build starts the fight — no fight
 * runs on the hardcoded sandbox build anymore. Remounting PlayPage (the
 * ResolutionOverlay's "Fight again" reload) naturally returns here, so
 * runes earned from the fight just ended are spendable before the next one.
 *
 * SettingsPanel (#56) renders here, not inside CharacterSheet, and stays
 * mounted across both states below — CharacterSheet can skip itself
 * straight to the fight when nothing's affordable, which would make it an
 * unreliable place to put the game's only accessibility control. `settings`
 * starts at DEFAULT_SETTINGS (server-safe; SettingsPanel loads the real
 * persisted value after mount) and is only ever read by GameCanvas once a
 * fight exists to apply it to. */
export function PlayShell() {
  const [build, setBuild] = useState<PlayerBuild | null>(null);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);

  return (
    <div className="relative h-full w-full">
      {build ? (
        <GameCanvas build={build} settings={settings} />
      ) : (
        <CharacterSheet onBegin={setBuild} />
      )}
      <SettingsPanel onChange={setSettings} />
    </div>
  );
}
