import Phaser from 'phaser';
import type { GameBridge } from '../bridge';
import { ATTACK_DAMAGE, BASE_MAX_HP, BASE_MAX_STAMINA, POSTURE_MAX } from '../combat/frameData';
import {
  createPlayerState,
  isBlocking,
  isInvulnerable,
  isStaggered,
  resolveIncomingHit,
  step,
  type CombatInput,
  type PlayerCombatState,
  type StepContext,
} from '../combat/playerCombat';
import { isCriticalWindowOpen } from '../combat/posture';
import {
  createBossState,
  isBossStaggered,
  isPunishableOpening,
  observeTrackerEvent,
  resolveBossHit,
  step as bossStep,
  type BossCombatState,
  type BossStepContext,
} from '../boss/bossCombat';
import { margitWeightRules } from '../boss/weighting';
import { margitMoves, margitTopLevelMoveIds } from '../boss/margitMoves';
import { BOSS_BASE_MAX_HP } from '../boss/bossTuning';
import type { MoveDef } from '../boss/types';

// Renders and drives the fight (issues #6/#7/#8). All rules live in the
// Phaser-free combat/boss modules (ADR-0001); this scene only samples input,
// steps both entities on a fixed clock, resolves hits between them, and
// paints the result.
//
// The canvas fills the browser viewport (Scale.RESIZE, see createGame.ts), so
// every position below is derived from the current scale width/height rather
// than hardcoded — and re-derived on 'resize' via relayout().

const TICK_MS = 1000 / 60;
const PLAYER_W = 36;
const PLAYER_H = 96;
const BOSS_W = 54;
const BOSS_H = 128;
const ARENA_MARGIN = 40;
const GROUND_MARGIN_BOTTOM = 80;
const BOSS_START_X_RATIO = 0.7;
const PLAYER_START_X_RATIO = 0.25;
const PLAYER_ATTACK_RANGE = 90;
const HUD_BAR_WIDTH = 200;

const PLAYER_COLORS = {
  idle: 0xd4c9a8,
  startup: 0xe0b84a,
  attack: 0xd05a4a,
  iframe: 0x4a80d0,
  recovery: 0x6b6b6b,
  block: 0x5a7a9a,
  stagger: 0xe0e0e0,
  hitFlash: 0xf0dede,
} as const;

const BOSS_COLORS = {
  idle: 0x6b2a3a,
  startup: 0xd4a017,
  active: 0xd0454a,
  recovery: 0x4a3040,
  staggered: 0xe0e0e0,
  collapsed: 0xffd54a, // posture broken — the critical window, unmistakable
  hitFlash: 0x8a5a4a,
} as const;

export class CombatScene extends Phaser.Scene {
  private sim!: PlayerCombatState;
  private ctx!: StepContext;
  private boss!: BossCombatState;
  private bossCtx!: BossStepContext;
  private accumulator = 0;
  private bossHitFlash = 0;
  private playerHitFlash = 0;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private player!: Phaser.GameObjects.Rectangle;
  private facingPip!: Phaser.GameObjects.Rectangle;
  private groundBar!: Phaser.GameObjects.Rectangle;
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private lastStatus = '';

  private bossRect!: Phaser.GameObjects.Rectangle;
  private bossFacingPip!: Phaser.GameObjects.Rectangle;
  private bossHpBar!: Phaser.GameObjects.Rectangle;
  private bossPostureBar!: Phaser.GameObjects.Rectangle;
  private bossStatusText!: Phaser.GameObjects.Text;
  private lastBossStatus = '';

  /** Derived layout, recomputed by relayout() whenever the canvas resizes. */
  private groundY = 0;

  /** False until the player first acts (moves/attacks/dodges/blocks) — while
   * false, resizes re-spawn entities at their ratio positions. */
  private fightStarted = false;

  constructor() {
    super('combat');
  }

