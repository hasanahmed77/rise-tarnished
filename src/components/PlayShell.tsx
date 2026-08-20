'use client';

import { useState } from 'react';
import type { PlayerBuild } from '@/game/bridge';
import type { GameSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { CharacterSheet } from './CharacterSheet';
import { GameCanvas } from './GameCanvas';
import { MainMenu } from './MainMenu';
import { SettingsPanel } from './SettingsPanel';

type Screen = 'menu' | 'sheet' | 'fight';

/** Menu → CharacterSheet → GameCanvas, in that order, always. Previously
 * this went straight to CharacterSheet, which itself auto-skips to the
 * fight when nothing's affordable — so a returning player could land in
 * combat with no menu at all. MainMenu is a real gate now: nothing after it
 * mounts until "Play" is clicked, so its stats display is always seen.
 *
 * SettingsPanel (#56) renders here, not inside any one screen, and stays
 * mounted across all three states below — same reasoning as before: it's
 * the game's only accessibility control, so it can't be tucked inside a
 * screen that might skip itself. `settings` starts at DEFAULT_SETTINGS
 * (server-safe; SettingsPanel loads the real persisted value after mount)
 * and is only ever read by GameCanvas once a fight exists to apply it to.
 */
export function PlayShell() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [build, setBuild] = useState<PlayerBuild | null>(null);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);

  function beginFight(nextBuild: PlayerBuild) {
    setBuild(nextBuild);
    setScreen('fight');
  }

  return (
    <div className="relative h-full w-full">
      {screen === 'menu' && <MainMenu onAction={() => setScreen('sheet')} />}
      {screen === 'sheet' && <CharacterSheet onBegin={beginFight} />}
      {screen === 'fight' && build && <GameCanvas build={build} settings={settings} />}
      <SettingsPanel onChange={setSettings} />
    </div>
  );
}
