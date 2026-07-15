import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import type { GameBridge } from './bridge';

// This module (and everything it imports) touches Phaser, which assumes a
// browser. It must only ever be loaded via dynamic import from a client
// component — never statically from server-rendered code.
export function createGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 540,
    backgroundColor: '#141210',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 } },
    },
    scene: [BootScene],
  });

  // The bridge crosses the boundary via the game registry, not module state,
  // so each game instance is fully self-contained (clean StrictMode remounts).
  game.registry.set('bridge', bridge);
  return game;
}