  create(): void {
    this.sim = createPlayerState(this.scale.width * PLAYER_START_X_RATIO);
    this.ctx = {
      build: { vitality: 10, health: 10, dexterity: 10, intelligence: 10 },
      minX: ARENA_MARGIN,
      maxX: this.scale.width - ARENA_MARGIN,
    };

    // Fresh seed per session: fights vary run to run, but any single fight is
    // internally deterministic (BOSS_AI.md §4) — log it so a bad run is reproducible.
    const seed = Math.floor(Math.random() * 0xffffffff);
    console.log(`[combat] Margit seed: ${seed}`);
    this.boss = createBossState(this.scale.width * BOSS_START_X_RATIO, seed);
    this.bossCtx = {
      table: margitMoves,
      topLevelIds: margitTopLevelMoveIds,
      playerX: this.sim.x,
      minX: ARENA_MARGIN,
      maxX: this.scale.width - ARENA_MARGIN,
      lastPlayerAction: null,
      weightRules: margitWeightRules,
      observed: {
        playerBlocking: false,
        dodgeStarted: false,
        attackStarted: false,
        punishableOpening: false,
      },
    };

    this.groundBar = this.add.rectangle(0, 0, 0, 4, 0x8a7a5c);
    this.titleText = this.add
      .text(0, 40, 'MARGIT, THE FELL OMEN', {
        fontFamily: 'serif',
        fontSize: '22px',
        color: '#d4c9a8',
      })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'A/D move · Space dodge · J light · K heavy · Shift block', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#6b6b6b',
      })
      .setOrigin(0.5);

    this.player = this.add.rectangle(this.sim.x, 0, PLAYER_W, PLAYER_H, PLAYER_COLORS.idle);
    this.facingPip = this.add.rectangle(0, 0, 8, 8, 0x141210);

    this.bossRect = this.add
      .rectangle(this.boss.x, 0, BOSS_W, BOSS_H, BOSS_COLORS.idle)
      .setStrokeStyle(2, 0x2a1018);
    this.bossFacingPip = this.add.rectangle(0, 0, 8, 8, 0x141210);

    // Player HUD — top-left.
    this.add.rectangle(20, 70, HUD_BAR_WIDTH, 12, 0x2a2a2a).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(20, 70, HUD_BAR_WIDTH, 12, 0x8a3a3a).setOrigin(0, 0.5);
    this.add.rectangle(20, 88, HUD_BAR_WIDTH, 8, 0x2a2a2a).setOrigin(0, 0.5);
    this.staminaBar = this.add.rectangle(20, 88, HUD_BAR_WIDTH, 8, 0x3a8a5a).setOrigin(0, 0.5);
    this.statusText = this.add.text(20, 100, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#8a8a8a',
    });

    // Boss HUD — top-right, positioned in relayout() (depends on width).
    this.add.rectangle(0, 70, HUD_BAR_WIDTH, 12, 0x2a2a2a).setName('bossHpBg').setOrigin(1, 0.5);
    this.bossHpBar = this.add.rectangle(0, 70, HUD_BAR_WIDTH, 12, 0x6b2a3a).setOrigin(1, 0.5);
    this.add
      .rectangle(0, 88, HUD_BAR_WIDTH, 8, 0x2a2a2a)
      .setName('bossPostureBg')
      .setOrigin(1, 0.5);
    this.bossPostureBar = this.add.rectangle(0, 88, HUD_BAR_WIDTH, 8, 0xd4a017).setOrigin(1, 0.5);
    this.bossStatusText = this.add
      .text(0, 100, '', { fontFamily: 'monospace', fontSize: '12px', color: '#8a8a8a' })
      .setOrigin(1, 0);

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

  /** Recompute every size-dependent position. Mid-fight, entity x is clamped
   * (never teleported); before the fight begins, entities re-spawn at their
   * ratio positions — the canvas's create()-time width can be a pre-layout
   * junk value (tiny), and clamping alone would leave both entities stuck in
   * a corner spawned from it. */
  private relayout(width: number, height: number): void {
    this.groundY = height - GROUND_MARGIN_BOTTOM;

    this.ctx.minX = ARENA_MARGIN;
    this.ctx.maxX = width - ARENA_MARGIN;
    this.bossCtx.minX = ARENA_MARGIN;
    this.bossCtx.maxX = width - ARENA_MARGIN;

    if (!this.fightStarted) {
      this.sim.x = width * PLAYER_START_X_RATIO;
      this.boss.x = width * BOSS_START_X_RATIO;
    }
    this.sim.x = Math.max(this.ctx.minX, Math.min(this.ctx.maxX, this.sim.x));
    this.boss.x = Math.max(this.bossCtx.minX, Math.min(this.bossCtx.maxX, this.boss.x));

    this.groundBar.setPosition(width / 2, this.groundY + 2);
    this.groundBar.setSize(width - ARENA_MARGIN * 2, 4);
    this.titleText.setX(width / 2);
    this.hintText.setPosition(width / 2, height - 28);

    this.player.setY(this.groundY - PLAYER_H / 2);
    this.facingPip.setY(this.groundY - PLAYER_H + 8);

    this.bossRect.setY(this.groundY - BOSS_H / 2);
    this.bossFacingPip.setY(this.groundY - BOSS_H + 10);

    const bossHudX = width - 20;
    (this.children.getByName('bossHpBg') as Phaser.GameObjects.Rectangle)?.setPosition(
      bossHudX,
      70,
    );
    this.bossHpBar.setPosition(bossHudX, 70);
    (this.children.getByName('bossPostureBg') as Phaser.GameObjects.Rectangle)?.setPosition(
      bossHudX,
      88,
    );
    this.bossPostureBar.setPosition(bossHudX, 88);
    this.bossStatusText.setPosition(bossHudX, 100);
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
      if (
        !this.fightStarted &&
        (input.moveX !== 0 || input.light || input.heavy || input.dodge || input.block)
      ) {
        this.fightStarted = true;
      }
      const playerResult = step(this.sim, input, this.ctx);
      this.sim = playerResult.state;
      for (const e of playerResult.events) {
        if (e.type === 'attack:active') this.resolvePlayerAttackOnBoss(e.id);
      }

      this.bossCtx.playerX = this.sim.x;
      // This tick's player telemetry for the behavior tracker (BOSS_AI.md §5).
      // Starts come from the sim's own action:start events — the authoritative
      // signal — never re-derived from state shape (tickInPhase resets on
      // every phase change, so shape-probing counted one dodge three times).
      this.bossCtx.observed = {
        playerBlocking: isBlocking(this.sim),
        dodgeStarted: playerResult.events.some(
          (e) => e.type === 'action:start' && e.id === 'dodge',
        ),
        attackStarted: playerResult.events.some(
          (e) => e.type === 'action:start' && (e.id === 'light' || e.id === 'heavy'),
        ),
        // One shared definition of an opening (engine layer) — the headless
        // bot harness (#14) exercises PUNISH through the same predicate.
        punishableOpening: isPunishableOpening(this.sim, Math.abs(this.boss.x - this.sim.x)),
      };
      const bossResult = bossStep(this.boss, this.bossCtx);
      this.boss = bossResult.state;
      for (const e of bossResult.events) {
        if (e.type === 'move:active') this.resolveBossAttackOnPlayer(e.move);
        // The boss acting also marks the fight as begun — a pre-input resize
        // must not teleport a boss that's already mid-approach/mid-move.
        if (e.type === 'move:start') this.fightStarted = true;
      }

      this.accumulator -= TICK_MS;
      firstTick = false;
    }

    this.render();
  }

  private facingEachOther(): { playerFaces: boolean; distance: number } {
    const distance = Math.abs(this.boss.x - this.sim.x);
    const playerFaces = this.sim.facing === (this.boss.x >= this.sim.x ? 1 : -1);
    return { playerFaces, distance };
  }

  private resolvePlayerAttackOnBoss(attackId: 'light' | 'heavy'): void {
    const { playerFaces, distance } = this.facingEachOther();
    if (!playerFaces || distance > PLAYER_ATTACK_RANGE) return;

    const dmg = ATTACK_DAMAGE[attackId];
    // Punishing a move's recovery risks extra posture damage — the move
    // declares how much via postureSelfRisk (BOSS_AI.md §4).
    const currentMove = this.boss.action ? margitMoves[this.boss.action.moveId] : undefined;
    const punishBonus =
      this.boss.action?.phase === 'recovery' && currentMove ? currentMove.postureSelfRisk : 0;

    const result = resolveBossHit(this.boss, {
      hp: dmg.hp,
      poise: dmg.poise,
      postureDamage: dmg.poise + punishBonus,
    });
    this.boss = result.state;
    // The tracker learns which recoveries the player punishes (§5 punishPattern).
    this.boss = observeTrackerEvent(this.boss, {
      type: 'hit:landed',
      onBossRecovery: punishBonus > 0,
    });
    this.bossHitFlash = result.wasCritical ? 16 : 8;
  }

  private resolveBossAttackOnPlayer(move: MoveDef): void {
    const distance = Math.abs(this.sim.x - this.boss.x);
    const bossFaces = this.boss.facing === (this.sim.x >= this.boss.x ? 1 : -1);
    // v1: the move's selection range band doubles as its hit reach — a
    // boss-specific hitbox-reach field can be split out if a move ever needs
    // to select at one range but hit at another.
    if (!bossFaces || distance > move.rangeBand[1]) {
      // Never connected — no action to report to the next combo decision.
      this.bossCtx.lastPlayerAction = null;
      return;
    }

    const result = resolveIncomingHit(
      this.sim,
      { hp: move.damage, poise: move.poiseDamage },
      this.ctx.build,
    );
    this.sim = result.state;

    // Feed combo branch conditions (e.g. "punish if they dodged", BOSS_AI.md
    // §4) and give the player the same hit-connect feedback the boss gets —
    // but only for outcomes with a real consequence; a clean dodge already
    // reads visually via the i-frame alpha, so it doesn't also flash.
    if (result.result === 'dodged') {
      this.bossCtx.lastPlayerAction = 'dodge';
      this.boss = observeTrackerEvent(this.boss, { type: 'dodge:iframe-success' });
    } else if (result.result === 'blocked') {
      this.bossCtx.lastPlayerAction = 'block';
      this.playerHitFlash = 8;
    } else {
      this.bossCtx.lastPlayerAction = null;
      this.playerHitFlash = 8;
    }
  }

  private render(): void {
    this.renderPlayer();
    this.renderBoss();
  }

  private renderPlayer(): void {
    const s = this.sim;
    this.player.x = s.x;

    let color: number = PLAYER_COLORS.idle;
    const a = s.action;
    if (isStaggered(s)) {
      color = PLAYER_COLORS.stagger;
    } else if (a) {
      if (a.id === 'dodge')
        color = isInvulnerable(s) ? PLAYER_COLORS.iframe : PLAYER_COLORS.recovery;
      else if (isBlocking(s)) color = PLAYER_COLORS.block;
      else if (a.phase === 'startup') color = PLAYER_COLORS.startup;
      else if (a.phase === 'active') color = PLAYER_COLORS.attack;
      else color = PLAYER_COLORS.recovery;
    }
    if (this.playerHitFlash > 0) {
      this.playerHitFlash -= 1;
      color = PLAYER_COLORS.hitFlash;
    }
    this.player.fillColor = color;
    this.player.alpha = isInvulnerable(s) ? 0.5 : 1;

    this.facingPip.x = s.x + (s.facing === 1 ? PLAYER_W / 2 - 4 : -PLAYER_W / 2 + 4);

    this.hpBar.width = HUD_BAR_WIDTH * (s.hp / BASE_MAX_HP);
    this.staminaBar.width = HUD_BAR_WIDTH * (s.stamina / BASE_MAX_STAMINA);
    const mode = isStaggered(s)
      ? `STAGGERED (${s.staggerTicks})`
      : a
        ? `${a.id}/${a.phase}`
        : 'idle';
    const status = `you — ${mode}   hp:${s.hp.toFixed(0)}   stam:${s.stamina.toFixed(0)}   poise dmg:${s.poiseDamage.toFixed(0)}`;
    if (status !== this.lastStatus) {
      this.statusText.setText(status);
      this.lastStatus = status;
    }
  }

  private renderBoss(): void {
    const b = this.boss;
    this.bossRect.x = b.x;

    const collapsed = isCriticalWindowOpen(b.posture);
    let color: number = BOSS_COLORS.idle;
    if (collapsed) {
      color = BOSS_COLORS.collapsed;
    } else if (isBossStaggered(b)) {
      color = BOSS_COLORS.staggered;
    } else if (b.action) {
      color =
        b.action.phase === 'startup'
          ? BOSS_COLORS.startup
          : b.action.phase === 'active'
            ? BOSS_COLORS.active
            : BOSS_COLORS.recovery;
    }
    if (this.bossHitFlash > 0) {
      this.bossHitFlash -= 1;
      color = BOSS_COLORS.hitFlash;
    }
    this.bossRect.fillColor = color;

    this.bossFacingPip.x = b.x + (b.facing === 1 ? BOSS_W / 2 - 4 : -BOSS_W / 2 + 4);

    this.bossHpBar.width = HUD_BAR_WIDTH * Math.max(0, b.hp / BOSS_BASE_MAX_HP);
    this.bossPostureBar.width = HUD_BAR_WIDTH * (b.posture.value / POSTURE_MAX);

    const mode = collapsed
      ? `CRITICAL WINDOW (${b.posture.criticalTicks})`
      : isBossStaggered(b)
        ? `STAGGERED (${b.staggerTicks})`
        : b.action
          ? `${b.action.moveId}/${b.action.phase}`
          : 'idle';
    const status = `MARGIT — ${mode}   intent:${b.tactic.current}   hp:${b.hp.toFixed(0)}   posture:${b.posture.value.toFixed(0)}`;
    if (status !== this.lastBossStatus) {
      this.bossStatusText.setText(status);
      this.lastBossStatus = status;
    }
  }
}
