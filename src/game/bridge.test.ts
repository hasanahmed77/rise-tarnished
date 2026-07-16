import { describe, expect, it, vi } from 'vitest';
import { GameBridge } from './bridge';

describe('GameBridge', () => {
  it('delivers events to subscribers with the typed payload', () => {
    const bridge = new GameBridge();
    const handler = vi.fn();
    bridge.toShell.on('fight:outcome', handler);

    const outcome = { result: 'death' as const, durationTicks: 3600, runeDelta: 0 };
    bridge.toShell.emit('fight:outcome', outcome);

    expect(handler).toHaveBeenCalledExactlyOnceWith(outcome);
  });

  it('stops delivering after unsubscribe', () => {
    const bridge = new GameBridge();
    const handler = vi.fn();
    const off = bridge.toShell.on('game:ready', handler);

    off();
    bridge.toShell.emit('game:ready', undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it('still delivers to remaining handlers when one unsubscribes mid-emit', () => {
    const bridge = new GameBridge();
    const calls: string[] = [];

    const offA = bridge.toShell.on('game:ready', () => {
      calls.push('a');
      offA(); // self-unsubscribe during emit must not starve later handlers
    });
    bridge.toShell.on('game:ready', () => calls.push('b'));

    bridge.toShell.emit('game:ready', undefined);
    expect(calls).toEqual(['a', 'b']);

    bridge.toShell.emit('game:ready', undefined);
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('delivers nothing after dispose', () => {
    const bridge = new GameBridge();
    const shellHandler = vi.fn();
    const gameHandler = vi.fn();
    bridge.toShell.on('game:ready', shellHandler);
    bridge.toGame.on('fight:start', gameHandler);

    bridge.dispose();
    bridge.toShell.emit('game:ready', undefined);
    bridge.toGame.emit('fight:start', {
      bossId: 'margit',
      build: { vitality: 10, health: 10, dexterity: 10, intelligence: 10 },
    });

    expect(shellHandler).not.toHaveBeenCalled();
    expect(gameHandler).not.toHaveBeenCalled();
  });
});
