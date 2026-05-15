/**
 * race-state-aggregator.ts — #151 / #152
 *
 * Updates the rolling per-car and session-level trend fields on every
 * telemetry frame BEFORE the narrative detectors run. The detectors are
 * pure observers of this state — they do not maintain their own windows.
 *
 * Cheap to run: O(N) where N = number of resolved cars in the session.
 *
 * No events emitted from this module — it only mutates state.
 */

import type { TelemetryFrame, SessionState, CarState } from '../session-state';
import { getOrCreateCarState } from '../session-state';

/** Maximum samples kept in a rolling gap window. */
export const GAP_WINDOW_SIZE = 5;
/** Maximum samples kept for class-position hysteresis. */
export const CLASS_POSITION_HISTORY_SIZE = 3;
/** Maximum samples kept for overall-position hysteresis. */
export const OVERALL_POSITION_HISTORY_SIZE = 3;
/** Distance from end of stint considered the "pit window" (laps). */
export const PIT_WINDOW_LAPS = 5;
/** Battle gap threshold for class-group formation (seconds). */
export const CLASS_GROUP_GAP_SEC = 1.0;

export interface AggregatorContext {
  /** iRacing DriverInfo.DriverCarIdx — required to compute player-relative state. */
  playerCarIdx: number;
  /** Estimated player stint length in laps (from setSessionMetadata). */
  estimatedStintLaps?: number;
  /** Per-car class id (carIdx → CarClassID) — used for classGroups. */
  carClassByCarIdx?: Map<number, number>;
}

/**
 * Updates SessionState + per-car CarState rolling windows and derived fields
 * for the current frame. Must be called BEFORE narrative detectors.
 */
