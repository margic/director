/**
 * lap-performance-detector.ts — Issues #100, #95
 *
 * Lap-time related events derived from telemetry frames:
 *
 *   PERSONAL_BEST_LAP    — player car CarIdxBestLapTime improves (#100)
 *   SESSION_BEST_LAP     — lowest CarIdxBestLapTime across all cars improves (#100)
 *   CLASS_BEST_LAP       — lowest CarIdxBestLapTime within a CarClassID improves (#95)
 *   LAP_TIME_DEGRADATION — rolling avg of player CarIdxLastLapTime > stint-best * (1+threshold) (#100)
 *   STINT_BEST_LAP       — per-car CarIdxLastLapTime improves on stintBestLapTime (#100)
 *
 * Design: pure-ish function — receives prev (nullable), curr, mutable
 * SessionState, and a static context. Returns events to enqueue; mutates
 * carStates / SessionState lap-tracking fields.
 *
 * Wiring note: Detectors that need YAML-only metadata (player carIdx, class
 * IDs) accept it via context. Until the orchestrator pipes session YAML into
 * the publisher pipeline, callers can pass `playerCarIdx: undefined` and an
 * empty `carClassByCarIdx` map — the detector silently skips events that
 * cannot be evaluated rather than guessing.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import { getOrCreateCarState, buildEvent } from './session-state';
import type { PublisherEvent } from './event-types';

const CAR_COUNT = 64;

/** Number of completed laps included in the LAP_TIME_DEGRADATION rolling avg. */
export const LAP_DEGRADATION_BUFFER_SIZE = 3;
/** Default degradation threshold (3% slower than stint best). */
export const DEFAULT_LAP_DEGRADATION_THRESHOLD = 0.03;

export interface LapPerformanceContext {
  publisherCode: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for player-specific events. */
  playerCarIdx?: number;
  /** Map of carIdx → CarClassID (from session YAML DriverInfo). */
  carClassByCarIdx?: Map<number, number>;
  /** Map of CarClassID → short class name (from session YAML). */
  carClassShortNames?: Map<number, string>;
  /** Override the default 3% degradation threshold. */
  degradationThreshold?: number;
}

// ---------------------------------------------------------------------------
// detectLapPerformance
// ---------------------------------------------------------------------------

