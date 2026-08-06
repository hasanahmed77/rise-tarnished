// Generates every sprite/background PNG in public/sprites/ (#42, the visual
// pass). Run with `npm run assets`.
//
// Why generated rather than an asset pack: the art is authored as code, so
// it's original (no licence/attribution surface), regenerable, and reviewable
// as a diff. The rendering layer in CombatScene doesn't care where the
// textures came from — swapping in a bought pack later means replacing the
// PNGs and keeping the frame indices, not rewriting the scene.
//
// Everything is drawn at a small base resolution and nearest-neighbour
// upscaled, which is what gives it a deliberate chunky pixel look instead of
// a blurry one. Frame order here is the contract the scene's animation
// definitions rely on — see PLAYER_FRAMES / MARGIT_FRAMES below.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, mulberry32, rgba, sheet } from './lib/pixel.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sprites');

// Palette — extends the runtime colours CombatScene already used for its
// placeholder rectangles, so the art reads as the same game.
const C = {
  armorDark: rgba('#23262e'),
  armor: rgba('#3f4550'),
  armorLit: rgba('#5f6878'),
  steel: rgba('#8892a3'),
  cloak: rgba('#6b2a3a'),
  cloakDark: rgba('#441923'),
  cloakMid: rgba('#521f2b'),
  bone: rgba('#d9cda6'),
  boneDark: rgba('#a89a76'),
  gold: rgba('#d4a017'),
  goldLit: rgba('#f0c74a'),
  blade: rgba('#aab4c4'),
  bladeLit: rgba('#e8eef7'),
  shadow: rgba('#000000', 0.35),

  omenSkin: rgba('#7f8471'),
  omenSkinDark: rgba('#5c6152'),
  omenSkinLit: rgba('#9aa08a'),
  omenCape: rgba('#4a2030'),
  omenCapeDark: rgba('#331522'),
  omenCapeLit: rgba('#5e2a3d'),

  arcane: rgba('#7a5ad0'),
  arcaneLit: rgba('#b9a3ff'),
};

// Canvases are wider than the figures: the sword and Margit's horns swing
// well outside the body, and a tight canvas clips them off mid-animation.
// The scene's hit dimensions are unrelated to these numbers — this is purely
// how much room the art gets. Changing a size here changes the frame size
// CombatScene loads with, which src/game/render/spriteFrames.ts declares and
// spriteFrames.test.ts asserts against the generated PNGs.
const PLAYER_W = 22;
const PLAYER_H = 32;
const PLAYER_SCALE = 3;
// Margit's canvas is far wider than her body (~24 base units) because her
// cane has to *reach the player*. Her melee moves hit from 80–140 world px
// (margitMoves.ts rangeBand), which at this 3× scale is 27–47 base units
// from her centre — a canvas sized to her body would clip the strike, and
// the only place left to animate would be downward, which reads as slamming
// the ground next to her instead of hitting you. Empty pixels cost almost
// nothing in a deflated PNG; a strike that doesn't reach costs readability,
// which COMBAT_SYSTEM.md §1 makes a pillar.
const MARGIT_W = 68;
const MARGIT_H = 48;
const MARGIT_SCALE = 3;

// ---------------------------------------------------------------------------
// Player — "the Tarnished". Base 22×32, upscaled to 66×96.
// ---------------------------------------------------------------------------

/** Sword poses as (hilt → tip) in base-sprite coordinates, facing right.
 * Kept clear of the torso so the blade reads as a separate object rather
 * than a highlight running down the armour. */
const SWORD_POSES = {
  rest: [15, 22, 19, 9],
  guard: [15, 24, 15, 5],
  windupLight: [13, 13, 3, 6],
  slashLight: [14, 15, 21, 13],
  recoverLight: [14, 18, 20, 23],
  windupHeavy: [13, 11, 12, 1],
  slashHeavy: [14, 14, 21, 21],
  recoverHeavy: [13, 20, 19, 25],
  cast: null,
};

function drawSword(c, poseName) {
  const pose = SWORD_POSES[poseName];
  if (!pose) return;
  const [hx, hy, tx, ty] = pose;
  const dx = tx - hx;
  const dy = ty - hy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Blade body first (thick), then a lit edge along one side and a dark
  // spine along the other — that three-tone read is what makes a 3px-wide
  // shape at this scale look like steel instead of a stripe.
  c.line(hx + ux * 2, hy + uy * 2, tx, ty, C.blade, 2);
  c.line(hx + ux * 2 - uy, hy + uy * 2 + ux, tx - uy * 0.8, ty + ux * 0.8, C.bladeLit, 1);
  c.line(hx + ux * 2 + uy, hy + uy * 2 - ux, tx + uy * 0.8, ty - ux * 0.8, C.armorDark, 1);
  // Point.
  c.px(tx, ty, C.bladeLit);

  // Grip runs *behind* the hilt so the hand reads as holding it. Drawn
  // before the guard so the guard caps it cleanly.
  c.line(hx - ux * 2.5, hy - uy * 2.5, hx, hy, C.armorDark, 2);
  // Crossguard, perpendicular to the blade — thickness 2 and a short span,
  // because a thin diagonal line leaves gaps that become loose 3×3 gold
  // blocks once the sprite is upscaled.
  c.line(hx - uy * 1.6, hy + ux * 1.6, hx + uy * 1.6, hy - ux * 1.6, C.gold, 2);
}

/** One player frame. `legs` picks a stance, `lean` shifts the upper body
 * forward/back, `crouch` drops the whole figure (dodge/stagger). */
