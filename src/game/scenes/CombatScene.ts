import Phaser from 'phaser';
import type { GameBridge } from '../bridge';
import {
  createPlayerState,
  isBlocking,
  isInvulnerable,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from '../combat/playerCombat';

// Renders and drives the player combat sim (issue #6). All rules live in the
// Phaser-free combat module (ADR-0001); this scene only samples input, steps
// the sim on a fixed clock, and paints the result.

const TICK_MS = 1000 / 60;
const GROUND_Y = 460;
const PLAYER_W = 36;
const PLAYER_H = 96;
const DUMMY_X = 720;
const ATTACK_RANGE = 90;

const COLORS = {
  idle: 0xd4c9a8,
  startup: 0xe0b84a,
  attack: 0xd05a4a,
  iframe: 0x4a80d0,
  recovery: 0x6b6b6b,
  block: 0x5a7a9a,
} as const;

export class CombatScene extends Phaser.Scene {
  private sim!: PlayerCombatState;
  private ctx!: StepContext;
  private accumulator = 0;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private player!: Phaser.GameObjects.Rectangle;
  private facingPip!: Phaser.GameObjects.Rectangle;
  private dummy!: Phaser.GameObjects.Rectangle;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private dummyFlash = 0;

  constructor() {
    super('combat');
  }

  create(): void {
    const { width } = this.scale;
    const minX = 40;
    const maxX = width - 40;

    this.sim = createPlayerState(220);
    this.ctx = {
      build: { vitality: 10, health: 10, dexterity: 10, intelligence: 10 },
      minX,
      maxX,
    };

    this.add.rectangle(width / 2, GROUND_Y + 2, width - 40, 4, 0x8a7a5c);
    this.add
      .text(width / 2, 40, 'COMBAT SANDBOX', {
        fontFamily: 'serif',
        fontSize: '22px',
        color: '#d4c9a8',
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 512, 'A/D move · Space dodge · J light · K heavy · Shift block', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#6b6b6b',
      })
      .setOrigin(0.5);

    // Training dummy — a static target to see attacks connect.
    this.dummy = this.add
      .rectangle(DUMMY_X, GROUND_Y - PLAYER_H / 2, 40, PLAYER_H, 0x4a4038)
      .setStrokeStyle(2, 0x6b5f52);
    this.add
      .text(DUMMY_X, GROUND_Y - PLAYER_H - 14, 'dummy', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#6b5f52',
      })
      .setOrigin(0.5);

    this.player = this.add.rectangle(
      this.sim.x,
      GROUND_Y - PLAYER_H / 2,
      PLAYER_W,
      PLAYER_H,
      COLORS.idle,
    );
    this.facingPip = this.add.rectangle(0, GROUND_Y - PLAYER_H + 8, 8, 8, 0x141210);

    // HUD bars.
    this.add.rectangle(20, 70, 200, 12, 0x2a2a2a).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(20, 70, 200, 12, 0x8a3a3a).setOrigin(0, 0.5);
    this.add.rectangle(20, 88, 200, 8, 0x2a2a2a).setOrigin(0, 0.5);
    this.staminaBar = this.add.rectangle(20, 88, 200, 8, 0x3a8a5a).setOrigin(0, 0.5);
    this.statusText = this.add.text(20, 100, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#8a8a8a',
    });

    this.keys = this.input.keyboard!.addKeys('A,D,LEFT,RIGHT,SPACE,J,K,SHIFT') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    const bridge = this.registry.get('bridge') as GameBridge | undefined;
    bridge?.toShell.emit('game:ready', undefined);
  }

  /** Sample the keyboard into a CombatInput. Edge flags true only on press. */
  private sampleInput(edge: boolean): CombatInput {
    const k = this.keys;
    const left = k.A.isDown || k.LEFT.isDown;
    const right = k.D.isDown || k.RIGHT.isDown;
    return {
      moveX: right && !left ? 1 : left && !right ? -1 : 0,
      light: edge && Phaser.Input.Keyboard.JustDown(k.J),
      heavy: edge && Phaser.Input.Keyboard.JustDown(k.K),
      dodge: edge && Phaser.Input.Keyboard.JustDown(k.SPACE),
      block: k.SHIFT.isDown,
    };
  }

  update(_time: number, delta: number): void {
    // Cap the accumulator so a long stall (e.g. tab backgrounded) can't trigger
    // a runaway catch-up of hundreds of ticks in one frame.
    this.accumulator = Math.min(this.accumulator + delta, TICK_MS * 5);
    let firstTick = true;
    // Fixed-timestep: consume the accumulator in whole 60Hz ticks. Edge-
    // triggered intents fire only on the first sim tick of this frame so one
    // keypress can't launch several actions.
    while (this.accumulator >= TICK_MS) {
      const input = this.sampleInput(firstTick);
      const { state, events } = step(this.sim, input, this.ctx);
      this.sim = state;
      for (const e of events) {
        if (e.type === 'attack:active' && this.playerInRangeOfDummy()) {
          this.dummyFlash = 8;
        }
      }
      this.accumulator -= TICK_MS;
      firstTick = false;
    }

    this.render();
  }

  private playerInRangeOfDummy(): boolean {
    const facingDummy = this.sim.facing === (DUMMY_X >= this.sim.x ? 1 : -1);
    return facingDummy && Math.abs(DUMMY_X - this.sim.x) <= ATTACK_RANGE;
  }

  private render(): void {
    const s = this.sim;
    this.player.x = s.x;

    let color: number = COLORS.idle;
    const a = s.action;
    if (a) {
      if (a.id === 'dodge') color = isInvulnerable(s) ? COLORS.iframe : COLORS.recovery;
      else if (isBlocking(s)) color = COLORS.block;
      else if (a.phase === 'startup') color = COLORS.startup;
      else if (a.phase === 'active') color = COLORS.attack;
      else color = COLORS.recovery;
    }
    this.player.fillColor = color;
    this.player.alpha = isInvulnerable(s) ? 0.5 : 1;

    this.facingPip.x = s.x + (s.facing === 1 ? PLAYER_W / 2 - 4 : -PLAYER_W / 2 + 4);

    this.hpBar.width = 200 * (s.hp / 100);
    this.staminaBar.width = 200 * (s.stamina / 100);
    this.statusText.setText(
      `action: ${a ? `${a.id}/${a.phase}` : 'idle'}   hp: ${s.hp.toFixed(0)}   stam: ${s.stamina.toFixed(0)}`,
    );

    if (this.dummyFlash > 0) {
      this.dummyFlash -= 1;
      this.dummy.fillColor = 0x8a5a4a;
    } else {
      this.dummy.fillColor = 0x4a4038;
    }
  }
}
