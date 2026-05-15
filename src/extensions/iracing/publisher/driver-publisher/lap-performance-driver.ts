/**
 * lap-performance-driver.ts — DIR-1
 *
 * Driver-pipeline slice of lap performance detection.
 * Emits events only meaningful from the player's own rig:
 *
 *   PERSONAL_BEST_LAP    — player car CarIdxBestLapTime improves
 *   LAP_TIME_DEGRADATION — rolling avg of player CarIdxLastLapTime > stint-best * (1+threshold)
 *
 * Extracted from the monolithic lap-performance-detector.ts during DIR-1
 * refactoring. SESSION_BEST_LAP, CLASS_BEST_LAP and STINT_BEST_LAP belong
 * to the session pipeline and live in
 * session-publisher/lap-performance-session.ts (Issue #147).
 *
 * The player's per-car `stintBestLapTime` is still tracked here (without
 * emitting an event) because `LAP_TIME_DEGRADATION` compares the rolling
 * average against the player's stint best.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';
import type { DriverState } from '../driver-state';

/** Number of completed laps included in the LAP_TIME_DEGRADATION rolling avg. */
export const LAP_DEGRADATION_BUFFER_SIZE = 3;
/** Default degradation threshold (3% slower than stint best). */
export const DEFAULT_LAP_DEGRADATION_THRESHOLD = 0.03;

/** Module-level latch — log "playerCarIdx unset" warning at most once. */
let unsetPlayerCarIdxWarned = false;

export interface DriverLapPerformanceContext {
  rigId: string;
  raceSessionId: string;
  /** iRacing DriverInfo.DriverCarIdx — required: detectors are scoped to the
   *  player car only (Issue: scope driver-rig detectors to playerCarIdx). */
  playerCarIdx: number;
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
  driverState: DriverState,
  ctx: DriverLapPerformanceContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  const playerCarIdx = ctx.playerCarIdx;
  if (playerCarIdx < 0) {
    if (!unsetPlayerCarIdxWarned) {
      unsetPlayerCarIdxWarned = true;
      // eslint-disable-next-line no-console
      console.warn('[lap-performance-driver] playerCarIdx unset; skipping frame');
    }
    return events;
  }

  if (prev === null) {
    // Seed the player car so subsequent frames can compute deltas.
    const cs = getOrCreateCarState(state, playerCarIdx);
    cs.bestLapTime   = curr.carIdxBestLapTime[playerCarIdx];
    cs.lastLapTime   = curr.carIdxLastLapTime[playerCarIdx];
    cs.lapsCompleted = curr.carIdxLapCompleted[playerCarIdx];
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const threshold = ctx.degradationThreshold ?? DEFAULT_LAP_DEGRADATION_THRESHOLD;

  // -------------------------------------------------------------------------
  // Player car only — driver pipeline is scoped to ctx.playerCarIdx.
  // -------------------------------------------------------------------------
  const i = playerCarIdx;
  const prevLaps = prev.carIdxLapCompleted[i];
  const currLaps = curr.carIdxLapCompleted[i];
  if (currLaps <= prevLaps) return events;

  const cs      = getOrCreateCarState(state, i);
  const lastLap = curr.carIdxLastLapTime[i];

  // Track player's stint best for LAP_TIME_DEGRADATION below. The
  // STINT_BEST_LAP event itself is emitted by the session pipeline
  // (lap-performance-session.ts, Issue #147).
  if (lastLap > 0 && (cs.stintBestLapTime === 0 || lastLap < cs.stintBestLapTime)) {
    cs.stintBestLapTime = lastLap;
    // Reset the player degradation latch — the stint just got a fresh best.
    driverState.degradationFired = false;
  }

  cs.lastLapTime   = lastLap;
  cs.lapsCompleted = currLaps;

  // -------------------------------------------------------------------------
  // PERSONAL_BEST_LAP + lap-time rolling buffer
  // -------------------------------------------------------------------------
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
    driverState.lapTimeBuffer.push(lastLap);
    if (driverState.lapTimeBuffer.length > LAP_DEGRADATION_BUFFER_SIZE) {
      driverState.lapTimeBuffer.shift();
    }
    if (
      !driverState.degradationFired &&
      driverState.lapTimeBuffer.length === LAP_DEGRADATION_BUFFER_SIZE &&
      cs.stintBestLapTime > 0
    ) {
      const avg = driverState.lapTimeBuffer.reduce((a, b) => a + b, 0) / LAP_DEGRADATION_BUFFER_SIZE;
      const degradationPct = (avg - cs.stintBestLapTime) / cs.stintBestLapTime;
      if (degradationPct >= threshold) {
        const degradationCar = carRefFromRoster(state, i);
        if (degradationCar) {
          driverState.degradationFired = true;
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

  return events;
}