function playerFrame({
  legs = 'stand',
  lean = 0,
  crouch = 0,
  sword = 'rest',
  arms = 'side',
  glow = 0,
  prone = false,
  ball = false,
}) {
  const c = new Canvas(PLAYER_W, PLAYER_H);
  const cx = 11;

  // Contact shadow — sells that the figure stands on the ground plane.
  c.ellipse(cx, 30.5, 5, 1.5, C.shadow);

  if (ball) {
    // Dodge roll: a tucked ball, no readable limbs — reads as motion.
    c.ellipse(cx, 24, 5, 5, C.cloakMid);
    c.ellipse(cx, 24, 4, 4, C.armor);
    c.ellipse(cx - 1, 23, 2, 2, C.armorLit);
    c.rect(cx + 2, 21, 3, 1, C.bone);
    return c;
  }

  if (prone) {
    // Death: collapsed forward along the ground.
    c.ellipse(cx, 28, 6, 2.5, C.cloakMid);
    c.rect(cx - 5, 26, 9, 3, C.armor);
    c.rect(cx - 6, 25, 3, 3, C.armorDark);
    c.ellipse(cx + 4, 26, 2, 2, C.armorLit);
    c.rect(cx + 5, 24, 2, 1, C.bone);
    c.line(cx - 6, 29, cx - 1, 29, C.blade, 1);
    return c;
  }

  const top = 3 + crouch;
  const hipY = 19 + crouch;

  // Cloak first — everything else overlaps it.
  c.poly(
    [
      [cx - 4 + lean, top + 4],
      [cx + 4 + lean, top + 4],
      [cx + 6, hipY + 6],
      [cx - 6, hipY + 6],
    ],
    C.cloakDark,
  );
  c.poly(
    [
      [cx - 3 + lean, top + 5],
      [cx + 1 + lean, top + 5],
      [cx + 3, hipY + 5],
      [cx - 4, hipY + 5],
    ],
    C.cloak,
  );

  // Legs.
  const legTop = hipY;
  const legBottom = 29;
  if (legs === 'stand') {
    c.rect(cx - 3, legTop, 2, legBottom - legTop, C.armorDark);
    c.rect(cx + 1, legTop, 2, legBottom - legTop, C.armorDark);
    c.rect(cx - 4, legBottom, 3, 2, C.armor);
    c.rect(cx + 1, legBottom, 3, 2, C.armor);
  } else if (legs === 'runA') {
    c.line(cx - 1, legTop, cx - 4, legBottom, C.armorDark, 2);
    c.line(cx + 1, legTop, cx + 4, legBottom - 2, C.armorDark, 2);
    c.rect(cx - 6, legBottom, 3, 2, C.armor);
    c.rect(cx + 3, legBottom - 2, 3, 2, C.armor);
  } else if (legs === 'runB') {
    c.line(cx - 1, legTop, cx + 3, legBottom, C.armorDark, 2);
    c.line(cx + 1, legTop, cx - 3, legBottom - 2, C.armorDark, 2);
    c.rect(cx + 2, legBottom, 3, 2, C.armor);
    c.rect(cx - 5, legBottom - 2, 3, 2, C.armor);
  } else if (legs === 'pass') {
    // Trailing leg tucked under the body, lead leg planted.
    c.rect(cx - 1, legTop, 2, legBottom - legTop, C.armorDark);
    c.line(cx + 1, legTop, cx + 3, legBottom - 4, C.armorDark, 2);
    c.rect(cx - 2, legBottom, 3, 2, C.armor);
    c.rect(cx + 2, legBottom - 4, 3, 2, C.armor);
  } else if (legs === 'passB') {
    c.rect(cx - 1, legTop, 2, legBottom - legTop, C.armorDark);
    c.line(cx - 1, legTop, cx - 4, legBottom - 4, C.armorDark, 2);
    c.rect(cx - 2, legBottom, 3, 2, C.armor);
    c.rect(cx - 6, legBottom - 4, 3, 2, C.armor);
  } else if (legs === 'lunge') {
    c.line(cx - 1, legTop, cx - 5, legBottom, C.armorDark, 2);
    c.line(cx + 1, legTop, cx + 5, legBottom, C.armorDark, 2);
    c.rect(cx - 7, legBottom, 3, 2, C.armor);
    c.rect(cx + 4, legBottom, 3, 2, C.armor);
  } else if (legs === 'brace') {
    c.rect(cx - 4, legTop, 2, legBottom - legTop, C.armorDark);
    c.rect(cx + 2, legTop, 2, legBottom - legTop, C.armorDark);
    c.rect(cx - 5, legBottom, 3, 2, C.armor);
    c.rect(cx + 2, legBottom, 3, 2, C.armor);
  }

  // Torso.
  c.rect(cx - 3 + lean, top + 5, 6, hipY - top - 4, C.armor);
  c.rect(cx - 2 + lean, top + 6, 4, 4, C.armorLit);
  c.rect(cx - 3 + lean, hipY - 2, 6, 1, C.gold); // belt — one row, or it
  c.rect(cx - 3 + lean, hipY - 1, 6, 1, C.boneDark); // reads as a yellow bar

  // Pauldrons.
  c.rect(cx - 5 + lean, top + 5, 2, 3, C.steel);
  c.rect(cx + 3 + lean, top + 5, 2, 3, C.steel);

  // Arms.
  if (arms === 'side') {
    c.rect(cx - 5 + lean, top + 8, 2, 6, C.armorDark);
    c.rect(cx + 3 + lean, top + 8, 2, 6, C.armorDark);
  } else if (arms === 'forward') {
    c.line(cx + 3 + lean, top + 8, cx + 6, top + 11, C.armorDark, 2);
    c.rect(cx - 5 + lean, top + 8, 2, 6, C.armorDark);
  } else if (arms === 'raised') {
    c.line(cx + 3 + lean, top + 8, cx + 5, top + 3, C.armorDark, 2);
    c.rect(cx - 5 + lean, top + 8, 2, 5, C.armorDark);
  } else if (arms === 'flung') {
    c.line(cx - 4 + lean, top + 8, cx - 7, top + 5, C.armorDark, 2);
    c.line(cx + 3 + lean, top + 8, cx + 6, top + 5, C.armorDark, 2);
  }

  // Head: helm, visor slit, crest.
  c.rect(cx - 2 + lean, top, 5, 6, C.armor);
  c.rect(cx - 2 + lean, top + 1, 5, 1, C.armorLit);
  c.rect(cx - 2 + lean, top + 3, 5, 1, C.armorDark); // visor
  c.rect(cx - 1 + lean, top - 2, 3, 2, C.bone); // crest
  c.rect(cx + lean, top - 3, 1, 1, C.boneDark);

  if (glow > 0) {
    // Sorcery charge in the off hand (#40's cast).
    const gx = cx + 6 + lean;
    const gy = top + 10;
    c.ellipse(gx, gy, 1 + glow, 1 + glow, C.arcane);
    c.ellipse(gx, gy, glow * 0.6, glow * 0.6, C.arcaneLit);
  }

  drawSword(c, sword);
  return c;
}

