// Generates every sound in public/audio/ (#51). Run with `npm run audio`.
//
// Why generated rather than sourced: the same reasoning as the sprites, plus a
// sharper one for audio. The brief was "Dark Souls-like", and the only safe
// way to honour that is as a *mood* target — low, sparse, muffled, patient —
// not by shipping anyone else's recordings. Everything here is synthesised
// from oscillators and noise, so it's original and carries no licence or
// attribution surface in a public repo.
//
// Deterministic: seeded noise and integer-cycle frequencies mean reruns
// produce byte-identical WAVs, so regenerating never churns the diff.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyEnv,
  clampSignal,
  decayEnv,
  fadeEnv,
  gain,
  highpass,
  lowpass,
  mix,
  mulberry32,
  noise,
  normalize,
  reverb,
  samples,
  saw,
  sine,
  snapToLoop,
  sweep,
  toWav,
  tremolo,
} from './lib/audio.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

/** SFX need the high transients of a clang, so they get the higher rate.
 * The ambience is almost entirely sub-500Hz, so half the rate is inaudible
 * there and halves the file size. */
const SFX_RATE = 22050;
const MUSIC_RATE = 11025;

/** Exactly one loop of ambience. Every oscillator is snapped to complete a
 * whole number of cycles in this window (see snapToLoop) — that's what makes
 * it loop without a click and without a crossfade dip. */
const LOOP_SECONDS = 32;

// ---------------------------------------------------------------------------
// Combat SFX. Every one is short, dry-ish, and deliberately dull in the treble
// — the palette is stone and iron in a cold room, not a bright action game.
// ---------------------------------------------------------------------------

/** Air being displaced: filtered noise with a fast decay. The band placement
 * is what separates a light flick from a heavy overhead. */
function whoosh({ seconds, lowHz, highHz, seed, power = 5 }) {
  const rng = mulberry32(seed);
  let body = noise(seconds, SFX_RATE, rng);
  body = highpass(body, lowHz, SFX_RATE);
  body = lowpass(body, highHz, SFX_RATE);
  return applyEnv(body, decayEnv(seconds, SFX_RATE, { attack: seconds * 0.25, power }));
}

/** Inharmonic partials = metal. Harmonic ones would read as a musical note,
 * which is exactly what a sword strike should not sound like. */
function metallic({ seconds, partials, seed, power = 5, amp = 1 }) {
  const rng = mulberry32(seed);
  const layers = partials.map((f, i) =>
    gain(
      applyEnv(sine(f, seconds, SFX_RATE), decayEnv(seconds, SFX_RATE, { power: power + i })),
      amp / (i + 1),
    ),
  );
  const transient = gain(
    applyEnv(
      highpass(noise(0.02, SFX_RATE, rng), 2000, SFX_RATE),
      decayEnv(0.02, SFX_RATE, { power: 3 }),
    ),
    0.5,
  );
  return mix(...layers, transient);
}

/** The low end of an impact — the part you feel rather than hear. */
function thud({ seconds, f0, f1, seed, power = 6 }) {
  const rng = mulberry32(seed);
  const body = applyEnv(
    sweep(f0, f1, seconds, SFX_RATE, { curve: 0.4 }),
    decayEnv(seconds, SFX_RATE, { power }),
  );
  const grit = gain(
    applyEnv(
      lowpass(noise(seconds * 0.5, SFX_RATE, rng), 700, SFX_RATE),
      decayEnv(seconds * 0.5, SFX_RATE, { power: 4 }),
    ),
    0.35,
  );
  return mix(body, grit);
}

