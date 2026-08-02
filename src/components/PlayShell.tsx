'use client';

import { useState } from 'react';
import type { PlayerBuild } from '@/game/bridge';
import { CharacterSheet } from './CharacterSheet';
import { GameCanvas } from './GameCanvas';

/** Gates GameCanvas behind the character sheet (#12): the player spends
 * runes on stats first, then that exact build starts the fight — no fight
 * runs on the hardcoded sandbox build anymore. Remounting PlayPage (the
 * ResolutionOverlay's "Fight again" reload) naturally returns here, so
 * runes earned from the fight just ended are spendable before the next one. */
export function PlayShell() {
  const [build, setBuild] = useState<PlayerBuild | null>(null);

  if (!build) {
    return <CharacterSheet onBegin={setBuild} />;
  }
  return <GameCanvas build={build} />;
}
