import Phaser from 'phaser';
import type { GameBridge, PlayerBuild } from '../bridge';
import {
  ATTACK_DAMAGE,
  POSTURE_MAX,
  maxFp,
  maxHp,
  maxStamina,
  meleeDamage,
} from '../combat/frameData';
import {
  consumeProjectiles,
  createPlayerState,
  isBlocking,
  isInvulnerable,
  isStaggered,
  projectileHits,
  resolveIncomingHit,
  step,
  SORCERY_HIT_POISE,
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
import { BOSS_BASE_MAX_HP, MARGIT_BOSS_ID, MARGIT_RUNE_REWARD } from '../boss/bossTuning';
import {
  BOSS_SPRITE_H,
  BOSS_SPRITE_W,
  MF,
  PF,
  PLAYER_SPRITE_H,
  PLAYER_SPRITE_W,
  SLASH_SPRITE,
  STRIKE_HEIGHT_RATIO,
  STRIKE_SPRITE_H,
  STRIKE_SPRITE_W,
} from '../render/spriteFrames';
import { computeRuneReward, type FightResult } from '../attempt/reward';
import { determineFightOutcome } from '../attempt/outcome';
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
const PLAYER_H = 96;
/** Boss half-width used for projectile overlap (#40) — a hit dimension, not
 * a drawing one. */
const BOSS_W = 54;
const ARENA_MARGIN = 40;
const GROUND_MARGIN_BOTTOM = 80;
const BOSS_START_X_RATIO = 0.7;
const PLAYER_START_X_RATIO = 0.25;
const PLAYER_ATTACK_RANGE = 90;
const HUD_BAR_WIDTH = 200;

const PROJECTILE_COLOR = 0x9a7af0;
const PROJECTILE_W = 18;
const PROJECTILE_H = 10;

/** Tints layered over the sprites for states the art alone can't carry
 * (#42). The sprite sheets encode *pose*; these encode *momentary status* —
 * a hit landing, a critical window opening. Everything else renders untinted
 * so the art reads as drawn. */
const HIT_FLASH_TINT = 0xffd9d9;
const CRITICAL_TINT = 0xffd54a;
const IFRAME_ALPHA = 0.45;

/** Ticks each idle/run frame is held — the sim runs at 60Hz, animation
 * doesn't need to. */
const IDLE_FRAME_TICKS = 30;
const RUN_FRAME_TICKS = 8;

/** How far each background layer drifts per pixel the player moves from the
 * arena centre. The camera never scrolls in this game (the arena is exactly
 * one screen), so parallax is driven by player position instead — enough to
 * give the layers depth without the scene appearing to slide. */
const PARALLAX = { sky: 0.006, far: 0.018, mid: 0.05 } as const;

export class CombatScene extends Phaser.Scene {
  private sim!: PlayerCombatState;
  private ctx!: StepContext;
  private boss!: BossCombatState;
  private bossCtx!: BossStepContext;
  private accumulator = 0;
  private bossHitFlash = 0;
  private playerHitFlash = 0;

  private bridge?: GameBridge;
  private attemptId!: string;
  private tickCount = 0;
  /** True once a terminal HP state has been detected and reported — freezes
   * the sim loop so nothing acts (or reports a second outcome) after death. */
  private finished = false;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private player!: Phaser.GameObjects.Sprite;
  private skyLayer!: Phaser.GameObjects.Image;
  private farLayer!: Phaser.GameObjects.Image;
  private midLayer!: Phaser.GameObjects.Image;
  private groundLayer!: Phaser.GameObjects.Image;
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private fpBar!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private lastStatus = '';

  /** Reused rectangle pool for rendering in-flight sorcery projectiles. */
  private projectileSprites: Phaser.GameObjects.Rectangle[] = [];

  /** Reused pool of one-shot slash VFX sprites (#42's combat juice). */
  private slashSprites: Phaser.GameObjects.Sprite[] = [];

  /** Reused pool of Margit's strike streaks, stretched per move's reach. */
  private strikeSprites: Phaser.GameObjects.Sprite[] = [];

  /** True while the player is free-moving this tick — picks run frames over
   * idle. Free movement only happens with no action committed, so this is
   * false through every attack/dodge/block. */
  private playerMoving = false;

  private bossRect!: Phaser.GameObjects.Sprite;
  private bossHpBar!: Phaser.GameObjects.Rectangle;
  private bossPostureBar!: Phaser.GameObjects.Rectangle;
  private bossStatusText!: Phaser.GameObjects.Text;
  private lastBossStatus = '';

  /** Derived layout, recomputed by relayout() whenever the canvas resizes. */
  private groundY = 0;

  /** False until the player first acts (moves/attacks/dodges/blocks) — while
   * false, resizes re-spawn entities at their ratio positions. */
  private fightStarted = false;

  /** False until 'fight:start' arrives with the player's real build — sim,
   * boss, and entity sprites don't exist yet, so update()/onResize() must
   * not touch them before this flips true (see startFight()). */
  private ready = false;

  constructor() {
    super('combat');
  }

  preload(): void {
    // Generated by `npm run assets` (scripts/generate-sprites.mjs) and
    // committed, so a fresh clone renders without running the generator.
    this.load.image('bg-sky', '/sprites/bg-sky.png');
    this.load.image('bg-far', '/sprites/bg-far.png');
    this.load.image('bg-mid', '/sprites/bg-mid.png');
    this.load.image('bg-ground', '/sprites/bg-ground.png');
    this.load.spritesheet('player', '/sprites/player.png', {
      frameWidth: PLAYER_SPRITE_W,
      frameHeight: PLAYER_SPRITE_H,
    });
    this.load.spritesheet('margit', '/sprites/margit.png', {
      frameWidth: BOSS_SPRITE_W,
      frameHeight: BOSS_SPRITE_H,
    });
    this.load.spritesheet('slash', '/sprites/slash.png', {
      frameWidth: SLASH_SPRITE,
      frameHeight: SLASH_SPRITE,
    });
    this.load.spritesheet('strike', '/sprites/strike.png', {
      frameWidth: STRIKE_SPRITE_W,
      frameHeight: STRIKE_SPRITE_H,
    });
  }

  create(): void {
    this.attemptId = crypto.randomUUID();

    // Backdrop, back to front. Sized/positioned in relayout().
    this.skyLayer = this.add.image(0, 0, 'bg-sky').setOrigin(0.5, 0);
    this.farLayer = this.add.image(0, 0, 'bg-far').setOrigin(0.5, 0);
    this.midLayer = this.add.image(0, 0, 'bg-mid').setOrigin(0.5, 0);
    this.groundLayer = this.add.image(0, 0, 'bg-ground').setOrigin(0.5, 0);

    this.anims.create({
      key: 'slash-arc',
      frames: this.anims.generateFrameNumbers('slash', { start: 0, end: 3 }),
      frameRate: 34,
      hideOnComplete: true,
    });
    this.anims.create({
      key: 'boss-strike',
      frames: this.anims.generateFrameNumbers('strike', { start: 0, end: 3 }),
      frameRate: 30,
      hideOnComplete: true,
    });

    this.titleText = this.add
      .text(0, 40, 'MARGIT, THE FELL OMEN', {
        fontFamily: 'serif',
        fontSize: '22px',
        color: '#d4c9a8',
      })
      .setOrigin(0.5);
    this.hintText = this.add
      .text(0, 0, 'A/D move · Space dodge · J light · K heavy · L cast · Shift block', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#6b6b6b',
      })
      .setOrigin(0.5);

    // Player HUD — top-left. HP (red), stamina (green), FP (blue). Bars sit
    // at their configured width until the fight starts and renderPlayer()
    // begins sizing them from real state.
    this.add.rectangle(20, 70, HUD_BAR_WIDTH, 12, 0x2a2a2a).setOrigin(0, 0.5);
    this.hpBar = this.add.rectangle(20, 70, HUD_BAR_WIDTH, 12, 0x8a3a3a).setOrigin(0, 0.5);
    this.add.rectangle(20, 86, HUD_BAR_WIDTH, 8, 0x2a2a2a).setOrigin(0, 0.5);
    this.staminaBar = this.add.rectangle(20, 86, HUD_BAR_WIDTH, 8, 0x3a8a5a).setOrigin(0, 0.5);
    this.add.rectangle(20, 98, HUD_BAR_WIDTH, 6, 0x2a2a2a).setOrigin(0, 0.5);
    this.fpBar = this.add.rectangle(20, 98, HUD_BAR_WIDTH, 6, 0x4a6bd0).setOrigin(0, 0.5);
    this.statusText = this.add.text(20, 108, 'loading your build…', {
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

    this.keys = this.input.keyboard!.addKeys('A,D,LEFT,RIGHT,SPACE,J,K,L,SHIFT') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

    this.bridge = this.registry.get('bridge') as GameBridge | undefined;
    const offFightStart = this.bridge?.toGame.on('fight:start', (payload) =>
      this.startFight(payload),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => offFightStart?.());
    this.bridge?.toShell.emit('game:ready', undefined);
  }

  /** Everything that depends on the player's real, persisted build (#12):
   * sim/boss state and the entity sprites positioned from it. Runs once,
   * triggered by the shell's 'fight:start' bridge event — the scene is
   * otherwise idle (static HUD chrome only) until this fires. */
  private startFight({ build }: { bossId: string; build: PlayerBuild }): void {
    this.sim = createPlayerState(this.scale.width * PLAYER_START_X_RATIO, build);
    this.ctx = {
      build,
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

    // Origin at the feet: the sim tracks a ground-plane x, and anchoring
    // bottom-centre means differently-sized frames all stand on the same
    // line without per-frame offsets.
    this.player = this.add.sprite(this.sim.x, 0, 'player', PF.idle[0]).setOrigin(0.5, 1);
    this.bossRect = this.add.sprite(this.boss.x, 0, 'margit', MF.idle[0]).setOrigin(0.5, 1);

    this.ready = true;
    this.relayout(this.scale.width, this.scale.height);
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    // Nothing to relayout yet — sim/boss/entities are created in startFight()
    // once the real build arrives; startFight() itself calls relayout() with
    // the scale current at that moment, so a pre-ready resize needs no
    // handling here.
    if (!this.ready) return;
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

    // Backdrop: cover the viewport, keeping each layer's aspect (a squashed
    // castle reads worse than one cropped at the edges). The ground layer is
    // pinned so its lit top edge lands exactly on the sim's ground line.
    const cover = Math.max(width / this.skyLayer.width, this.groundY / this.skyLayer.height);
    for (const layer of [this.skyLayer, this.farLayer, this.midLayer]) {
      layer.setScale(cover);
      layer.setPosition(width / 2, 0);
    }
    const groundScale = Math.max(width / this.groundLayer.width, 1);
    this.groundLayer.setScale(groundScale);
    this.groundLayer.setPosition(width / 2, this.groundY);

    this.titleText.setX(width / 2);
    this.hintText.setPosition(width / 2, height - 28);

    this.player.setY(this.groundY);
    this.bossRect.setY(this.groundY);

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
      cast: edge && Phaser.Input.Keyboard.JustDown(k.L),
      block: k.SHIFT.isDown,
    };
  }

  update(_time: number, delta: number): void {
    // Waiting on 'fight:start' to carry the real build — nothing to
    // simulate or render yet (see startFight()).
    if (!this.ready) return;

    // Cap the accumulator so a long stall (e.g. tab backgrounded) can't trigger
    // a runaway catch-up of hundreds of ticks in one frame.
    this.accumulator = Math.min(this.accumulator + delta, TICK_MS * 5);
    let firstTick = true;
    // Fixed-timestep: consume the accumulator in whole 60Hz ticks. Edge-
    // triggered intents fire only on the first sim tick of this frame so one
    // keypress can't launch several actions. Stops the instant the fight
    // ends (`finished`) — nothing acts, and no second outcome can fire, once
    // a terminal HP state has been reported.
    while (this.accumulator >= TICK_MS && !this.finished) {
      this.tickCount += 1;
      const input = this.sampleInput(firstTick);
      if (
        !this.fightStarted &&
        (input.moveX !== 0 ||
          input.light ||
          input.heavy ||
          input.dodge ||
          input.block ||
          input.cast)
      ) {
        this.fightStarted = true;
      }
      const wasIdle = this.sim.action === null && !isStaggered(this.sim);
      const playerResult = step(this.sim, input, this.ctx);
      this.sim = playerResult.state;
      this.playerMoving = wasIdle && input.moveX !== 0 && this.sim.action === null;
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
          (e) =>
            e.type === 'action:start' && (e.id === 'light' || e.id === 'heavy' || e.id === 'cast'),
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

      // Sorcery projectiles hit the boss the same way melee does — the scene
      // owns cross-entity resolution; the projectile geometry is the pure
      // predicate. A connecting bolt is consumed so it can't multi-hit.
      this.resolveProjectilesOnBoss();

      // Terminal check last, after both entities have acted this tick.
      const outcome = determineFightOutcome(this.boss.hp, this.sim.hp);
      if (outcome) this.reportOutcome(outcome);

      this.accumulator -= TICK_MS;
      firstTick = false;
    }

    this.render();
  }

  private reportOutcome(result: FightResult): void {
    this.finished = true;
    this.bridge?.toShell.emit('fight:outcome', {
      attemptId: this.attemptId,
      bossId: MARGIT_BOSS_ID,
      result,
      durationTicks: this.tickCount,
      estimatedRuneDelta: computeRuneReward(result, MARGIT_RUNE_REWARD),
    });
  }

  private facingEachOther(): { playerFaces: boolean; distance: number } {
    const distance = Math.abs(this.boss.x - this.sim.x);
    const playerFaces = this.sim.facing === (this.boss.x >= this.sim.x ? 1 : -1);
    return { playerFaces, distance };
  }

  private resolvePlayerAttackOnBoss(attackId: 'light' | 'heavy'): void {
    // The arc plays on every swing, hit or miss — whiffing should look like
    // a swing, not like nothing happened.
    this.spawnSlash(attackId === 'heavy');

    const { playerFaces, distance } = this.facingEachOther();
    if (!playerFaces || distance > PLAYER_ATTACK_RANGE) return;

    const dmg = ATTACK_DAMAGE[attackId];
    // Punishing a move's recovery risks extra posture damage — the move
    // declares how much via postureSelfRisk (BOSS_AI.md §4).
    const currentMove = this.boss.action ? margitMoves[this.boss.action.moveId] : undefined;
    const punishBonus =
      this.boss.action?.phase === 'recovery' && currentMove ? currentMove.postureSelfRisk : 0;

    const result = resolveBossHit(this.boss, {
      hp: meleeDamage(attackId, this.ctx.build.dexterity),
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
    // Weight: a critical shakes hardest, a heavy more than a light.
    this.shake(result.wasCritical ? 0.012 : attackId === 'heavy' ? 0.006 : 0.003);
  }

  /** Camera shake, budgeted per COMBAT_SYSTEM.md §8 (screen shake is
   * explicitly a budgeted effect with an accessibility toggle planned). */
  private shake(intensity: number, duration = 110): void {
    this.cameras.main.shake(duration, intensity, true);
  }

  private resolveProjectilesOnBoss(): void {
    if (this.sim.projectiles.length === 0) return;
    const bossHalfWidth = BOSS_W / 2;
    const hitIds = new Set<number>();
    for (const p of this.sim.projectiles) {
      // A bolt can only connect travelling toward the boss — without this, a
      // point-blank cast facing away from the boss still registers a hit,
      // since projectileHits is a pure x-overlap check with no direction.
      const travelsTowardBoss = p.facing === (this.boss.x >= p.x ? 1 : -1);
      if (!travelsTowardBoss || !projectileHits(p, this.boss.x, bossHalfWidth)) continue;
      const result = resolveBossHit(this.boss, {
        hp: p.damage,
        poise: SORCERY_HIT_POISE,
        postureDamage: SORCERY_HIT_POISE,
      });
      this.boss = result.state;
      this.bossHitFlash = result.wasCritical ? 16 : 8;
      this.shake(result.wasCritical ? 0.012 : 0.005);
      hitIds.add(p.id);
    }
    // Consume connecting bolts so a single cast can't multi-hit across ticks.
    if (hitIds.size > 0) this.sim = consumeProjectiles(this.sim, hitIds);
  }

  private resolveBossAttackOnPlayer(move: MoveDef): void {
    // Spawned before the range test, so a whiff still shows the swing — and
    // shows exactly how far short it fell.
    this.spawnBossStrike(move);

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
      this.shake(0.004);
    } else {
      this.bossCtx.lastPlayerAction = null;
      this.playerHitFlash = 8;
      // Taking a clean hit shakes hardest — it's the one the player most
      // needs to feel, and the only one they're punished for.
      this.shake(0.014, 150);
    }
  }

  private render(): void {
    this.renderPlayer();
    this.renderBoss();
  }

  /** Drift the backdrop layers against the player's offset from centre.
   * Nearer layers move more, which reads as depth without a scrolling
   * camera (the arena is exactly one screen wide). */
  private updateParallax(): void {
    const centre = this.scale.width / 2;
    const offset = this.sim.x - centre;
    this.skyLayer.x = centre - offset * PARALLAX.sky;
    this.farLayer.x = centre - offset * PARALLAX.far;
    this.midLayer.x = centre - offset * PARALLAX.mid;
  }

  /** One-shot slash arc, pooled. Spawned from the *sim's* attack:active
   * event so the VFX can never drift out of sync with the real hitbox. */
  private spawnSlash(heavy: boolean): void {
    let sprite = this.slashSprites.find((s) => !s.visible);
    if (!sprite) {
      sprite = this.add.sprite(0, 0, 'slash', 0).setOrigin(0.5, 0.5);
      this.slashSprites.push(sprite);
    }
    const facing = this.sim.facing;
    sprite
      .setPosition(this.sim.x + facing * 42, this.groundY - PLAYER_SPRITE_H * 0.5)
      .setFlipX(facing === -1)
      .setScale(heavy ? 1.5 : 1.1)
      .setAlpha(heavy ? 1 : 0.85)
      .setVisible(true)
      .play('slash-arc');
  }

  /** Margit's strike streak, stretched so its far end sits exactly at this
   * move's maximum hit range.
   *
   * This is the fix for "the hit lands even though the cane doesn't touch
   * me": her eight moves hit from 80 to 260 world px, but one drawn cane
   * pose reaches ~90px, so the long thrusts connected from well past
   * anything visible. Driving the length from `move.rangeBand[1]` — the same
   * number `resolveBossAttackOnPlayer` tests against below — means what the
   * player sees reaching them is exactly what can hit them, for every move
   * including any added later. */
  private spawnBossStrike(move: MoveDef): void {
    const reach = move.rangeBand[1];
    let sprite = this.strikeSprites.find((s) => !s.visible);
    if (!sprite) {
      // Origin on the left edge so the streak grows outward from Margit;
      // direction comes from a negative x-scale, which flipX can't do
      // correctly with an off-centre origin.
      sprite = this.add.sprite(0, 0, 'strike', 0).setOrigin(0, 0.5);
      this.strikeSprites.push(sprite);
    }
    const facing = this.boss.facing;
    sprite
      .setPosition(this.boss.x, this.groundY - PLAYER_SPRITE_H * STRIKE_HEIGHT_RATIO)
      .setScale((facing * reach) / STRIKE_SPRITE_W, 1)
      .setVisible(true)
      .play('boss-strike');
  }

  /** Pick the player's sprite frame purely from sim state — the same state
   * the rules already track, so animation can never disagree with what the
   * fight is actually doing (ADR-0001: the scene reads, it never decides). */
  private playerFrame(): number {
    const s = this.sim;
    if (s.hp <= 0) return PF.death;
    if (isStaggered(s)) return PF.stagger;
    const a = s.action;
    if (a) {
      if (a.id === 'block') return PF.block;
      const phases = a.id === 'light' ? PF.light : a.id === 'heavy' ? PF.heavy : null;
      if (phases)
        return a.phase === 'startup'
          ? phases.startup
          : a.phase === 'active'
            ? phases.active
            : phases.recovery;
      if (a.id === 'dodge')
        return a.phase === 'startup'
          ? PF.dodge.startup
          : a.phase === 'active'
            ? PF.dodge.active
            : PF.dodge.recovery;
      if (a.id === 'cast') return a.phase === 'startup' ? PF.cast.startup : PF.cast.active;
    }
    if (this.playerMoving) {
      return PF.run[Math.floor(this.tickCount / RUN_FRAME_TICKS) % PF.run.length];
    }
    return PF.idle[Math.floor(this.tickCount / IDLE_FRAME_TICKS) % PF.idle.length];
  }

  private renderPlayer(): void {
    const s = this.sim;
    this.player.x = s.x;
    this.player.setFrame(this.playerFrame());
    this.player.setFlipX(s.facing === -1);

    if (this.playerHitFlash > 0) {
      this.playerHitFlash -= 1;
      this.player.setTint(HIT_FLASH_TINT);
    } else {
      this.player.clearTint();
    }
    // I-frames stay a transparency cue: it's the one state with no distinct
    // pose (the roll frame covers startup→recovery) and it must be legible
    // at a glance, since dodging correctly is the core defensive read.
    this.player.alpha = isInvulnerable(s) ? IFRAME_ALPHA : 1;

    this.updateParallax();

    this.hpBar.width = HUD_BAR_WIDTH * (s.hp / maxHp(this.ctx.build.vitality));
    this.staminaBar.width = HUD_BAR_WIDTH * (s.stamina / maxStamina(this.ctx.build.vitality));
    this.fpBar.width = HUD_BAR_WIDTH * (s.fp / maxFp(this.ctx.build.intelligence));
    const mode = isStaggered(s)
      ? `STAGGERED (${s.staggerTicks})`
      : s.action
        ? `${s.action.id}/${s.action.phase}`
        : 'idle';
    const status = `you — ${mode}   hp:${s.hp.toFixed(0)}   stam:${s.stamina.toFixed(0)}   fp:${s.fp.toFixed(0)}`;
    if (status !== this.lastStatus) {
      this.statusText.setText(status);
      this.lastStatus = status;
    }

    this.renderProjectiles();
  }

  /** Sync the projectile sprite pool to the live projectiles: reuse/grow the
   * pool, position each to its projectile, hide the rest. */
  private renderProjectiles(): void {
    const projectiles = this.sim.projectiles;
    for (let i = 0; i < projectiles.length; i++) {
      let sprite = this.projectileSprites[i];
      if (!sprite) {
        sprite = this.add.rectangle(0, 0, PROJECTILE_W, PROJECTILE_H, PROJECTILE_COLOR);
        this.projectileSprites[i] = sprite;
      }
      sprite.setPosition(projectiles[i].x, this.groundY - PLAYER_H / 2);
      sprite.setVisible(true);
    }
    for (let i = projectiles.length; i < this.projectileSprites.length; i++) {
      this.projectileSprites[i].setVisible(false);
    }
  }

  private bossFrame(collapsed: boolean): number {
    const b = this.boss;
    if (b.hp <= 0) return MF.death;
    if (collapsed) return MF.collapsed;
    if (isBossStaggered(b)) return MF.staggered;
    if (b.action) {
      return b.action.phase === 'startup'
        ? MF.startup
        : b.action.phase === 'active'
          ? MF.active
          : MF.recovery;
    }
    return MF.idle[Math.floor(this.tickCount / IDLE_FRAME_TICKS) % MF.idle.length];
  }

  private renderBoss(): void {
    const b = this.boss;
    this.bossRect.x = b.x;

    const collapsed = isCriticalWindowOpen(b.posture);
    this.bossRect.setFrame(this.bossFrame(collapsed));
    this.bossRect.setFlipX(b.facing === -1);

    // The critical window is the single most valuable read in the fight, so
    // it gets a tint on top of its own pose — the collapsed frame alone is
    // easy to miss mid-combo.
    if (this.bossHitFlash > 0) {
      this.bossHitFlash -= 1;
      this.bossRect.setTint(HIT_FLASH_TINT);
    } else if (collapsed) {
      this.bossRect.setTint(CRITICAL_TINT);
    } else {
      this.bossRect.clearTint();
    }

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