/** Frame order is the contract CombatScene's animations index into. */
const PLAYER_FRAMES = [
  () => playerFrame({ legs: 'stand', sword: 'rest' }), // 0 idle A
  () => playerFrame({ legs: 'stand', sword: 'rest', crouch: 1 }), // 1 idle B
  // Run cycle: contact → passing → contact → passing, the passing frames
  // lifted a pixel so the gait bobs instead of sliding.
  () => playerFrame({ legs: 'runA', sword: 'rest', lean: 1 }), // 2 run
  () => playerFrame({ legs: 'pass', sword: 'rest', lean: 2, crouch: -1 }), // 3
  () => playerFrame({ legs: 'runB', sword: 'rest', lean: 1 }), // 4
  () => playerFrame({ legs: 'passB', sword: 'rest', lean: 2, crouch: -1 }), // 5
  () => playerFrame({ legs: 'brace', sword: 'windupLight', arms: 'raised', lean: -1 }), // 6
  () => playerFrame({ legs: 'lunge', sword: 'slashLight', arms: 'forward', lean: 2 }), // 7
  () => playerFrame({ legs: 'brace', sword: 'recoverLight', arms: 'forward', lean: 1 }), // 8
  () => playerFrame({ legs: 'brace', sword: 'windupHeavy', arms: 'raised', lean: -2 }), // 9
  () => playerFrame({ legs: 'lunge', sword: 'slashHeavy', arms: 'forward', lean: 2 }), // 10
  () => playerFrame({ legs: 'brace', sword: 'recoverHeavy', arms: 'forward', lean: 1, crouch: 1 }), // 11
  () => playerFrame({ legs: 'lunge', sword: 'rest', crouch: 3, lean: 2 }), // 12 dodge start
  () => playerFrame({ ball: true }), // 13 dodge roll
  () => playerFrame({ legs: 'brace', sword: 'rest', crouch: 2, lean: 1 }), // 14 dodge rise
  () => playerFrame({ legs: 'brace', sword: 'guard', arms: 'forward', crouch: 1 }), // 15 block
  () => playerFrame({ legs: 'brace', sword: 'rest', arms: 'raised', glow: 1.5, lean: -1 }), // 16
  () => playerFrame({ legs: 'lunge', sword: 'rest', arms: 'forward', glow: 3, lean: 2 }), // 17
  () => playerFrame({ legs: 'brace', sword: 'rest', arms: 'flung', lean: -3, crouch: 2 }), // 18 stagger
  () => playerFrame({ prone: true }), // 19 death
];

// ---------------------------------------------------------------------------
// Margit — deliberately larger and heavier than the player. Base 32×48.
// ---------------------------------------------------------------------------

/** Margit's horns sweep out and back rather than straight up — tall vertical
 * horns read as antennae and, at this canvas height, get clipped. */
function drawHorns(c, cx, headY, spread) {
  for (const dir of [-1, 1]) {
    const baseX = cx + dir * 3;
    c.line(baseX, headY, baseX + dir * (spread + 1), headY - 3, C.bone, 2);
    c.line(baseX + dir * (spread + 1), headY - 3, baseX + dir * (spread + 3), headY - 6, C.bone, 2);
    c.line(
      baseX + dir * (spread + 3),
      headY - 6,
      baseX + dir * (spread + 4),
      headY - 8,
      C.boneDark,
      1,
    );
  }
}

