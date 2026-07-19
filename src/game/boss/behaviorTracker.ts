// The Behavior Tracker (BOSS_AI.md §5): a rolling 20-second window of player
// telemetry reduced to seven normalized signals ∈ [0, 1]. This is the
// adaptation *input* — deterministic, tick-resolution, engine-free. The boss
// never sees raw inputs, only these signals.
//
// Implementation: a ring of 20 one-second buckets. Each tick/event increments
// counters in the current bucket; once per second the ring advances and the
// oldest bucket falls out. Exact windowing, O(1) per tick, no allocation
// outside the fixed ring.

import { TICKS_PER_SECOND } from '../combat/frameData';

/** Window length in seconds (spec default). */
export const TRACKER_WINDOW_SECONDS = 20;
/** A roll started within this many ticks of a boss startup counts as a panic roll. */
export const PANIC_ROLL_WINDOW_TICKS = 10;
/** Distance beyond which the player counts as camping (outside melee band). */
export const CAMPING_DISTANCE = 140;
/** Attacks/second that saturate the aggression signal. */
export const AGGRESSION_SATURATION_APS = 1.5;
/** Blocking or camping fraction of the window that saturates turtleIndex. */
export const TURTLE_SATURATION_FRACTION = 0.5;

interface Bucket {
  ticks: number; // sim ticks recorded into this bucket
  dodges: number;
  panicDodges: number;
  successfulIframeDodges: number;
  attacks: number;
  punishHits: number; // player hits landed on boss recovery
  hitsLanded: number; // all player hits that connected
  blockTicks: number;
  campingTicks: number;
  healsInPunishRange: number;
  heals: number;
}

function emptyBucket(): Bucket {
  return {
    ticks: 0,
    dodges: 0,
    panicDodges: 0,
    successfulIframeDodges: 0,
    attacks: 0,
    punishHits: 0,
    hitsLanded: 0,
    blockTicks: 0,
    campingTicks: 0,
    healsInPunishRange: 0,
    heals: 0,
  };
}

export interface BehaviorSignals {
  dodgeReflex: number;
  dodgeTiming: number;
  turtleIndex: number;
  healGreed: number;
  rangeCamping: number;
  punishPattern: number;
  aggression: number;
}

export const NEUTRAL_SIGNALS: BehaviorSignals = {
  dodgeReflex: 0,
  dodgeTiming: 0,
  turtleIndex: 0,
  healGreed: 0,
  rangeCamping: 0,
  punishPattern: 0,
  aggression: 0,
};

export interface TrackerState {
  buckets: Bucket[];
  cursor: number;
  tickInBucket: number;
  /** Ticks since the last boss move:start — feeds panic-roll detection. */
  ticksSinceBossStartup: number;
}

export function createTracker(): TrackerState {
  return {
    buckets: Array.from({ length: TRACKER_WINDOW_SECONDS }, emptyBucket),
    cursor: 0,
    tickInBucket: 0,
    ticksSinceBossStartup: Number.MAX_SAFE_INTEGER,
  };
}

/** Per-tick observations the scene feeds in. All optional except the flags. */
export interface TrackerTickInput {
  playerBlocking: boolean;
  distance: number;
  /** The player pressed dodge this tick. */
  dodgeStarted: boolean;
  /** The player pressed an attack this tick. */
  attackStarted: boolean;
  /** The boss entered a move's startup this tick. */
  bossStartupBegan: boolean;
}

/** Discrete outcomes the scene reports as they happen. */
export type TrackerEvent =
  | { type: 'dodge:iframe-success' } // an incoming hit was i-framed
  | { type: 'hit:landed'; onBossRecovery: boolean } // player hit connected
  | { type: 'heal'; inPunishRange: boolean }; // flask use (not implemented yet — always absent in sandbox)

export function trackTick(prev: TrackerState, input: TrackerTickInput): TrackerState {
  const state: TrackerState = {
    ...prev,
    buckets: prev.buckets.map((b, i) => (i === prev.cursor ? { ...b } : b)),
  };
  const bucket = state.buckets[state.cursor];

  state.ticksSinceBossStartup = input.bossStartupBegan
    ? 0
    : Math.min(Number.MAX_SAFE_INTEGER, state.ticksSinceBossStartup + 1);

  bucket.ticks += 1;
  if (input.playerBlocking) bucket.blockTicks += 1;
  if (input.distance > CAMPING_DISTANCE) bucket.campingTicks += 1;
  if (input.dodgeStarted) {
    bucket.dodges += 1;
    if (state.ticksSinceBossStartup <= PANIC_ROLL_WINDOW_TICKS) bucket.panicDodges += 1;
  }
  if (input.attackStarted) bucket.attacks += 1;

  // Advance the ring once per second; the overwritten bucket ages out.
  state.tickInBucket += 1;
  if (state.tickInBucket >= TICKS_PER_SECOND) {
    state.tickInBucket = 0;
    state.cursor = (state.cursor + 1) % state.buckets.length;
    state.buckets[state.cursor] = emptyBucket();
  }
  return state;
}

export function trackEvent(prev: TrackerState, event: TrackerEvent): TrackerState {
  const state: TrackerState = {
    ...prev,
    buckets: prev.buckets.map((b, i) => (i === prev.cursor ? { ...b } : b)),
  };
  const bucket = state.buckets[state.cursor];
  if (event.type === 'dodge:iframe-success') bucket.successfulIframeDodges += 1;
  if (event.type === 'hit:landed') {
    bucket.hitsLanded += 1;
    if (event.onBossRecovery) bucket.punishHits += 1;
  }
  if (event.type === 'heal') {
    bucket.heals += 1;
    if (event.inPunishRange) bucket.healsInPunishRange += 1;
  }
  return state;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Reduce the window to the seven normalized signals. Pure; call at decision points. */
export function computeSignals(state: TrackerState): BehaviorSignals {
  const sum = state.buckets.reduce((acc, b) => {
    for (const k of Object.keys(acc) as (keyof Bucket)[]) acc[k] += b[k];
    return acc;
  }, emptyBucket());

  const windowTicks = Math.max(1, sum.ticks);
  const windowSeconds = windowTicks / TICKS_PER_SECOND;

  return {
    dodgeReflex: sum.dodges === 0 ? 0 : clamp01(sum.panicDodges / sum.dodges),
    dodgeTiming: sum.dodges === 0 ? 0 : clamp01(sum.successfulIframeDodges / sum.dodges),
    turtleIndex: clamp01(
      (sum.blockTicks + sum.campingTicks * 0.5) / windowTicks / TURTLE_SATURATION_FRACTION,
    ),
    healGreed: sum.heals === 0 ? 0 : clamp01(sum.healsInPunishRange / sum.heals),
    rangeCamping: clamp01(sum.campingTicks / windowTicks / TURTLE_SATURATION_FRACTION),
    punishPattern: sum.hitsLanded === 0 ? 0 : clamp01(sum.punishHits / sum.hitsLanded),
    aggression: clamp01(sum.attacks / windowSeconds / AGGRESSION_SATURATION_APS),
  };
}
