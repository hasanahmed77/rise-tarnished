// Minimal audio synthesis toolkit: signal generators, envelopes, filters, and
// a dependency-free WAV encoder.
//
// Same reasoning as scripts/lib/pixel.mjs — no native audio deps for a job
// that is a few hundred lines of Float32Array manipulation, and everything is
// deterministic so regenerated assets don't churn the diff.
//
// Signals are plain Float32Array in [-1, 1] at a given sample rate. Every
// helper takes and returns one, so effects compose by nesting.

/** Deterministic PRNG — noise must be identical between runs. */
export function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

export function samples(seconds, sampleRate) {
  return Math.max(1, Math.round(seconds * sampleRate));
}

/**
 * Snap a frequency so exactly a whole number of cycles fits in `loopSeconds`.
 *
 * This is what makes the ambience loop seamlessly without a crossfade: if
 * every oscillator and LFO completes an integer number of cycles over the
 * loop, the waveform at the end is continuous with the start by construction,
 * so there is no click and no fade-induced dip in the drone.
 */
export function snapToLoop(freq, loopSeconds) {
  return Math.max(1, Math.round(freq * loopSeconds)) / loopSeconds;
}

export function sine(freq, seconds, sampleRate, { phase = 0, detune = 0 } = {}) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n);
  const f = freq + detune;
  for (let i = 0; i < n; i++) out[i] = Math.sin(TAU * f * (i / sampleRate) + phase);
  return out;
}

/** Band-limited-ish saw via summed harmonics — richer than a sine for drones
 * without the aliasing buzz of a naive ramp. */
export function saw(freq, seconds, sampleRate, { harmonics = 8, phase = 0 } = {}) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n);
  const nyquist = sampleRate / 2;
  for (let h = 1; h <= harmonics; h++) {
    const f = freq * h;
    if (f >= nyquist) break;
    const amp = 1 / h;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(TAU * f * (i / sampleRate) + phase);
  }
  return out;
}

export function noise(seconds, sampleRate, rng) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Sine whose frequency glides f0 → f1. `curve` > 1 front-loads the sweep,
 * which is what makes a downward sweep read as an impact rather than a siren. */
export function sweep(f0, f1, seconds, sampleRate, { curve = 1 } = {}) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = Math.pow(i / n, curve);
    const f = f0 + (f1 - f0) * t;
    phase += (TAU * f) / sampleRate;
    out[i] = Math.sin(phase);
  }
  return out;
}

/** Percussive envelope: instant-ish attack, exponential decay. */
export function decayEnv(seconds, sampleRate, { attack = 0.002, power = 4 } = {}) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n);
  const a = Math.max(1, samples(attack, sampleRate));
  for (let i = 0; i < n; i++) {
    const rise = i < a ? i / a : 1;
    const fall = Math.pow(1 - i / n, power);
    out[i] = rise * fall;
  }
  return out;
}

/** Smooth swell — used for the drone's slow breathing, never for hits. */
export function fadeEnv(seconds, sampleRate, { fadeIn = 0.01, fadeOut = 0.01 } = {}) {
  const n = samples(seconds, sampleRate);
  const out = new Float32Array(n).fill(1);
  const inN = samples(fadeIn, sampleRate);
  const outN = samples(fadeOut, sampleRate);
  for (let i = 0; i < Math.min(inN, n); i++) out[i] *= i / inN;
  for (let i = 0; i < Math.min(outN, n); i++) out[n - 1 - i] *= i / outN;
  return out;
}

export function applyEnv(signal, env) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * (env[i] ?? 0);
  return out;
}

export function gain(signal, g) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * g;
  return out;
}

/** Amplitude modulation by a slow sine — the drone's sense of movement. */
export function tremolo(signal, rateHz, depth, sampleRate, { phase = 0 } = {}) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const lfo = 1 - depth + depth * (0.5 + 0.5 * Math.sin(TAU * rateHz * (i / sampleRate) + phase));
    out[i] = signal[i] * lfo;
  }
  return out;
}

export function mix(...signals) {
  const n = Math.max(...signals.map((s) => s.length));
  const out = new Float32Array(n);
  for (const s of signals) for (let i = 0; i < s.length; i++) out[i] += s[i];
  return out;
}

/** One-pole lowpass. Cheap, and exactly the "muffled / distant / underground"
 * character this game's palette wants. */
export function lowpass(signal, cutoffHz, sampleRate) {
  const out = new Float32Array(signal.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (TAU * cutoffHz);
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < signal.length; i++) {
    prev += alpha * (signal[i] - prev);
    out[i] = prev;
  }
  return out;
}

export function highpass(signal, cutoffHz, sampleRate) {
  const out = new Float32Array(signal.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (TAU * cutoffHz);
  const alpha = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < signal.length; i++) {
    prevOut = alpha * (prevOut + signal[i] - prevIn);
    prevIn = signal[i];
    out[i] = prevOut;
  }
  return out;
}

/** Feedback-delay reverb. Not a real convolution reverb, but enough to place
 * a sound in a big stone room, which is the whole point here. */
export function reverb(signal, sampleRate, { time = 0.09, feedback = 0.4, wet = 0.35 } = {}) {
  const delay = samples(time, sampleRate);
  const tail = Math.round(delay * 6);
  const out = new Float32Array(signal.length + tail);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i];
  for (let i = delay; i < out.length; i++) {
    out[i] += out[i - delay] * feedback * wet;
  }
  return out;
}

/** Scale so the loudest sample sits at `peak`. Guards against the clipping
 * that summing many layers otherwise causes. */
export function normalize(signal, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < signal.length; i++) max = Math.max(max, Math.abs(signal[i]));
  if (max === 0) return signal;
  return gain(signal, peak / max);
}

/** Hard-limit into [-1, 1] as a final safety net after normalize. */
export function clampSignal(signal) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = Math.max(-1, Math.min(1, signal[i]));
  return out;
}

export function silence(seconds, sampleRate) {
  return new Float32Array(samples(seconds, sampleRate));
}

/** Place `signal` into a buffer of `seconds` starting at `atSeconds`. */
export function at(signal, atSeconds, seconds, sampleRate) {
  const out = new Float32Array(samples(seconds, sampleRate));
  const start = samples(atSeconds, sampleRate);
  for (let i = 0; i < signal.length && start + i < out.length; i++) out[start + i] = signal[i];
  return out;
}

/** 16-bit PCM mono WAV. */
export function toWav(signal, sampleRate) {
  const n = signal.length;
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // audioFormat: PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, signal[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