function margitFrame({
  pose = 'idle',
  bob = 0,
  lean = 0,
  staff = 'rest',
  collapsed = false,
  prone = false,
  glow = false,
  capeFlare = false,
}) {
  const c = new Canvas(MARGIT_W, MARGIT_H);
  // Body sits at the canvas centre so the sprite's 0.5 origin lands on the
  // sim's boss.x, and so setFlipX mirrors the strike correctly when she
  // turns to face a player on her other side.
  const cx = MARGIT_W / 2;

  c.ellipse(cx, 45.5, 10, 2, C.shadow);

  if (prone) {
    c.ellipse(cx, 42, 12, 4, C.omenCapeDark);
    c.ellipse(cx - 2, 41, 8, 3, C.omenCape);
    c.ellipse(cx + 6, 40, 3, 2.5, C.omenSkinDark);
    drawHorns(c, cx + 6, 39, 2);
    c.line(cx - 10, 44, cx - 2, 43, C.gold, 1);
    return c;
  }

  // Body sits low enough that the horns clear the top of the canvas.
  const top = (collapsed ? 15 : 9) + bob;
  const hipY = collapsed ? 34 : 31;

  // Cape — wide, behind everything. capeFlare widens it for the flurry
  // finisher, whose whole silhouette is meant to read as bigger/wilder than
  // anything else in the table.
  const flareW = capeFlare ? 5 : 0;
  c.poly(
    [
      [cx - 7 + lean, top + 6],
      [cx + 7 + lean, top + 6],
      [cx + 12 + flareW, 44],
      [cx - 12 - flareW, 44],
    ],
    C.omenCapeDark,
  );
  c.poly(
    [
      [cx - 5 + lean, top + 7],
      [cx + 3 + lean, top + 7],
      [cx + 7 + flareW, 43],
      [cx - 9 - flareW, 43],
    ],
    C.omenCape,
  );
  c.poly(
    [
      [cx - 4 + lean, top + 8],
      [cx - 1 + lean, top + 8],
      [cx + 1, 40],
      [cx - 6, 40],
    ],
    C.omenCapeLit,
  );

  // Legs. Each pose reads as a distinct silhouette from the ground up, since
  // that's visible before the cane/arms resolve at this scale — tellFrames
  // exist to be read at a glance (COMBAT_SYSTEM.md §1), not studied.
  if (collapsed) {
    c.rect(cx - 6, hipY, 4, 10, C.omenSkinDark);
    c.rect(cx + 2, hipY, 4, 10, C.omenSkinDark);
    c.rect(cx - 8, 43, 6, 2, C.omenSkinDark);
    c.rect(cx + 2, 43, 6, 2, C.omenSkinDark);
  } else if (pose === 'lunge' || pose === 'leap') {
    const reach = pose === 'leap' ? 12 : 8; // the leap overshoots the swing lunge
    c.line(cx - 1, hipY, cx - reach, 44, C.omenSkinDark, 3);
    c.line(cx + 2, hipY, cx + reach, 44, C.omenSkinDark, 3);
    c.rect(cx - reach - 3, 43, 5, 2, C.omenSkinDark);
    c.rect(cx + reach - 1, 43, 5, 2, C.omenSkinDark);
  } else if (pose === 'coil') {
    // Crouched low and coiled before the leap — bent knees, weight sunk.
    c.line(cx - 2, hipY - 3, cx - 5, 41, C.omenSkinDark, 3);
    c.line(cx + 3, hipY - 3, cx + 6, 41, C.omenSkinDark, 3);
    c.rect(cx - 7, 40, 5, 3, C.omenSkinDark);
    c.rect(cx + 4, 40, 5, 3, C.omenSkinDark);
  } else if (pose === 'kickReady') {
    // Weight settled back onto the trailing leg; the kicking leg lifts.
    c.rect(cx - 5, hipY, 4, 44 - hipY, C.omenSkinDark);
    c.line(cx + 3, hipY, cx + 8, hipY + 8, C.omenSkinDark, 3);
    c.rect(cx - 7, 43, 5, 2, C.omenSkinDark);
    c.rect(cx + 6, hipY + 6, 4, 3, C.omenSkinDark);
  } else if (pose === 'kickOut') {
    // The sweep itself: one leg driven low and wide across the ground.
    c.rect(cx - 5, hipY, 4, 44 - hipY, C.omenSkinDark);
    c.line(cx + 3, hipY, cx + 15, hipY + 10, C.omenSkinDark, 3);
    c.rect(cx - 7, 43, 5, 2, C.omenSkinDark);
    c.rect(cx + 13, hipY + 8, 5, 3, C.omenSkinDark);
  } else {
    c.rect(cx - 5, hipY, 4, 44 - hipY, C.omenSkinDark);
    c.rect(cx + 1, hipY, 4, 44 - hipY, C.omenSkinDark);
    c.rect(cx - 7, 43, 5, 2, C.omenSkinDark);
    c.rect(cx + 1, 43, 5, 2, C.omenSkinDark);
  }

  // Hunched torso — wider at the shoulders than the hips.
  c.poly(
    [
      [cx - 6 + lean, top + 6],
      [cx + 6 + lean, top + 6],
      [cx + 5, hipY + 1],
      [cx - 5, hipY + 1],
    ],
    C.omenSkin,
  );
  c.poly(
    [
      [cx - 4 + lean, top + 7],
      [cx + 1 + lean, top + 7],
      [cx + 1, hipY - 3],
      [cx - 3, hipY - 3],
    ],
    C.omenSkinLit,
  );
  // Gold harness across the chest.
  c.line(cx - 5 + lean, top + 10, cx + 5 + lean, top + 14, C.gold, 1);
  c.rect(cx - 6, hipY - 3, 12, 2, C.gold);

  // Shoulders.
  c.ellipse(cx - 6 + lean, top + 7, 3, 2.5, C.omenSkinDark);
  c.ellipse(cx + 6 + lean, top + 7, 3, 2.5, C.omenSkinDark);

  // Arms.
  // Arms track the cane's grip (except grab's 'reach'/'clutch', where the
  // arms ARE the weapon and the cane goes slack) — a strike with the hand
  // nowhere near the weapon reads as the cane floating.
  if (pose === 'tell') {
    c.line(cx + 6 + lean, top + 8, cx + 6, top - 4, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 10, top + 12, C.omenSkin, 2);
  } else if (pose === 'lunge') {
    c.line(cx + 6 + lean, top + 8, cx + 12, top + 11, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 9, top + 6, C.omenSkin, 2);
  } else if (pose === 'limp') {
    c.line(cx + 6 + lean, top + 8, cx + 9, top + 18, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 9, top + 18, C.omenSkin, 2);
  } else if (pose === 'overhead') {
    // Both arms hauled straight up together — a two-handed grip reads as a
    // much bigger commitment than cane_swing_1's one-handed pull-back,
    // matching delayed_overhead's long tell and high damage.
    c.line(cx + 4 + lean, top + 8, cx + 3, top - 9, C.omenSkin, 2);
    c.line(cx - 4 + lean, top + 8, cx - 3, top - 9, C.omenSkin, 2);
  } else if (pose === 'overheadSlam') {
    c.line(cx + 4 + lean, top + 8, cx + 10, top + 13, C.omenSkin, 2);
    c.line(cx - 4 + lean, top + 8, cx + 2, top + 13, C.omenSkin, 2);
  } else if (pose === 'coil') {
    // Pulled in tight against the chest — coiling, not reaching.
    c.line(cx + 6 + lean, top + 8, cx + 4, top + 12, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 2, top + 13, C.omenSkin, 2);
  } else if (pose === 'leap') {
    c.line(cx + 6 + lean, top + 8, cx + 16, top + 12, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx + 6, top + 10, C.omenSkin, 2);
  } else if (pose === 'kickReady' || pose === 'kickOut') {
    // Arms trail out for balance — the leg is the weapon here, so nothing
    // reaches toward the player the way every cane pose does.
    c.line(cx + 6 + lean, top + 8, cx + 3, top + 14, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 10, top + 9, C.omenSkin, 2);
  } else if (pose === 'reach') {
    // Both arms spread wide, open toward the player — the grab's tell is
    // the claws, not the cane, so this is the one pose where neither arm
    // touches the weapon at all. Reaches well past the shoulder ellipses
    // (radius 3, out to ~cx±9) — anything shorter reads as a shrug, not a
    // grab about to close.
    c.line(cx + 6 + lean, top + 8, cx + 19, top + 6, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 19, top + 6, C.omenSkin, 2);
  } else if (pose === 'clutch') {
    // Arms crossed sharply to the OPPOSITE shoulder (right hand grips left
    // shoulder and vice versa) rather than just pulled toward the centre —
    // a symmetric inward pull at this scale reads as no arms at all once it
    // sits inside the torso silhouette; a cross stays visible against it and
    // is the clearest possible contrast with 'reach's' wide-open sweep.
    c.line(cx + 6 + lean, top + 8, cx - 5, top + 6, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx + 5, top + 6, C.omenSkin, 2);
  } else if (pose === 'flurryReady') {
    c.line(cx + 6 + lean, top + 8, cx + 5, top + 17, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 11, top + 10, C.omenSkin, 2);
  } else if (pose === 'flurryArc') {
    c.line(cx + 6 + lean, top + 8, cx - 10, top + 12, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 9, top + 6, C.omenSkin, 2);
  } else {
    c.line(cx + 6 + lean, top + 8, cx + 9, top + 15, C.omenSkin, 2);
    c.line(cx - 6 + lean, top + 8, cx - 9, top + 15, C.omenSkin, 2);
  }

  // Head + horns.
  const headY = top + 3;
  c.ellipse(cx + lean, headY, 3.5, 3.5, C.omenSkin);
  c.ellipse(cx + lean - 1, headY - 1, 2, 1.5, C.omenSkinLit);
  if (pose === 'limp') {
    c.rect(cx + lean - 2, headY + 1, 4, 1, C.omenSkinDark);
  } else {
    c.rect(cx + lean - 2, headY, 1, 1, C.goldLit); // eyes
    c.rect(cx + lean + 1, headY, 1, 1, C.goldLit);
  }
  drawHorns(c, cx + lean, headY - 2, pose === 'tell' ? 4 : 3);

  // Staff/cane — 2px so it reads as a held weapon, not a stray line, with a
  // darker spine down one side and a glowing head.
  //
  // Poses are (grip → tip). The strike travels *forward*, ending level with
  // the player's torso: the player is 32 base units tall on this same scale,
  // so with the ground at y≈45 their body spans roughly y 13–45 and their
  // chest sits near y 26. A tip that ends much below that is hitting the
  // floor, not the player — which is exactly what the first pass did.
  const staffPose =
    staff === 'raised'
      ? // Windup: hauled up and back over the shoulder, away from the player.
        [cx + 6, top - 6, cx + 1, top + 14]
      : staff === 'swung'
        ? // Active: whipped forward and out, tip at the player's chest.
          [cx + 12, top + 11, cx + 30, top + 17]
        : staff === 'low'
          ? // Recovery: overextended and dropping — the punish window.
            [cx + 10, top + 14, cx + 26, top + 27]
          : staff === 'dropped'
            ? // Staggered/collapsed: hanging from a limp hand, barely held.
              [cx + 9, top + 18, cx + 16, top + 30]
            : staff === 'rest'
              ? [cx + 10, top + 12, cx + 11, top + 33]
              : staff === 'quickRaise'
                ? // cane_swing_2: a short, snappy re-cock — deliberately far
                  // smaller than cane_swing_1's full over-the-shoulder haul,
                  // since it's a fast combo continuation the player has less
                  // time to read, not a fresh opener.
                  [cx + 5, top + 4, cx + 2, top + 13]
                : staff === 'quickSwing'
                  ? [cx + 10, top + 12, cx + 20, top + 14]
                  : staff === 'overheadUp'
                    ? // Both-handed grip, held straight above her — the
                      // silhouette a light or heavy swing never makes.
                      [cx + 2, top - 12, cx, top + 6]
                    : staff === 'overheadDown'
                      ? [cx + 3, top + 6, cx + 20, top + 16]
                      : staff === 'chargeUp'
                        ? // holy_thrust's charge: held level at chest height,
                          // aimed rather than wound up — the glow (below) is
                          // what actually sells the tell.
                          [cx + 9, top + 9, cx + 20, top + 10]
                        : staff === 'thrustOut'
                          ? [cx + 9, top + 10, cx + 34, top + 11]
                          : staff === 'leapThrust'
                            ? // flying_thrust active: the longest visible
                              // extension in the table, matching its 260px
                              // hit range being the largest of any move.
                              [cx + 12, top + 10, cx + 40, top + 12]
                            : staff === 'trailLow'
                              ? // sweep_kick: the cane is incidental — trailing
                                // for balance while the leg does the hitting.
                                [cx - 10, top + 16, cx - 2, top + 30]
                              : staff === 'wideBehind'
                                ? // grab's tell: cane parked at her side, since
                                  // the claws are the threat here — but still
                                  // touching the body silhouette (cape edge is
                                  // ~cx-9), not floating disconnected in the
                                  // empty space her wide-open arms leave.
                                  [cx - 9, top + 18, cx - 13, top + 30]
                                : staff === 'flurryCocked'
                                  ? [cx + 4, top + 18, cx - 6, top + 26]
                                  : staff === 'flurryArc'
                                    ? [cx - 14, top + 10, cx + 22, top + 14]
                                    : null;
  if (staffPose) {
    const [sx, sy, ex, ey] = staffPose;
    c.line(sx, sy, ex, ey, C.gold, 2);
    c.line(sx + 1, sy, ex + 1, ey, C.boneDark, 1);
    c.ellipse(sx, sy - 1, 2, 2, C.goldLit);
    c.ellipse(sx, sy - 1, 1, 1, C.bone);

    // holy_thrust's charge: an arcane glow riding the cane's tip, brighter
    // on the active frame than the tell — the same "charging then releasing"
    // read the player's own cast glow already uses (playerFrame's `glow`).
    if (glow) {
      c.ellipse(ex, ey, 3, 3, rgba('#7a5ad0', 0.5));
      c.ellipse(ex, ey, 1.6, 1.6, rgba('#b9a3ff', 0.85));
    }
  }

  return c;
}