export function aggregateRaceState(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: AggregatorContext,
): void {
  const playerCarIdx = ctx.playerCarIdx;

  if (ctx.estimatedStintLaps !== undefined) {
    state.estimatedStintLaps = ctx.estimatedStintLaps;
  }

  // ---- 1. Per-car gap windows + closing rates ----
  // We only maintain the window for cars currently in the roster — keeps
  // memory bounded and matches detector visibility.
  const carCount = curr.carIdxPosition.length;
  const playerPosition =
    playerCarIdx >= 0 && playerCarIdx < carCount ? curr.carIdxPosition[playerCarIdx] : 0;

  for (const [carIdx] of state.knownRoster) {
    if (carIdx < 0 || carIdx >= carCount) continue;
    const cs = getOrCreateCarState(state, carIdx);

    // Gap to car ahead — CarIdxF2Time. iRacing reports 0 for the leader.
    const gapAhead = curr.carIdxF2Time[carIdx];
    if (Number.isFinite(gapAhead) && gapAhead > 0) {
      pushWindow(cs.recentGapToAhead, gapAhead);
      cs.closingRateToAhead = computeClosingRate(cs.recentGapToAhead);
    }

    // Gap-to-car-behind for the player only (we don't have CarIdxF2Time
    // for "behind us" — derive from the car-behind's gapToCarAhead).
    if (carIdx === playerCarIdx) {
      const carBehindIdx = findCarBehind(curr, playerPosition);
      if (carBehindIdx >= 0) {
        const gapBehind = curr.carIdxF2Time[carBehindIdx];
        if (Number.isFinite(gapBehind) && gapBehind > 0) {
          pushWindow(cs.recentGapToBehind, gapBehind);
          cs.closingRateToBehind = computeClosingRate(cs.recentGapToBehind);
        }
      }
    }

    // ---- 2. Class-position history (hysteresis source for #154) ----
    const classPos = curr.carIdxClassPosition[carIdx];
    if (classPos > 0) {
      pushWindow(cs.classPositionHistory, classPos, CLASS_POSITION_HISTORY_SIZE);
    }

    // ---- 2b. Overall-position history (hysteresis source for OVERALL_POSITION_GAIN/LOSS) ----
    const overallPos = curr.carIdxPosition[carIdx];
    if (overallPos > 0) {
      pushWindow(cs.overallPositionHistory, overallPos, OVERALL_POSITION_HISTORY_SIZE);
    }

    // ---- 3. Lap completion → stint laps + lapsSinceLastPit ----
    const prevLaps = prev ? prev.carIdxLapCompleted[carIdx] : cs.lapsCompleted;
    const currLaps = curr.carIdxLapCompleted[carIdx];
    if (prev && currLaps > prevLaps && currLaps > 0) {
      // New lap started. Stint accounting.
      const lastLap = curr.carIdxLastLapTime[carIdx];
      if (lastLap > 0) cs.stintLapTimes.push(lastLap);
      cs.lapsSinceLastPit = Math.max(0, currLaps - cs.stintStartLap);
    }
  }

  // ---- 4. Player fuel projection ----
  if (playerCarIdx >= 0) {
    const cs = getOrCreateCarState(state, playerCarIdx);
    const fuelPerLap = state.playerFuelPerLap;
    if (fuelPerLap > 0 && curr.fuelLevel > 0) {
      cs.estimatedFuelLapsRemaining = curr.fuelLevel / fuelPerLap;
    }
    // inPitWindow — within the last PIT_WINDOW_LAPS of the stint length.
    const stintLen = state.estimatedStintLaps;
    if (stintLen > 0 && cs.lapsSinceLastPit > 0) {
      const lapsRemaining = stintLen - cs.lapsSinceLastPit;
      cs.inPitWindow = lapsRemaining >= 0 && lapsRemaining <= PIT_WINDOW_LAPS;

      // pitStrategySummary
      state.pitStrategySummary.set(playerCarIdx, {
        estStintLaps: stintLen,
        lapsRemainingInStint: lapsRemaining,
        undercutOpportunityAgainst: null,
      });
    } else {
      cs.inPitWindow = false;
    }
  }

  // ---- 5. Race phase ----
  state.racePhase = computeRacePhase(curr);

  // ---- 6. Class groups — cars within CLASS_GROUP_GAP_SEC by class ----
  state.classGroups = computeClassGroups(curr, state, ctx.carClassByCarIdx);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushWindow(arr: number[], value: number, max = GAP_WINDOW_SIZE): void {
  arr.push(value);
  while (arr.length > max) arr.shift();
}

/**
 * Closing rate in seconds-per-lap, derived from the slope of the rolling
 * gap window. Positive means the gap is shrinking (closing).
 *
 * We assume each window sample is ~1 lap apart on average (the publisher
 * frame cadence is sub-second but lap-to-lap deltas dominate the signal).
 * The detectors use this as a directional indicator, not a precise rate.
 */
function computeClosingRate(window: number[]): number {
  const n = window.length;
  if (n < 2) return 0;
  // Simple delta over the window length.
  return (window[0] - window[n - 1]) / Math.max(1, n - 1);
}

/** Returns the carIdx immediately behind `playerPosition` in overall order, or -1. */
function findCarBehind(frame: TelemetryFrame, playerPosition: number): number {
  if (playerPosition <= 0) return -1;
  const target = playerPosition + 1;
  for (let i = 0; i < frame.carIdxPosition.length; i++) {
    if (frame.carIdxPosition[i] === target) return i;
  }
  return -1;
}

function computeRacePhase(frame: TelemetryFrame): SessionState['racePhase'] {
  const total = frame.sessionLapsTotal;
  const remain = frame.sessionLapsRemain;

  if (total > 0 && remain >= 0) {
    if (remain <= 5) return 'final-laps';
    const completedFrac = (total - remain) / total;
    if (completedFrac < 0.25) return 'opening';
    if (completedFrac > 0.75) return 'endgame';
    return 'midrace';
  }

  // Time-limited fallback — we only know "remain", not total. Use absolute
  // remaining seconds as a coarse heuristic.
  if (frame.sessionTimeRemain > 0) {
    if (frame.sessionTimeRemain <= 60) return 'final-laps';
    if (frame.sessionTimeRemain <= 600) return 'endgame';
  }

  return 'unknown';
}

function computeClassGroups(
  frame: TelemetryFrame,
  state: SessionState,
  carClassByCarIdx?: Map<number, number>,
): Map<number, number[][]> {
  const groups = new Map<number, number[][]>();
  // Build per-class lists of [carIdx, classPosition, gapToAhead] tuples.
  const byClass = new Map<number, Array<{ carIdx: number; classPos: number; gap: number }>>();
  for (const [carIdx, ref] of state.knownRoster) {
    const classId = ref.carClassId ?? carClassByCarIdx?.get(carIdx);
    if (classId === undefined) continue;
    const classPos = frame.carIdxClassPosition[carIdx];
    if (classPos <= 0) continue;
    const gap = frame.carIdxF2Time[carIdx] ?? 0;
    if (!byClass.has(classId)) byClass.set(classId, []);
    byClass.get(classId)!.push({ carIdx, classPos, gap });
  }

  for (const [classId, entries] of byClass) {
    entries.sort((a, b) => a.classPos - b.classPos);
    const classGroups: number[][] = [];
    let current: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (current.length === 0) {
        current.push(entries[i].carIdx);
        continue;
      }
      // gap value on this entry is gap-to-car-ahead in OVERALL order; for a
      // class-grouping heuristic we treat any same-class car within
      // CLASS_GROUP_GAP_SEC of its class-predecessor as part of the group.
      if (entries[i].gap > 0 && entries[i].gap < CLASS_GROUP_GAP_SEC) {
        current.push(entries[i].carIdx);
      } else {
        if (current.length > 1) classGroups.push(current);
        current = [entries[i].carIdx];
      }
    }
    if (current.length > 1) classGroups.push(current);
    if (classGroups.length > 0) groups.set(classId, classGroups);
  }

  return groups;
}