const SFX = {
  // Player attacks — light is a flick of air, heavy is a slower, lower arc.
  'swing-light': () =>
    normalize(whoosh({ seconds: 0.18, lowHz: 700, highHz: 5200, seed: 11 }), 0.5),

  'swing-heavy': () =>
    normalize(
      mix(
        whoosh({ seconds: 0.34, lowHz: 260, highHz: 3000, seed: 12, power: 4 }),
        gain(applyEnv(sweep(200, 70, 0.34, SFX_RATE), decayEnv(0.34, SFX_RATE, { power: 5 })), 0.4),
      ),
      0.62,
    ),

  // Margit's swing: bigger, slower, more air moved.
  'swing-boss': () =>
    normalize(
      mix(
        whoosh({ seconds: 0.5, lowHz: 150, highHz: 2200, seed: 13, power: 3 }),
        gain(applyEnv(sweep(150, 48, 0.5, SFX_RATE), decayEnv(0.5, SFX_RATE, { power: 4 })), 0.45),
      ),
      0.66,
    ),

  // A hit landing: low thud for the weight, metal for the edge, a room to sit in.
  hit: () =>
    normalize(
      reverb(
        mix(
          thud({ seconds: 0.3, f0: 190, f1: 62, seed: 21 }),
          gain(metallic({ seconds: 0.28, partials: [1740, 2610, 3820], seed: 22 }), 0.42),
        ),
        SFX_RATE,
        { time: 0.07, feedback: 0.34, wet: 0.28 },
      ),
      0.8,
    ),

  // Critical / posture-break payoff: the same shape, but deeper and allowed
  // to ring — this is the fight's biggest reward, so it gets the most room.
  'hit-critical': () =>
    normalize(
      reverb(
        mix(
          thud({ seconds: 0.8, f0: 150, f1: 38, seed: 31, power: 4 }),
          gain(metallic({ seconds: 0.75, partials: [1180, 1970, 3140, 4520], seed: 32 }), 0.5),
        ),
        SFX_RATE,
        { time: 0.11, feedback: 0.52, wet: 0.42 },
      ),
      0.95,
    ),

  // Blocked on the guard: bright, hard, no low end — nothing got through.
  block: () =>
    normalize(
      reverb(
        mix(
          metallic({ seconds: 0.45, partials: [2150, 3260, 4870, 6300], seed: 41, power: 4 }),
          gain(thud({ seconds: 0.12, f0: 240, f1: 120, seed: 42 }), 0.3),
        ),
        SFX_RATE,
        { time: 0.06, feedback: 0.4, wet: 0.3 },
      ),
      0.72,
    ),

  // Dodge: cloth and effort, heavily muffled. Should never compete with a hit.
  dodge: () =>
    normalize(whoosh({ seconds: 0.26, lowHz: 120, highHz: 1100, seed: 51, power: 3 }), 0.4),

  // Sorcery: the one sound allowed to be tonal and rising, so it reads as
  // deliberate magic against a palette that is otherwise all impacts.
  cast: () => {
    const rng = mulberry32(61);
    const core = applyEnv(
      sweep(220, 880, 0.55, SFX_RATE, { curve: 1.6 }),
      fadeEnv(0.55, SFX_RATE, { fadeIn: 0.06, fadeOut: 0.3 }),
    );
    const shimmer = gain(
      applyEnv(
        sweep(1320, 2640, 0.55, SFX_RATE, { curve: 1.6 }),
        decayEnv(0.55, SFX_RATE, { power: 2 }),
      ),
      0.22,
    );
    const air = gain(
      applyEnv(
        lowpass(highpass(noise(0.55, SFX_RATE, rng), 1200, SFX_RATE), 4200, SFX_RATE),
        decayEnv(0.55, SFX_RATE, { attack: 0.2, power: 2 }),
      ),
      0.18,
    );
    return normalize(
      reverb(mix(core, shimmer, air), SFX_RATE, { time: 0.1, feedback: 0.45, wet: 0.4 }),
      0.6,
    );
  },

  // Taking a clean hit: dull, close, no metal ring — it landed on you.
  hurt: () =>
    normalize(
      mix(
        thud({ seconds: 0.4, f0: 140, f1: 45, seed: 71, power: 5 }),
        gain(
          applyEnv(
            lowpass(noise(0.22, SFX_RATE, mulberry32(72)), 900, SFX_RATE),
            decayEnv(0.22, SFX_RATE, { power: 4 }),
          ),
          0.4,
        ),
      ),
      0.78,
    ),

  // Death: the only long sound in the set. Slow descent, heavy room, no
  // transient — nothing hits, something ends.
  death: () =>
    normalize(
      reverb(
        mix(
          applyEnv(
            sweep(120, 34, 2.6, SFX_RATE, { curve: 0.7 }),
            fadeEnv(2.6, SFX_RATE, { fadeIn: 0.05, fadeOut: 1.6 }),
          ),
          gain(
            applyEnv(
              sweep(180, 51, 2.6, SFX_RATE, { curve: 0.7 }),
              fadeEnv(2.6, SFX_RATE, { fadeIn: 0.2, fadeOut: 1.8 }),
            ),
            0.4,
          ),
          gain(
            applyEnv(
              lowpass(noise(2.6, SFX_RATE, mulberry32(81)), 320, SFX_RATE),
              fadeEnv(2.6, SFX_RATE, { fadeIn: 0.3, fadeOut: 1.9 }),
            ),
            0.22,
          ),
        ),
        SFX_RATE,
        { time: 0.16, feedback: 0.6, wet: 0.5 },
      ),
      0.85,
    ),
};

// ---------------------------------------------------------------------------
// Ambience — the "subtle dark music". Closer to a room tone than a track:
// a low drone in A, a fifth above it, a distant toll, and air. It should be
// almost unnoticeable until it stops.
// ---------------------------------------------------------------------------