// Frame order is a contract with src/game/render/spriteFrames.ts's MF export
// — index N here must be pose N there. MF.moves keys this by MoveDef.id
// (margitMoves.ts), one tell + one active pair per move (#42 part 2): before
// this, every move shared one generic windup/swing, so a 40-frame grab
// telegraphed identically to a fast cane swing.
const MARGIT_FRAMES = [
  () => margitFrame({ pose: 'idle', bob: 0, staff: 'rest' }), // 0 idle A
  () => margitFrame({ pose: 'idle', bob: 1, staff: 'rest' }), // 1 idle B
  () => margitFrame({ pose: 'idle', bob: 2, lean: 2, staff: 'low' }), // 2 recovery (shared)
  () => margitFrame({ pose: 'limp', bob: 3, lean: -3, staff: 'dropped' }), // 3 staggered
  () => margitFrame({ pose: 'limp', collapsed: true, staff: 'dropped' }), // 4 collapsed
  () => margitFrame({ prone: true }), // 5 death

  // margit.cane_swing_1 — the baseline melee opener: one-handed pull-back,
  // full-arc swing. Everything else is drawn to read as clearly NOT this.
  () => margitFrame({ pose: 'tell', bob: -1, lean: -2, staff: 'raised' }), // 6 tell
  () => margitFrame({ pose: 'lunge', bob: 1, lean: 3, staff: 'swung' }), // 7 active

  // margit.cane_swing_2 — fast combo continuation: a short re-cock and a
  // snappy low swing, not a full haul. Reads as quicker, not just smaller.
  () => margitFrame({ pose: 'tell', bob: -1, lean: -1, staff: 'quickRaise' }), // 8 tell
  () => margitFrame({ pose: 'lunge', bob: 1, lean: 2, staff: 'quickSwing' }), // 9 active

  // margit.delayed_overhead — the two-handed overhead haul. Long tell, and
  // the silhouette (both arms straight up) can't be mistaken for a swing.
  () => margitFrame({ pose: 'overhead', bob: -2, lean: 0, staff: 'overheadUp' }), // 10 tell
  () => margitFrame({ pose: 'overheadSlam', bob: 1, lean: 2, staff: 'overheadDown' }), // 11 active

  // margit.holy_thrust — an aimed lance, not an arc: cane held level and
  // charging (arcane glow), then driven straight forward.
  () => margitFrame({ pose: 'tell', bob: -1, lean: -1, staff: 'chargeUp', glow: true }), // 12 tell
  () => margitFrame({ pose: 'lunge', bob: 0, lean: 3, staff: 'thrustOut', glow: true }), // 13 active

  // margit.flying_thrust — the gap closer: coils low, then leaps forward
  // with the whole body committed, not just the arm.
  () => margitFrame({ pose: 'coil', bob: -2, lean: -1, staff: 'chargeUp' }), // 14 tell
  () => margitFrame({ pose: 'leap', bob: 1, lean: 5, staff: 'leapThrust' }), // 15 active

  // margit.sweep_kick — the cane is incidental; the leg does the hitting.
  () => margitFrame({ pose: 'kickReady', bob: -1, lean: -1, staff: 'trailLow' }), // 16 tell
  () => margitFrame({ pose: 'kickOut', bob: 1, lean: 1, staff: 'trailLow' }), // 17 active

  // margit.reaper_flurry — the finisher: widened stance, flared cape, a wide
  // horizontal arc rather than a straight thrust or overhead chop.
  () =>
    margitFrame({ pose: 'flurryReady', bob: -1, lean: -1, staff: 'flurryCocked', capeFlare: true }), // 18 tell
  () => margitFrame({ pose: 'flurryArc', bob: 1, lean: 2, staff: 'flurryArc', capeFlare: true }), // 19 active

  // margit.grab — the longest tell in the table (F7: anti-turtle reach).
  // Both arms spread open toward the player; the cane goes slack at her
  // side, since the claws are the actual threat.
  () => margitFrame({ pose: 'reach', bob: -1, lean: 0, staff: 'wideBehind' }), // 20 tell
  () => margitFrame({ pose: 'clutch', bob: 1, lean: 1, staff: 'wideBehind' }), // 21 active
];

