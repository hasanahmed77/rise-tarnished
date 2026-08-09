// Proves the audio contract: every key the scene can play has a real, valid,
// non-silent WAV behind it. A missing or broken file otherwise shows up only
// as one event going quiet mid-fight — the kind of gap that survives review
// precisely because nothing errors.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AMBIENCE_KEY,
  AMBIENCE_VOLUME,
  SFX_KEYS,
  SFX_VOLUME,
  audioPath,
  type SfxKey,
} from './soundManifest';

const PUBLIC_DIR = join(process.cwd(), 'public');

interface Wav {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  samples: Float32Array;
}

/** Parse a 16-bit PCM mono WAV — enough to prove the file is real audio and
 * not, say, a zero-length placeholder. */
function readWav(key: string): Wav {
  const buf = readFileSync(join(PUBLIC_DIR, audioPath(key)));
  expect(buf.toString('ascii', 0, 4), `${key}: missing RIFF header`).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12), `${key}: not a WAVE file`).toBe('WAVE');

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size;
  }
  expect(dataOffset, `${key}: no data chunk`).toBeGreaterThan(0);

  const count = dataLength / 2;
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  return { channels, sampleRate, bitsPerSample, samples };
}

function peak(s: Float32Array): number {
  let max = 0;
  for (const v of s) max = Math.max(max, Math.abs(v));
  return max;
}

describe('sfx', () => {
  it.each(SFX_KEYS)('%s is a valid, audible mono WAV', (key) => {
    const wav = readWav(key);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.samples.length).toBeGreaterThan(0);
    // Not silent, and not slammed against the ceiling — a file at exactly 1.0
    // peak is usually one that clipped during synthesis.
    expect(peak(wav.samples)).toBeGreaterThan(0.05);
    expect(peak(wav.samples)).toBeLessThan(1);
  });

  it.each(SFX_KEYS)('%s has a mix volume', (key) => {
    expect(SFX_VOLUME[key as SfxKey]).toBeGreaterThan(0);
    expect(SFX_VOLUME[key as SfxKey]).toBeLessThanOrEqual(1);
  });

  it('keeps impacts louder than the swings that precede them', () => {
    // The feedback that matters most is whether a hit *landed*. If a swing
    // were as loud as its impact, whiffing and connecting would sound alike.
    expect(SFX_VOLUME.hit).toBeGreaterThan(SFX_VOLUME['swing-light']);
    expect(SFX_VOLUME.hit).toBeGreaterThan(SFX_VOLUME['swing-heavy']);
    expect(SFX_VOLUME['hit-critical']).toBeGreaterThan(SFX_VOLUME.hit);
  });
});

describe('ambience', () => {
  it('is a valid mono WAV', () => {
    const wav = readWav(AMBIENCE_KEY);
    expect(wav.channels).toBe(1);
    expect(wav.bitsPerSample).toBe(16);
  });

  it('stays subtle — quieter than every combat sound', () => {
    // The brief was explicitly "subtle". If ambience ever creeps above the
    // quietest SFX it stops being atmosphere and starts masking feedback.
    const quietestSfx = Math.min(...SFX_KEYS.map((k) => SFX_VOLUME[k]));
    expect(AMBIENCE_VOLUME).toBeLessThan(quietestSfx);
  });

  it('loops without a click', () => {
    // The bug this caught for real: filters start with zeroed state, so the
    // first pass carries a warm-up transient that does not match the settled
    // tail. That mismatch measured 6x a normal sample step — an audible click
    // every 32 seconds. The generator now renders two passes and keeps the
    // settled one; this asserts the join stays within normal waveform motion.
    const { samples } = readWav(AMBIENCE_KEY);
    let maxStep = 0;
    for (let i = 1; i < samples.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
    }
    const seam = Math.abs(samples[0] - samples[samples.length - 1]);
    expect(seam).toBeLessThanOrEqual(maxStep);
  });
});
