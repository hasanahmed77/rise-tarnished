// Minimal pixel-art toolkit: an RGBA canvas with drawing primitives and a
// dependency-free PNG encoder (Node's zlib does the compression).
//
// Deliberately no `sharp`/`canvas`: those are native deps that would need
// rebuilding per platform and in CI, for a job that is a few hundred lines
// of buffer manipulation. Everything here is deterministic — the same script
// always produces byte-identical PNGs, so regenerated assets don't churn the
// diff (see scripts/generate-sprites.mjs).

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** '#rrggbb' or '#rrggbbaa' → [r, g, b, a]. */
export function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, alpha === undefined ? a : Math.round(alpha * 255)];
}

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Source-over alpha blend of one pixel. Out-of-bounds writes are dropped
   * so shape helpers never need their own bounds checks. */
  px(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b, a] = color;
    if (a === 0) return;
    const i = (y * this.width + x) * 4;
    if (a === 255) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
      return;
    }
    const sa = a / 255;
    const da = this.data[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA === 0) return;
    this.data[i] = (r * sa + this.data[i] * da * (1 - sa)) / outA;
    this.data[i + 1] = (g * sa + this.data[i + 1] * da * (1 - sa)) / outA;
    this.data[i + 2] = (b * sa + this.data[i + 2] * da * (1 - sa)) / outA;
    this.data[i + 3] = outA * 255;
  }

  rect(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.px(x + dx, y + dy, color);
    return this;
  }

  /** Filled ellipse centred on (cx, cy). */
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.px(x, y, color);
      }
    }
    return this;
  }

  /** Bresenham line, optionally thickened into a square brush. */
  line(x0, y0, x1, y1, color, thickness = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const half = Math.floor(thickness / 2);
    for (;;) {
      if (thickness === 1) this.px(x0, y0, color);
      else this.rect(x0 - half, y0 - half, thickness, thickness, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Convex/concave polygon fill by scanline. */
  poly(points, color) {
    const ys = points.map((p) => p[1]);
    const yMin = Math.floor(Math.min(...ys));
    const yMax = Math.ceil(Math.max(...ys));
    for (let y = yMin; y <= yMax; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if (y1 === y2) continue;
        if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) this.px(x, y, color);
      }
    }
    return this;
  }

  /** Vertical two-stop gradient across the whole canvas. */
  verticalGradient(topColor, bottomColor) {
    for (let y = 0; y < this.height; y++) {
      const t = this.height === 1 ? 0 : y / (this.height - 1);
      const c = [
        topColor[0] + (bottomColor[0] - topColor[0]) * t,
        topColor[1] + (bottomColor[1] - topColor[1]) * t,
        topColor[2] + (bottomColor[2] - topColor[2]) * t,
        topColor[3] + (bottomColor[3] - topColor[3]) * t,
      ];
      this.rect(0, y, this.width, 1, c);
    }
    return this;
  }

  /** Blit another canvas at (x, y), alpha-blended. */
  blit(src, x, y) {
    for (let sy = 0; sy < src.height; sy++) {
      for (let sx = 0; sx < src.width; sx++) {
        const i = (sy * src.width + sx) * 4;
        this.px(x + sx, y + sy, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
    }
    return this;
  }

  /** Nearest-neighbour upscale — keeps pixel art crisp (no interpolation). */
  scaled(factor) {
    const out = new Canvas(this.width * factor, this.height * factor);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        const color = [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
        if (color[3] === 0) continue;
        out.rect(x * factor, y * factor, factor, factor, color);
      }
    }
    return out;
  }

  /** Mirror horizontally (unused by the generator today, but the cheapest
   * way to add left-facing variants if pre-baked ones are ever wanted —
   * the scene currently flips at runtime via setFlipX). */
  flippedX() {
    const out = new Canvas(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        const j = (y * this.width + (this.width - 1 - x)) * 4;
        out.data[j] = this.data[i];
        out.data[j + 1] = this.data[i + 1];
        out.data[j + 2] = this.data[i + 2];
        out.data[j + 3] = this.data[i + 3];
      }
    }
    return out;
  }

  toPng() {
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (stride + 1)] = 0; // filter type: none
      Buffer.from(this.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(raw, { level: 9 })),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** Lay frames out left-to-right in rows of `columns` — the grid layout
 * Phaser's `load.spritesheet({ frameWidth, frameHeight })` indexes. */
export function sheet(frames, columns) {
  const fw = frames[0].width;
  const fh = frames[0].height;
  const rows = Math.ceil(frames.length / columns);
  const out = new Canvas(fw * columns, fh * rows);
  frames.forEach((frame, i) => {
    out.blit(frame, (i % columns) * fw, Math.floor(i / columns) * fh);
  });
  return out;
}

/** Deterministic PRNG — star fields and stone speckle must not churn the
 * committed PNGs between runs. */
export function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