// ---------------------------------------------------------------------------
// Slash VFX — a crescent arc that expands and fades over four frames.
// ---------------------------------------------------------------------------

function slashFrame(step) {
  const size = 24;
  const c = new Canvas(size, size);
  const cx = 6;
  const cy = size / 2;
  const radius = 9 + step * 2.5;
  const alpha = [0.95, 0.8, 0.5, 0.22][step];
  const spread = [1.1, 1.0, 0.85, 0.7][step];

  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const angle = (-0.9 + 1.8 * t) * spread;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const edge = Math.sin(Math.PI * t); // thickest mid-arc, tapering to points
    c.ellipse(x, y, 0.6 + edge * 1.5, 0.6 + edge * 1.5, rgba('#e8eef7', alpha * edge));
    c.ellipse(x - 1.5, y, 0.4 + edge * 0.8, 0.4 + edge * 0.8, rgba('#aab4c4', alpha * edge * 0.7));
  }
  return c;
}

const SLASH_FRAMES = [0, 1, 2, 3].map((s) => () => slashFrame(s));

// ---------------------------------------------------------------------------
// Margit's strike streak — the trail her cane/holy thrust leaves as it
// crosses the gap to the player.
//
// This exists because her moves hit from 80–260 world px (margitMoves.ts)
// while one drawn cane pose can only reach so far: a 140px holy thrust
// visibly connected from ~32px past the cane tip, and a 260px flying thrust
// from far beyond it. Rather than draw a bespoke pose per move, the scene
// stretches this streak to each move's own rangeBand — so the reach the
// player *sees* is always the reach that actually hits, for every move
// including ones added later.
//
// Drawn at a reference length and scaled horizontally in the scene;
// stretching reads fine because it's a motion trail, not an object.
// ---------------------------------------------------------------------------

