import Phaser from 'phaser';
import { CombatScene } from './scenes/CombatScene';
import type { GameBridge } from './bridge';

// This module (and everything it imports) touches Phaser, which assumes a
// browser. It must only ever be loaded via dynamic import from a client
// component — never statically from server-rendered code.
export function createGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    // Fill the parent element exactly; Scale.RESIZE keeps the canvas synced
    // to the parent's CSS size (via ResizeObserver) on every window/layout
    // resize, so `width`/`height` here are just the initial values.
    width: parent.clientWidth,
    height: parent.clientHeight,
    backgroundColor: '#141210',
    scale: {
      mode: Phaser.Scale.RESIZE,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 } },
    },
    scene: [CombatScene],
  });

  // The bridge crosses the boundary via the game registry, not module state,
  // so each game instance is fully self-contained (clean StrictMode remounts).
  game.registry.set('bridge', bridge);
  return game;
}