export function detectLapPerformance(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: LapPerformanceContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  if (prev === null) {
    // Seed per-car bests so subsequent frames can compute deltas.
    for (let i = 0; i < CAR_COUNT; i++) {
      const cs = getOrCreateCarState(state, i);
      cs.bestLapTime    = curr.carIdxBestLapTime[i];
      cs.lastLapTime    = curr.carIdxLastLapTime[i];
      cs.lapsCompleted  = curr.carIdxLapCompleted[i];
    }
    if (state.sessionBestLapTime === 0) {
      state.sessionBestLapTime = computeSessionBest(curr);
    }
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const threshold = ctx.degradationThreshold ?? DEFAULT_LAP_DEGRADATION_THRESHOLD;
  const carClassByCarIdx = ctx.carClassByCarIdx ?? new Map<number, number>();
  const carClassShortNames = ctx.carClassShortNames ?? new Map<number, string>();

  // Track whether ANY lap completed this frame so we can recompute aggregates only once.
  let anyLapCompleted = false;

  // -------------------------------------------------------------------------
  // Per-car: STINT_BEST_LAP, lap completion bookkeeping
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const prevLaps = prev.carIdxLapCompleted[i];
    const currLaps = curr.carIdxLapCompleted[i];
    if (currLaps <= prevLaps) continue;

    anyLapCompleted = true;
    const cs = getOrCreateCarState(state, i);
    const lastLap = curr.carIdxLastLapTime[i];

    // STINT_BEST_LAP — per-car last lap improves on stint best
    if (lastLap > 0 && (cs.stintBestLapTime === 0 || lastLap < cs.stintBestLapTime)) {
      const prevStintBest = cs.stintBestLapTime;
      cs.stintBestLapTime = lastLap;
      events.push(buildEvent(
        'STINT_BEST_LAP',
        { carIdx: i, carNumber: '', driverName: '' },
        { lapNumber: currLaps, lapTime: lastLap },
        opts,
      ));
      // Reset the player degradation latch — the stint just got a fresh best.
      if (i === ctx.playerCarIdx) {
        state.playerDegradationFired = false;
      }
      void prevStintBest;
    }

    cs.lastLapTime   = lastLap;
    cs.lapsCompleted = currLaps;

    // -----------------------------------------------------------------------
    // Player-specific: PERSONAL_BEST_LAP + lap-time rolling buffer
    // -----------------------------------------------------------------------
    if (i === ctx.playerCarIdx) {
      const newBest = curr.carIdxBestLapTime[i];
      if (
        newBest > 0 &&
        (cs.bestLapTime === 0 || newBest < cs.bestLapTime)
      ) {
        const previousBest = cs.bestLapTime;
        cs.bestLapTime = newBest;
        events.push(buildEvent(
          'PERSONAL_BEST_LAP',
          { carIdx: i, carNumber: '', driverName: '' },
          { lapNumber: currLaps, lapTime: newBest, previousBest },
          opts,
        ));
      }

      if (lastLap > 0) {
        state.playerLapTimeBuffer.push(lastLap);
        if (state.playerLapTimeBuffer.length > LAP_DEGRADATION_BUFFER_SIZE) {
          state.playerLapTimeBuffer.shift();
        }
        // Evaluate degradation once the buffer is full and we have a stint best.
        if (
          !state.playerDegradationFired &&
          state.playerLapTimeBuffer.length === LAP_DEGRADATION_BUFFER_SIZE &&
          cs.stintBestLapTime > 0
        ) {
          const avg = state.playerLapTimeBuffer.reduce((a, b) => a + b, 0) / LAP_DEGRADATION_BUFFER_SIZE;
          const degradationPct = (avg - cs.stintBestLapTime) / cs.stintBestLapTime;
          if (degradationPct >= threshold) {
            state.playerDegradationFired = true;
            events.push(buildEvent(
              'LAP_TIME_DEGRADATION',
              { carIdx: i, carNumber: '', driverName: '' },
              {
                rollingAvgSec:  avg,
                stintBestSec:   cs.stintBestLapTime,
                degradationPct,
              },
              opts,
            ));
          }
        }
      }
    } else {
      // Update non-player bestLapTime for later session/class-best comparisons.
      const newBest = curr.carIdxBestLapTime[i];
      if (newBest > 0 && (cs.bestLapTime === 0 || newBest < cs.bestLapTime)) {
        cs.bestLapTime = newBest;
      }
    }
  }

  if (!anyLapCompleted) {
    return events;
  }

  // -------------------------------------------------------------------------
  // SESSION_BEST_LAP — recompute lowest CarIdxBestLapTime across all cars
  // -------------------------------------------------------------------------
  const sessionBest = computeSessionBest(curr);
  if (
    sessionBest > 0 &&
    (state.sessionBestLapTime === 0 || sessionBest < state.sessionBestLapTime)
  ) {
    const previousSessionBest = state.sessionBestLapTime;
    state.sessionBestLapTime = sessionBest;
    // Find which car holds it for the event car ref.
    const holderIdx = findCarWithBestLap(curr, sessionBest);
    events.push(buildEvent(
      'SESSION_BEST_LAP',
      { carIdx: holderIdx, carNumber: '', driverName: '' },
      {
        lapNumber:           curr.carIdxLapCompleted[holderIdx],
        lapTime:             sessionBest,
        previousSessionBest,
      },
      opts,
    ));
  }

  // -------------------------------------------------------------------------
  // CLASS_BEST_LAP — per CarClassID, fire when class best improves
  // -------------------------------------------------------------------------
  if (carClassByCarIdx.size > 0) {
    const classBests = new Map<number, { lapTime: number; carIdx: number }>();
    for (let i = 0; i < CAR_COUNT; i++) {
      const classId = carClassByCarIdx.get(i);
      if (classId === undefined) continue;
      const best = curr.carIdxBestLapTime[i];
      if (best <= 0) continue;
      const existing = classBests.get(classId);
      if (!existing || best < existing.lapTime) {
        classBests.set(classId, { lapTime: best, carIdx: i });
      }
    }

    for (const [classId, { lapTime, carIdx }] of classBests) {
      const previous = state.classBestLapTimes.get(classId) ?? 0;
      if (previous === 0 || lapTime < previous) {
        state.classBestLapTimes.set(classId, lapTime);
        events.push(buildEvent(
          'CLASS_BEST_LAP',
          { carIdx, carNumber: '', driverName: '' },
          {
            lapNumber:         curr.carIdxLapCompleted[carIdx],
            lapTime,
            carClassId:        classId,
            carClassShortName: carClassShortNames.get(classId) ?? '',
          },
          opts,
        ));
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSessionBest(frame: TelemetryFrame): number {
  let best = 0;
  for (let i = 0; i < CAR_COUNT; i++) {
    const t = frame.carIdxBestLapTime[i];
    if (t > 0 && (best === 0 || t < best)) best = t;
  }
  return best;
}

function findCarWithBestLap(frame: TelemetryFrame, target: number): number {
  for (let i = 0; i < CAR_COUNT; i++) {
    if (frame.carIdxBestLapTime[i] === target) return i;
  }
  return -1;
}