const STRIKE_W = 96;
// Kept slim: at 3× this is 36px against a 96px-tall player, which reads as a
// weapon arc. A thicker streak stops looking like a strike and starts
// looking like a wedge of light covering half the character.
const STRIKE_H = 12;

function strikeFrame(step) {
  const c = new Canvas(STRIKE_W, STRIKE_H);
  const cy = STRIKE_H / 2;
  const alpha = [0.75, 0.95, 0.5, 0.2][step];
  const thickness = [0.4, 0.9, 0.6, 0.3][step];

  for (let x = 0; x < STRIKE_W; x++) {
    const t = x / (STRIKE_W - 1);
    // Tapered lens: thin at the hilt end, fullest two-thirds out, drawn to a
    // point at the tip — the shape a fast sweep leaves behind.
    const profile = Math.sin(Math.PI * Math.pow(t, 0.75));
    const half = profile * thickness * (STRIKE_H / 2 - 1);
    if (half <= 0) continue;
    for (let dy = -half; dy <= half; dy += 1) {
      const edge = 1 - Math.abs(dy) / (half || 1);
      c.px(x, cy + dy, rgba('#d4a017', alpha * (0.35 + edge * 0.65)));
    }
    // Bright holy core down the middle.
    const coreHalf = half * 0.35;
    for (let dy = -coreHalf; dy <= coreHalf; dy += 1) {
      c.px(x, cy + dy, rgba('#f7e6b0', alpha * 0.9));
    }
  }
  return c;
}

const STRIKE_FRAMES = [0, 1, 2, 3].map((s) => () => strikeFrame(s));

// ---------------------------------------------------------------------------
// Stormveil arena — four parallax layers.
// ---------------------------------------------------------------------------

const BG_W = 1920;
const BG_H = 1080;

function skyLayer() {
  const c = new Canvas(BG_W, BG_H);
  c.verticalGradient(rgba('#0a0910'), rgba('#2a1d26'));
  const rand = mulberry32(0x5eed);
  for (let i = 0; i < 420; i++) {
    const x = rand() * BG_W;
    const y = rand() * BG_H * 0.62;
    const a = 0.15 + rand() * 0.5;
    c.rect(x, y, 2, 2, rgba('#d9cda6', a));
  }
  // Moon, low and pale, with a soft halo.
  const mx = BG_W * 0.74;
  const my = BG_H * 0.2;
  for (let r = 120; r > 44; r -= 4) {
    c.ellipse(mx, my, r, r, rgba('#8a7f9a', 0.012));
  }
  c.ellipse(mx, my, 44, 44, rgba('#e6dcc2'));
  c.ellipse(mx - 12, my - 8, 9, 9, rgba('#cfc4ab'));
  c.ellipse(mx + 14, my + 12, 6, 6, rgba('#cfc4ab'));
  c.ellipse(mx + 4, my - 20, 5, 5, rgba('#cfc4ab'));
  return c;
}

