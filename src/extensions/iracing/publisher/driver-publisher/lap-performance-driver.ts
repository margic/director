/**
 * lap-performance-driver.ts — DIR-1
 *
 * Driver-pipeline slice of lap performance detection.
 * Emits events only meaningful from the player's own rig:
 *
 *   PERSONAL_BEST_LAP    — player car CarIdxBestLapTime improves
 *   STINT_BEST_LAP       — per-car CarIdxLastLapTime improves on stintBestLapTime
 *   LAP_TIME_DEGRADATION — rolling avg of player CarIdxLastLapTime > stint-best * (1+threshold)
 *
 * Extracted from the monolithic lap-performance-detector.ts during DIR-1
 * refactoring. SESSION_BEST_LAP and CLASS_BEST_LAP belong to the session
 * pipeline and live in session-publisher/lap-performance-session.ts.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';

const CAR_COUNT = 64;

/** Number of completed laps included in the LAP_TIME_DEGRADATION rolling avg. */
export const LAP_DEGRADATION_BUFFER_SIZE = 3;
/** Default degradation threshold (3% slower than stint best). */
export const DEFAULT_LAP_DEGRADATION_THRESHOLD = 0.03;

export interface DriverLapPerformanceContext {
  rigId: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required for player-specific events. */
  playerCarIdx?: number;
  /** Override the default 3% degradation threshold. */
  degradationThreshold?: number;
}

// ---------------------------------------------------------------------------
// detectDriverLapPerformance
// ---------------------------------------------------------------------------

export function detectDriverLapPerformance(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: DriverLapPerformanceContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (prev === null) {
    // Seed per-car bests so subsequent frames can compute deltas.
    for (let i = 0; i < CAR_COUNT; i++) {
      const cs = getOrCreateCarState(state, i);
      cs.bestLapTime   = curr.carIdxBestLapTime[i];
      cs.lastLapTime   = curr.carIdxLastLapTime[i];
      cs.lapsCompleted = curr.carIdxLapCompleted[i];
    }
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const threshold    = ctx.degradationThreshold ?? DEFAULT_LAP_DEGRADATION_THRESHOLD;
  const playerCarIdx = ctx.playerCarIdx;

  for (let i = 0; i < CAR_COUNT; i++) {
    const prevLaps = prev.carIdxLapCompleted[i];
    const currLaps = curr.carIdxLapCompleted[i];
    if (currLaps <= prevLaps) continue;

    const cs      = getOrCreateCarState(state, i);
    const lastLap = curr.carIdxLastLapTime[i];

    // STINT_BEST_LAP — per-car last lap improves on stint best
    if (lastLap > 0 && (cs.stintBestLapTime === 0 || lastLap < cs.stintBestLapTime)) {
      cs.stintBestLapTime = lastLap;
      const stintBestCar = carRefFromRoster(state, i);
      if (stintBestCar) {
        events.push(buildEvent(
          'STINT_BEST_LAP',
          stintBestCar,
          { lapNumber: currLaps, lapTime: lastLap },
          opts,
        ));
      }
      // Reset the player degradation latch — the stint just got a fresh best.
      if (i === playerCarIdx) {
        state.playerDegradationFired = false;
      }
    }

    cs.lastLapTime   = lastLap;
    cs.lapsCompleted = currLaps;

    // -----------------------------------------------------------------------
    // Player-specific: PERSONAL_BEST_LAP + lap-time rolling buffer
    // -----------------------------------------------------------------------
    if (i === playerCarIdx) {
      const newBest = curr.carIdxBestLapTime[i];
      if (newBest > 0 && (cs.bestLapTime === 0 || newBest < cs.bestLapTime)) {
        const previousBest = cs.bestLapTime;
        cs.bestLapTime = newBest;
        const personalBestCar = carRefFromRoster(state, i);
        if (personalBestCar) {
          events.push(buildEvent(
            'PERSONAL_BEST_LAP',
            personalBestCar,
            { lapNumber: currLaps, lapTime: newBest, previousBest },
            opts,
          ));
        }
      }

      if (lastLap > 0) {
        state.playerLapTimeBuffer.push(lastLap);
        if (state.playerLapTimeBuffer.length > LAP_DEGRADATION_BUFFER_SIZE) {
          state.playerLapTimeBuffer.shift();
        }
        if (
          !state.playerDegradationFired &&
          state.playerLapTimeBuffer.length === LAP_DEGRADATION_BUFFER_SIZE &&
          cs.stintBestLapTime > 0
        ) {
          const avg = state.playerLapTimeBuffer.reduce((a, b) => a + b, 0) / LAP_DEGRADATION_BUFFER_SIZE;
          const degradationPct = (avg - cs.stintBestLapTime) / cs.stintBestLapTime;
          if (degradationPct >= threshold) {
            const degradationCar = carRefFromRoster(state, i);
            if (degradationCar) {
              state.playerDegradationFired = true;
              events.push(buildEvent(
                'LAP_TIME_DEGRADATION',
                degradationCar,
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
      }
    } else {
      // Update non-player bestLapTime for cross-car comparisons.
      const newBest = curr.carIdxBestLapTime[i];
      if (newBest > 0 && (cs.bestLapTime === 0 || newBest < cs.bestLapTime)) {
        cs.bestLapTime = newBest;
      }
    }
  }

  return events;
}
