/**
 * lap-performance-session.ts — DIR-1
 *
 * Session-pipeline slice of lap performance detection.
 * Emits events observable by any rig watching the field:
 *
 *   SESSION_BEST_LAP  — lowest CarIdxBestLapTime across all cars improves
 *   CLASS_BEST_LAP    — lowest CarIdxBestLapTime within a CarClassID improves
 *
 * Extracted from the monolithic lap-performance-detector.ts during DIR-1
 * refactoring. Logic and state fields are identical; only the driver-specific
 * events (PERSONAL_BEST_LAP, LAP_TIME_DEGRADATION, STINT_BEST_LAP) have
 * been removed — they live in driver-publisher/lap-performance-driver.ts.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from '../session-state';
import type { PublisherEvent } from '../event-types';

const CAR_COUNT = 64;

export interface SessionLapPerformanceContext {
  rigId: string;
  raceSessionId: string;
  /** Map of carIdx → CarClassID (from session YAML DriverInfo). */
  carClassByCarIdx?: Map<number, number>;
  /** Map of CarClassID → short class name (from session YAML). */
  carClassShortNames?: Map<number, string>;
}

// ---------------------------------------------------------------------------
// detectSessionLapPerformance
// ---------------------------------------------------------------------------

export function detectSessionLapPerformance(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: SessionLapPerformanceContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (prev === null) {
    // Seed per-car bests so subsequent frames can compute deltas.
    for (let i = 0; i < CAR_COUNT; i++) {
      const cs = getOrCreateCarState(state, i);
      cs.bestLapTime   = curr.carIdxBestLapTime[i];
      cs.lapsCompleted = curr.carIdxLapCompleted[i];
    }
    if (state.sessionBestLapTime === 0) {
      state.sessionBestLapTime = computeSessionBest(curr);
    }
    return events;
  }

  const opts = { raceSessionId: ctx.raceSessionId, rigId: ctx.rigId, frame: curr };
  const carClassByCarIdx   = ctx.carClassByCarIdx   ?? new Map<number, number>();
  const carClassShortNames = ctx.carClassShortNames ?? new Map<number, string>();

  // Track whether ANY lap completed this frame so SESSION/CLASS bests only
  // recompute when necessary.
  let anyLapCompleted = false;

  for (let i = 0; i < CAR_COUNT; i++) {
    const prevLaps = prev.carIdxLapCompleted[i];
    const currLaps = curr.carIdxLapCompleted[i];
    if (currLaps > prevLaps) {
      anyLapCompleted = true;
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
    const holderIdx = findCarWithBestLap(curr, sessionBest);
    const sessionBestCar = carRefFromRoster(state, holderIdx);
    if (sessionBestCar) {
      events.push(buildEvent(
        'SESSION_BEST_LAP',
        sessionBestCar,
        {
          lapNumber:           curr.carIdxLapCompleted[holderIdx],
          lapTime:             sessionBest,
          previousSessionBest,
        },
        opts,
      ));
    }
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
        const classBestCar = carRefFromRoster(state, carIdx);
        if (classBestCar) {
          events.push(buildEvent(
            'CLASS_BEST_LAP',
            classBestCar,
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
