import Phaser from 'phaser';
import type { GameBridge } from '../bridge';

// Walking-skeleton scene: proves Phaser renders inside the Next.js shell and
// can message back across the bridge. No game logic lives here (ADR-0001) —
// combat logic will arrive as pure TS modules that this scene merely drives.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const { width, height } = this.scale;

    // Arena floor + a placeholder combatant, so "it renders" is visible.
    this.add.rectangle(width / 2, height - 40, width * 0.8, 4, 0x8a7a5c);
    this.add.rectangle(width / 2, height - 90, 36, 96, 0xd4c9a8);

    this.add
      .text(width / 2, 60, 'RISE, TARNISHED', {
        fontFamily: 'serif',
        fontSize: '32px',
        color: '#d4c9a8',
        letterSpacing: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 100, 'walking skeleton — engine online', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#6b6b6b',
      })
      .setOrigin(0.5);

    const bridge = this.registry.get('bridge') as GameBridge | undefined;
    bridge?.toShell.emit('game:ready', undefined);
  }
}
