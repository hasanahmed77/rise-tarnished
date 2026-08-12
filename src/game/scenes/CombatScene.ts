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
import {
  MAX_LOGGED_DECISIONS,
  type DecisionEvent,
  type DecisionLayer,
  type SignalContribution,
} from '../boss/decisionLog';
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
import {
  AMBIENCE_FADE_MS,
  AMBIENCE_KEY,
  AMBIENCE_VOLUME,
  SFX_KEYS,
  SFX_VOLUME,
  audioPath,
  type SfxKey,
} from '../audio/soundManifest';
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

/** Real-time ms the death sequence's first beat (PF/MF.death.reel) holds
 * before settling on the final prone pose (#42 part 2b). Real time, not
 * ticks: the sim stops advancing the instant hp hits 0, so there are no
 * ticks left to time this off of — see update()'s deathAnimMs tracking. */
const DEATH_REEL_MS = 450;

export class CombatScene extends Phaser.Scene {
  private sim!: PlayerCombatState;
  private ctx!: StepContext;
  private boss!: BossCombatState;
  private bossCtx!: BossStepContext;
  private accumulator = 0;
  private bossHitFlash = 0;
  private playerHitFlash = 0;
  /** Remaining real-time ms of a hard freeze-frame on impact (#42 part 2b).
   * See triggerHitstop() and its use at the top of update(). */
  private hitstopMs = 0;
  /** Real-time ms since `finished` went true — times the death sequence's
   * reel → prone hold, since the sim itself stops advancing at that point. */
  private deathAnimMs = 0;

  private bridge?: GameBridge;
  private attemptId!: string;
  private tickCount = 0;
  /**
   * The boss's L2/L3 decisions this attempt (#55, BOSS_AI.md §8). Lives in the
   * scene, not in `boss`, for two reasons: the sim stays a pure function whose
   * state is cloned every tick (an append-only array in there would be shared
   * mutable state across that boundary), and the tick counter plus the player's
   * hp/stamina are shell facts — the boss AI reads player *behaviour*, never
   * player stats, and this must not become a back door to that.
   */
  private decisionLog: DecisionEvent[] = [];
  /** True once a terminal HP state has been detected and reported — freezes
   * the sim loop so nothing acts (or reports a second outcome) after death. */
  private finished = false;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private muteKey!: Phaser.Input.Keyboard.Key;
  /** The looping ambience bed, once the browser has let audio start. */
  private ambience?: Phaser.Sound.BaseSound;

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

    // Generated by `npm run audio` (scripts/generate-audio.mjs) and committed,
    // same as the sprites.
    for (const key of SFX_KEYS) this.load.audio(key, audioPath(key));
    this.load.audio(AMBIENCE_KEY, audioPath(AMBIENCE_KEY));
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