/** Repeat `signal` until it fills `seconds`. Used to make the noise bed
 * periodic — random noise is otherwise the one layer that can't line up at
 * the loop point. */
function tileTo(signal, seconds, sampleRate) {
  const out = new Float32Array(samples(seconds, sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = signal[i % signal.length];
  return out;
}

function ambience() {
  const sr = MUSIC_RATE;
  const dur = LOOP_SECONDS;
  const n = samples(dur, sr);
  // Render TWO loops and keep the second one.
  //
  // Snapping frequencies to integer cycles makes the *sources* periodic, but
  // that alone does not make the rendered audio loop: the filters start with
  // zeroed state, so the opening seconds carry a warm-up transient that does
  // not match the settled tail — and that mismatch is precisely a click at
  // the loop point (measured at 6x a normal sample step before this fix).
  // By the second pass every filter has reached steady state, and since every
  // source repeats with period `dur`, that second pass IS the true cyclic
  // steady state and joins to itself exactly.
  const dur2 = dur * 2;
  const rng = mulberry32(1337);

  // A1 root with a fifth and octave. Snapped so each completes whole cycles
  // across the loop — the seamlessness is arithmetic, not a crossfade.
  const root = snapToLoop(55, dur); // A1
  const fifth = snapToLoop(82.41, dur); // E2
  const octave = snapToLoop(110, dur); // A2
  // A minor second above the root, very quiet: the faint sourness that keeps
  // the drone from sounding restful.
  const tension = snapToLoop(58.27, dur); // Bb1

  // LFO rates are also snapped, so the swells line up at the loop point too.
  const slowLfo = snapToLoop(1 / 16, dur);
  const slowerLfo = snapToLoop(1 / 32, dur);

  const drone = mix(
    gain(
      tremolo(lowpass(saw(root, dur2, sr, { harmonics: 6 }), 220, sr), slowerLfo, 0.35, sr),
      0.5,
    ),
    gain(
      tremolo(lowpass(saw(fifth, dur2, sr, { harmonics: 4 }), 190, sr), slowLfo, 0.4, sr, {
        phase: 1.7,
      }),
      0.3,
    ),
    gain(tremolo(lowpass(sine(octave, dur2, sr), 300, sr), slowLfo, 0.5, sr, { phase: 3.1 }), 0.12),
    gain(
      tremolo(lowpass(sine(tension, dur2, sr), 200, sr), slowerLfo, 0.6, sr, { phase: 2.2 }),
      0.07,
    ),
  );

  // Air: a wide, very quiet noise bed. Gives the drone a space to sit in
  // without adding anything the ear can name. Tiled from one loop's worth of
  // noise so it repeats with the same period as everything else.
  const air = gain(lowpass(highpass(tileTo(noise(dur, sr, rng), dur2, sr), 60, sr), 380, sr), 0.05);

  // A distant toll every 8s, across both passes. Its 6s decay finishes inside
  // the interval, and rendering it in the first pass too means the second
  // pass inherits any tail that crosses the loop boundary.
  const tollBuf = new Float32Array(samples(dur2, sr));
  for (let k = 0; k < dur2 / 8; k++) {
    const tollSeconds = 6;
    const f = snapToLoop(41.2, dur); // E1 — below the drone, felt more than heard
    const strike = mix(
      applyEnv(sine(f, tollSeconds, sr), decayEnv(tollSeconds, sr, { attack: 0.05, power: 3 })),
      gain(
        applyEnv(
          sine(f * 2.76, tollSeconds, sr),
          decayEnv(tollSeconds, sr, { attack: 0.05, power: 5 }),
        ),
        0.3,
      ),
    );
    const start = samples(k * 8, sr);
    for (let i = 0; i < strike.length && start + i < tollBuf.length; i++) {
      tollBuf[start + i] += strike[i] * 0.16;
    }
  }

  const full = mix(drone, air, lowpass(tollBuf, 900, sr));
  // Keep the second pass only — see the steady-state note above.
  const settled = new Float32Array(full.subarray(n, n * 2));
  // Peak stays low: the brief was "subtle", and the scene attenuates further.
  return clampSignal(normalize(settled, 0.34));
}

// ---------------------------------------------------------------------------

function write(name, signal, sampleRate) {
  const wav = toWav(clampSignal(signal), sampleRate);
  writeFileSync(join(OUT_DIR, name), wav);
  const seconds = (signal.length / sampleRate).toFixed(2);
  console.log(`  ${name}  ${seconds}s  ${(wav.length / 1024).toFixed(1)} KiB`);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('generating audio →', OUT_DIR);

for (const [name, build] of Object.entries(SFX)) {
  write(`${name}.wav`, build(), SFX_RATE);
}
write('ambience-stormveil.wav', ambience(), MUSIC_RATE);

console.log('done.');
