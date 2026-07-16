import Phaser from 'phaser';
import type { GameBridge } from '../bridge';
import {
  createPlayerState,
  isBlocking,
  isInvulnerable,
  isStaggered,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from '../combat/playerCombat';

// Renders and drives the player combat sim (issue #6). All rules live in the
// Phaser-free combat module (ADR-0001); this scene only samples input, steps
// the sim on a fixed clock, and paints the result.
//
// The canvas fills the browser viewport (Scale.RESIZE, see createGame.ts), so
// every position below is derived from the current scale width/height rather
// than hardcoded — and re-derived on 'resize' via relayout().

const TICK_MS = 1000 / 60;
const PLAYER_W = 36;
const PLAYER_H = 96;
const ARENA_MARGIN = 40;
const GROUND_MARGIN_BOTTOM = 80;
const DUMMY_X_RATIO = 0.75;
const ATTACK_RANGE = 90;

const COLORS = {
  idle: 0xd4c9a8,
  startup: 0xe0b84a,
  attack: 0xd05a4a,
  iframe: 0x4a80d0,
  recovery: 0x6b6b6b,
  block: 0x5a7a9a,
  stagger: 0xe0e0e0,
} as const;

export class CombatScene extends Phaser.Scene {
  private sim!: PlayerCombatState;
  private ctx!: StepContext;
  private accumulator = 0;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private player!: Phaser.GameObjects.Rectangle;
  private facingPip!: Phaser.GameObjects.Rectangle;
  private groundBar!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private dummy!: Phaser.GameObjects.Rectangle;
  private dummyLabel!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private lastStatus = '';
  private dummyFlash = 0;

  /** Derived layout, recomputed by relayout() whenever the canvas resizes. */
  private groundY = 0;
  private dummyX = 0;

  constructor() {
    super('combat');
  }

  create(): void {
    this.sim = createPlayerState(this.scale.width * 0.25);
    this.ctx = {
      build: { vitality: 10, health: 10, dexterity: 10, intelligence: 10 },
      minX: ARENA_MARGIN,
      maxX: this.scale.width - ARENA_MARGIN,
    };

    this.groundBar = this.add.rectangle(0, 0, 0, 4, 0x8a7a5c);
    this.titleText = this.add
      .text(0, 40, 'COMBAT SANDBOX', { fontFamily: 'serif', fontSize: '22px', color: '#d4c9a8' })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'A/D move · Space dodge · J light · K heavy · Shift block', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#6b6b6b',
      })
      .setOrigin(0.5);

    // Training dummy — a static target to see attacks connect.
    this.dummy = this.add.rectangle(0, 0, 40, PLAYER_H, 0x4a4038).setStrokeStyle(2, 0x6b5f52);
    this.dummyLabel = this.add
      .text(0, 0, 'dummy', { fontFamily: 'monospace', fontSize: '11px', color: '#6b5f52' })
      .setOrigin(0.5);

    this.player = this.add.rectangle(this.sim.x, 0, PLAYER_W, PLAYER_H, COLORS.idle);
    this.facingPip = this.add.rectangle(0, 0, 8, 8, 0x141210);

    // HUD bars — anchored to the top-left corner, independent of canvas size.
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

    this.relayout(this.scale.width, this.scale.height);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

    const bridge = this.registry.get('bridge') as GameBridge | undefined;
    bridge?.toShell.emit('game:ready', undefined);
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.relayout(gameSize.width, gameSize.height);
  }

  /** Recompute every size-dependent position. Player x is clamped, not reset. */
  private relayout(width: number, height: number): void {
    this.groundY = height - GROUND_MARGIN_BOTTOM;
    this.dummyX = width * DUMMY_X_RATIO;

    this.ctx.minX = ARENA_MARGIN;
    this.ctx.maxX = width - ARENA_MARGIN;
    this.sim.x = Math.max(this.ctx.minX, Math.min(this.ctx.maxX, this.sim.x));

    this.groundBar.setPosition(width / 2, this.groundY + 2);
    this.groundBar.setSize(width - ARENA_MARGIN * 2, 4);
    this.titleText.setX(width / 2);
    this.hintText.setPosition(width / 2, height - 28);

    this.dummy.setPosition(this.dummyX, this.groundY - PLAYER_H / 2);
    this.dummyLabel.setPosition(this.dummyX, this.groundY - PLAYER_H - 14);

    this.player.setY(this.groundY - PLAYER_H / 2);
    this.facingPip.setY(this.groundY - PLAYER_H + 8);
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
    const facingDummy = this.sim.facing === (this.dummyX >= this.sim.x ? 1 : -1);
    return facingDummy && Math.abs(this.dummyX - this.sim.x) <= ATTACK_RANGE;
  }

  private render(): void {
    const s = this.sim;
    this.player.x = s.x;

    let color: number = COLORS.idle;
    const a = s.action;
    if (isStaggered(s)) {
      color = COLORS.stagger;
    } else if (a) {
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
    const mode = isStaggered(s)
      ? `STAGGERED (${s.staggerTicks})`
      : a
        ? `${a.id}/${a.phase}`
        : 'idle';
    const status = `action: ${mode}   hp: ${s.hp.toFixed(0)}   stam: ${s.stamina.toFixed(0)}   poise dmg: ${s.poiseDamage.toFixed(0)}`;
    if (status !== this.lastStatus) {
      this.statusText.setText(status);
      this.lastStatus = status;
    }

    if (this.dummyFlash > 0) {
      this.dummyFlash -= 1;
      this.dummy.fillColor = 0x8a5a4a;
    } else {
      this.dummy.fillColor = 0x4a4038;
    }
  }
}