    this.muteKey = this.input.keyboard!.addKey('M');

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.ambience?.stop();
      this.ambience?.destroy();
      this.ambience = undefined;
    });

    this.startAmbience();

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
    // Reset alongside the sim it describes. `attemptId` is minted once per
    // scene instance, so in practice this runs once — but the log must not be
    // able to carry decisions from a previous sim into a new attempt's row.
    this.decisionLog = [];
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
    // Polled before the ready/hitstop gates: muting must work while the fight
    // is frozen or still loading, not only when the sim happens to be running.
    this.updateMuteToggle();

    // Waiting on 'fight:start' to carry the real build — nothing to
    // simulate or render yet (see startFight()).
    if (!this.ready) return;

    // Hitstop (#42 part 2b): a hard freeze on impact, weighted by how much
    // the hit mattered (see triggerHitstop's call sites). Real-time, not
    // tick-based — the accumulator doesn't grow and no ticks are consumed
    // while frozen, so every fairness invariant (F1-F8) that counts ticks is
    // untouched: this delays wall-clock time equally for both combatants,
    // it never changes what a tick means. Input during the freeze isn't
    // lost either — sampleInput (and so JustDown) simply isn't called on
    // these frames, so Phaser's own edge-detection still reports it truthfully
    // on the first frame after the freeze ends.
    if (this.hitstopMs > 0) {
      this.hitstopMs = Math.max(0, this.hitstopMs - delta);
      this.render();
      return;
    }

    // The sim stops the instant a terminal HP state is reported (`finished`,
    // below), which also stops it from being able to drive an animation —
    // so the death sequence's timing (reel → prone) is tracked here instead,
    // off real elapsed time rather than ticks.
    if (this.finished) this.deathAnimMs += delta;

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
        // Dodge and cast have no cross-entity resolution to hang audio off,
        // so they're voiced straight from the sim's own action:start events.
        if (e.type === 'action:start' && e.id === 'dodge') {
          this.sfx('dodge', { detuneCents: this.spread(150) });
        }
        if (e.type === 'action:start' && e.id === 'cast') {
          this.sfx('cast', { detuneCents: this.spread(60) });
        }
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
        if (e.type === 'move:start') {
          this.fightStarted = true;
          this.recordDecision('action', e.moveId, e.because);
        }
        if (e.type === 'tactic:change') this.recordDecision('tactic', e.tactic, e.because);
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

  /**
   * Append one L2/L3 decision to the attempt log (#55, BOSS_AI.md §8).
   *
   * Called only from `move:start` and `tactic:change`, which is what keeps the
   * log bounded: L2 re-scores every tick but only *changes* every 2-5s, and L3
   * picks a move roughly once a second, so a full fight yields tens of entries
   * rather than one per tick. MAX_LOGGED_DECISIONS is the backstop for a
   * pathological attrition fight — dropping the tail rather than the head keeps
   * the opening of the fight, but the killing blow is what #13's recap needs
   * most, so the *oldest* entry is evicted instead.
   */
  private recordDecision(
    layer: DecisionLayer,
    chose: string,
    becauseSignals: SignalContribution[],
  ): void {
    if (this.decisionLog.length >= MAX_LOGGED_DECISIONS) this.decisionLog.shift();
    this.decisionLog.push({
      tick: this.tickCount,
      layer,
      chose,
      becauseSignals,
      playerStateSnapshot: {
        hp: Math.round(this.sim.hp),
        stamina: Math.round(this.sim.stamina),
        distance: Math.round(Math.abs(this.boss.x - this.sim.x)),
        action: this.sim.action?.id ?? null,
      },
    });
  }

  private reportOutcome(result: FightResult): void {
    this.finished = true;

    // The death toll plays either way — someone died, and the sound is about
    // the ending rather than about who won.
    this.sfx('death');
    // Pull the ambience down with it. Leaving a drone running under the
    // outcome overlay makes the fight feel like it hasn't actually stopped.
    if (this.ambience) {
      this.tweens.add({
        targets: this.ambience,
        volume: 0,
        duration: AMBIENCE_FADE_MS,
        ease: 'Sine.easeOut',
      });
    }

    this.bridge?.toShell.emit('fight:outcome', {
      attemptId: this.attemptId,
      bossId: MARGIT_BOSS_ID,
      result,
      durationTicks: this.tickCount,
      estimatedRuneDelta: computeRuneReward(result, MARGIT_RUNE_REWARD),
      decisionLog: this.decisionLog,
    });
  }

  private facingEachOther(): { playerFaces: boolean; distance: number } {
    const distance = Math.abs(this.boss.x - this.sim.x);
    const playerFaces = this.sim.facing === (this.boss.x >= this.sim.x ? 1 : -1);
    return { playerFaces, distance };
  }

  private resolvePlayerAttackOnBoss(attackId: 'light' | 'heavy'): void {
    // The arc and the whoosh both play on every swing, hit or miss — whiffing
    // should look and sound like a swing, not like nothing happened.
    this.spawnSlash(attackId === 'heavy');
    this.sfx(attackId === 'heavy' ? 'swing-heavy' : 'swing-light', {
      detuneCents: this.spread(120),
    });

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
    this.triggerHitstop(result.wasCritical ? 90 : attackId === 'heavy' ? 60 : 40);
    this.sfx(result.wasCritical ? 'hit-critical' : 'hit', { detuneCents: this.spread(90) });
  }

  /** Camera shake, budgeted per COMBAT_SYSTEM.md §8 (screen shake is
   * explicitly a budgeted effect with an accessibility toggle planned). */
  private shake(intensity: number, duration = 110): void {
    this.cameras.main.shake(duration, intensity, true);
  }

  /** Fire a one-shot sound at its manifest volume.
   *
   * `detune` spreads repeated sounds slightly so a flurry of light attacks
   * doesn't machine-gun the identical sample — the single cheapest thing that
   * stops short SFX sounding robotic. */
  private sfx(key: SfxKey, { detuneCents = 0 } = {}): void {
    if (this.sound.locked) return; // pre-gesture: nothing can play yet
    this.sound.play(key, {
      volume: SFX_VOLUME[key],
      detune: detuneCents,
    });
  }

  /** A small random pitch offset, in cents. */
  private spread(cents: number): number {
    return Math.round((Math.random() * 2 - 1) * cents);
  }

  /** Start the looping ambience, respecting browser autoplay policy.
   *
   * Browsers refuse audio until the user has interacted with the page, and
   * Phaser exposes that as `sound.locked` plus an 'unlocked' event. Starting
   * unconditionally would silently no-op on a fresh load, so this defers to
   * the unlock when needed. Fades in because it may well begin partway
   * through a fight, and a drone snapping to full volume is exactly the kind
   * of thing "subtle" rules out. */
  private startAmbience(): void {
    const begin = (): void => {
      if (this.ambience) return;
      this.ambience = this.sound.add(AMBIENCE_KEY, { loop: true, volume: 0 });
      this.ambience.play();
      this.tweens.add({
        targets: this.ambience,
        volume: AMBIENCE_VOLUME,
        duration: AMBIENCE_FADE_MS,
        ease: 'Sine.easeIn',
      });
    };

    if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, begin);
    else begin();
  }

  /** Mute toggle (M). COMBAT_SYSTEM.md §8 already calls for an accessibility
   * toggle on screen shake; audio deserves the same courtesy, and a key is
   * the cheapest version of it until a settings surface exists. */
  private updateMuteToggle(): void {
    if (Phaser.Input.Keyboard.JustDown(this.muteKey)) {
      this.sound.mute = !this.sound.mute;
    }
  }

  /** Freeze-frame on impact (#42 part 2b), applied at the top of update().
   * `Math.max`, not addition — two hits landing the same frame (e.g. a
   * critical that also breaks posture) hold for the bigger one, not their
   * sum; hitstop is meant to sell a moment, not compound into a stall. */
  private triggerHitstop(ms: number): void {
    this.hitstopMs = Math.max(this.hitstopMs, ms);
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
      this.triggerHitstop(result.wasCritical ? 90 : 50);
      this.sfx(result.wasCritical ? 'hit-critical' : 'hit', { detuneCents: this.spread(90) });
      hitIds.add(p.id);
    }
    // Consume connecting bolts so a single cast can't multi-hit across ticks.
    if (hitIds.size > 0) this.sim = consumeProjectiles(this.sim, hitIds);
  }

  private resolveBossAttackOnPlayer(move: MoveDef): void {
    // Spawned before the range test, so a whiff still shows the swing — and
    // shows exactly how far short it fell.
    this.spawnBossStrike(move);
    this.sfx('swing-boss', { detuneCents: this.spread(140) });

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
      this.triggerHitstop(30);
      this.sfx('block', { detuneCents: this.spread(120) });
    } else {
      this.bossCtx.lastPlayerAction = null;
      this.playerHitFlash = 8;
      // Taking a clean hit shakes hardest — it's the one the player most
      // needs to feel, and the only one they're punished for.
      this.shake(0.014, 150);
      this.triggerHitstop(80);
      this.sfx('hurt', { detuneCents: this.spread(80) });
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
    if (s.hp <= 0) return this.deathAnimMs < DEATH_REEL_MS ? PF.death.reel : PF.death.prone;
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
    if (b.hp <= 0) return this.deathAnimMs < DEATH_REEL_MS ? MF.death.reel : MF.death.prone;
    if (collapsed) return MF.collapsed;
    if (isBossStaggered(b)) return MF.staggered;
    if (b.action) {
      if (b.action.phase === 'recovery') return MF.recovery;
      // Per-move tell/active (#42 part 2) — every move gets its own
      // silhouette instead of one shared windup/swing. Falls back to
      // cane_swing_1's frames only if a move is ever added without art;
      // spriteFrames.test.ts asserts that never happens in practice.
      const frames =
        (MF.moves as Record<string, { tell: number; active: number }>)[b.action.moveId] ??
        MF.moves['margit.cane_swing_1'];
      return b.action.phase === 'startup' ? frames.tell : frames.active;
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