/** Crenellated tower silhouette. */
function tower(c, x, y, w, h, color) {
  c.rect(x, y, w, h, color);
  for (let i = 0; i < w; i += 14) {
    if ((i / 14) % 2 === 0) c.rect(x + i, y - 10, 9, 10, color);
  }
}

function farLayer() {
  const c = new Canvas(BG_W, BG_H);
  const color = rgba('#14111c');
  const ridge = BG_H * 0.66;
  // Castle mass: a long curtain wall punctuated by taller towers.
  c.rect(0, ridge, BG_W, BG_H - ridge, color);
  for (let i = 0; i < BG_W; i += 260) {
    tower(c, i + 40, ridge - 150, 84, 150, color);
    tower(c, i + 170, ridge - 84, 56, 84, color);
  }
  tower(c, BG_W * 0.5 - 70, ridge - 300, 140, 300, color);
  // Spire on the great tower.
  c.poly(
    [
      [BG_W * 0.5 - 70, ridge - 300],
      [BG_W * 0.5, ridge - 400],
      [BG_W * 0.5 + 70, ridge - 300],
    ],
    color,
  );
  // Faint moonlit rim along the skyline.
  for (let x = 0; x < BG_W; x++) {
    for (let y = 0; y < BG_H; y++) {
      const i = (y * BG_W + x) * 4;
      if (c.data[i + 3] > 0) {
        c.rect(x, y, 1, 2, rgba('#3a3350', 0.55));
        break;
      }
    }
  }
  return c;
}

function midLayer() {
  const c = new Canvas(BG_W, BG_H);
  const stone = rgba('#1b1722');
  const lit = rgba('#2e2740');
  const floor = BG_H * 0.79;
  // Ruined pillars flanking the arena, broken to different heights.
  const pillars = [
    [90, 300],
    [300, 430],
    [1560, 400],
    [1790, 280],
  ];
  for (const [x, h] of pillars) {
    c.rect(x, floor - h, 74, h, stone);
    c.rect(x, floor - h, 6, h, lit);
    c.rect(x - 10, floor - h - 18, 94, 18, stone); // capital
    c.rect(x - 10, floor - h - 18, 94, 3, lit);
    for (let y = floor - h + 30; y < floor; y += 46) c.rect(x, y, 74, 3, rgba('#0f0d14', 0.6));
  }
  // Broken arch spanning the back of the arena.
  c.rect(700, floor - 470, 60, 470, stone);
  c.rect(700, floor - 470, 5, 470, lit);
  c.rect(1150, floor - 440, 60, 440, stone);
  c.rect(1150, floor - 440, 5, 440, lit);
  for (let t = 0; t <= 100; t++) {
    const p = t / 100;
    const x = 700 + p * 510;
    const y = floor - 470 - Math.sin(p * Math.PI) * 90 + Math.sin(p * Math.PI) * 4;
    if (p > 0.42 && p < 0.58) continue; // collapsed keystone
    c.rect(x, y, 14, 42, stone);
  }
  return c;
}

function groundLayer() {
  const c = new Canvas(BG_W, 240);
  const rand = mulberry32(0x1a2b);
  c.verticalGradient(rgba('#2b2620'), rgba('#14110e'));
  // Lit lip where the floor meets the arena air.
  c.rect(0, 0, BG_W, 3, rgba('#5a5043'));
  c.rect(0, 3, BG_W, 2, rgba('#3a332b'));
  // Flagstone seams.
  for (let x = 0; x < BG_W; x += 96) {
    c.rect(x, 5, 2, 60, rgba('#0f0d0b', 0.8));
  }
  for (let y = 5; y < 90; y += 42) {
    c.rect(0, y, BG_W, 2, rgba('#0f0d0b', 0.55));
  }
  // Speckle + cracks so the stone isn't flat.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * BG_W;
    const y = rand() * 200;
    c.rect(x, y, 2, 2, rgba(rand() > 0.5 ? '#3a332b' : '#100e0c', 0.5));
  }
  for (let i = 0; i < 24; i++) {
    let x = rand() * BG_W;
    let y = 6 + rand() * 40;
    for (let s = 0; s < 30; s++) {
      c.rect(x, y, 2, 2, rgba('#0d0b09', 0.7));
      x += (rand() - 0.5) * 12;
      y += rand() * 4;
    }
  }
  return c;
}

// ---------------------------------------------------------------------------

function write(name, canvas) {
  const png = canvas.toPng();
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name}  ${canvas.width}×${canvas.height}  ${(png.length / 1024).toFixed(1)} KiB`);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('generating sprites →', OUT_DIR);

write(
  'player.png',
  sheet(
    PLAYER_FRAMES.map((f) => f().scaled(PLAYER_SCALE)),
    10,
  ),
);
write(
  'margit.png',
  sheet(
    MARGIT_FRAMES.map((f) => f().scaled(MARGIT_SCALE)),
    8,
  ),
);
write(
  'slash.png',
  sheet(
    SLASH_FRAMES.map((f) => f().scaled(3)),
    4,
  ),
);
write(
  'strike.png',
  sheet(
    STRIKE_FRAMES.map((f) => f().scaled(3)),
    4,
  ),
);
write('bg-sky.png', skyLayer());
write('bg-far.png', farLayer());
write('bg-mid.png', midLayer());
write('bg-ground.png', groundLayer());

console.log('done.');
