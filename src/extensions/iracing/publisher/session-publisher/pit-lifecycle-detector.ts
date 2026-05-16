/**
 * pit-lifecycle-detector.ts — Issue #198 (PR-B for #196)
 *
 * Session-wide pit lifecycle detection for all 64 car slots.
 *
 * Emits:
 *   PIT_ENTRY          — CarIdxOnPitRoad false→true
 *   PIT_STATIONARY     — car enters pit stall (CarIdxTrackSurface === 2)
 *   PIT_STOP_COMPLETED — car leaves pit stall (CarIdxTrackSurface 2→anything else)
 *   PIT_EXIT           — CarIdxOnPitRoad true→false
 *
 * Design notes:
 *  - Per-car pit state is stored on CarState (added to session-state interface).
 *  - stopType is derived from SessionFlags at the moment of PIT_ENTRY:
 *      yellow/SC flags  → 'sc'
 *      red flag         → 'red'
 *      green/none       → 'green'
 *  - Fuel/tire details are only populated for the player car via the
 *    driver-publisher pit-incident-detector; this file stores 0/false stubs
 *    so that the session-wide event still carries a consistent wire shape.
 *  - Gap-to-neighbours at entry uses CarIdxF2Time (within-lap only; may be
 *    inaccurate across lap boundaries — consumers should treat as indicative).
 *  - iRacing TrackSurface values:
 *      -1 = off track
 *       0 = not in world
 *       1 = on track
 *       2 = in pit stall (stationary)
 *       3 = approaching pits
 *       4 = pit lane (moving)
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { getOrCreateCarState, carRefFromRoster, buildEvent } from '../session-state';
import type { PublisherEvent } from '../event-types';

export interface PitLifecycleContext {
  rigId: string;
  raceSessionId: string;
  /** playerCarIdx — from the iRacing session data. */
  playerCarIdx: number;
}

const CAR_COUNT = 64;

/** iRacing SessionFlags bitmask values relevant to pit stop type. */
const FLAG_YELLOW     = 0x0010;
const FLAG_YELLOW_WAVING = 0x0020;
const FLAG_RED        = 0x0100;
const FLAG_SAFETY_CAR_YELLOW = 0x0200;

function deriveStopType(sessionFlags: number): 'green' | 'sc' | 'red' | 'unknown' {
  if (sessionFlags & FLAG_RED) return 'red';
  if (sessionFlags & (FLAG_YELLOW | FLAG_YELLOW_WAVING | FLAG_SAFETY_CAR_YELLOW)) return 'sc';
  if (sessionFlags !== 0) return 'green';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// detectPitLifecycle — pure-ish function (mutates carState)
// ---------------------------------------------------------------------------

export function detectPitLifecycle(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PitLifecycleContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];

  if (!prev) return events;

  // #196: only emit pit events after the race has gone green
  if (!state.raceGreenFired) return events;

  const opts = { rigId: ctx.rigId, raceSessionId: ctx.raceSessionId, frame: curr };

  for (let i = 0; i < CAR_COUNT; i++) {
    if (curr.carIdxPosition[i] <= 0 && prev.carIdxPosition[i] <= 0) {
      // Car not in world on either frame — skip
      continue;
    }

    const cs = getOrCreateCarState(state, i);

    const prevOnPit  = prev.carIdxOnPitRoad[i] !== 0;
    const currOnPit  = curr.carIdxOnPitRoad[i] !== 0;
    const prevSurface = prev.carIdxTrackSurface[i];
    const currSurface = curr.carIdxTrackSurface[i];

    // ------------------------------------------------------------------
    // PIT_ENTRY: off pit road → on pit road
    // ------------------------------------------------------------------
    if (!prevOnPit && currOnPit) {
      const car = carRefFromRoster(state, i);
      if (car) {
        const pos     = curr.carIdxPosition[i];
        const lapGap  = curr.carIdxF2Time[i];
        // Find car immediately ahead / behind in race position
        let aheadIdx = -1;
        let behindIdx = -1;
        const entryPos = curr.carIdxPosition[i];
        for (let j = 0; j < CAR_COUNT; j++) {
          if (j === i) continue;
          if (curr.carIdxPosition[j] <= 0) continue;
          const jPos = curr.carIdxPosition[j];
          if (jPos === entryPos - 1) aheadIdx = j;
          if (jPos === entryPos + 1) behindIdx = j;
        }
        const carAhead  = aheadIdx  >= 0 ? carRefFromRoster(state, aheadIdx)  : undefined;
        const carBehind = behindIdx >= 0 ? carRefFromRoster(state, behindIdx) : undefined;

        const stopType = deriveStopType(curr.sessionFlags ?? 0);

        events.push(buildEvent('PIT_ENTRY', car, {
          entryLap:          curr.carIdxLapCompleted[i],
          position:          pos,
          gapToLeaderSec:    lapGap,
          gapToCarAheadSec:  aheadIdx  >= 0 ? Math.max(0, curr.carIdxF2Time[aheadIdx])  : undefined,
          gapToCarBehindSec: behindIdx >= 0 ? Math.max(0, curr.carIdxF2Time[behindIdx]) : undefined,
          carAhead:          carAhead  ?? undefined,
          carBehind:         carBehind ?? undefined,
          stopType,
        }, opts));

        cs.pitEntrySessionTime = curr.sessionTime;
        cs.pitEntryPosition    = pos;
        cs.pitStopType         = stopType;
      }
    }

    // ------------------------------------------------------------------
    // PIT_STATIONARY: car enters pit stall (trackSurface transitions to 2)
    // ------------------------------------------------------------------
    if (prevSurface !== 2 && currSurface === 2) {
      const car = carRefFromRoster(state, i);
      if (car) {
        events.push(buildEvent('PIT_STATIONARY', car, {
          arrivalSessionTime: curr.sessionTime,
          fuelLevelOnEntry:   0, // player enrichment handled by driver-publisher
        }, opts));
        cs.stallArrivalSessionTime = curr.sessionTime;
        cs.stallFuelOnEntry        = 0;
      }
    }

    // ------------------------------------------------------------------
    // PIT_STOP_COMPLETED: car leaves pit stall (trackSurface 2 → other)
    // ------------------------------------------------------------------
    if (prevSurface === 2 && currSurface !== 2) {
      const car = carRefFromRoster(state, i);
      if (car) {
        const stallMs = cs.stallArrivalSessionTime !== null
          ? Math.round((curr.sessionTime - cs.stallArrivalSessionTime) * 1000)
          : 0;

        events.push(buildEvent('PIT_STOP_COMPLETED', car, {
          stationaryMs:          stallMs,
          stopType:              cs.pitStopType ?? 'unknown',
          fuelAdded:             0,     // player enrichment in driver-publisher
          tiresChanged:          false, // player enrichment in driver-publisher
          exitPosition:          curr.carIdxPosition[i] > 0 ? curr.carIdxPosition[i] : 0,
          deltaVsCarAheadSec:    undefined,
        }, opts));

        cs.stallArrivalSessionTime = null;
      }
    }

    // ------------------------------------------------------------------
    // PIT_EXIT: on pit road → off pit road
    // ------------------------------------------------------------------
    if (prevOnPit && !currOnPit) {
      const car = carRefFromRoster(state, i);
      if (car) {
        const exitPos    = curr.carIdxPosition[i];
        const entryPos   = cs.pitEntryPosition ?? exitPos;
        const posLost    = Math.max(0, exitPos - entryPos);

        events.push(buildEvent('PIT_EXIT', car, {
          exitLap:        curr.carIdxLapCompleted[i],
          newPosition:    exitPos,
          positionsLost:  posLost,
        }, opts));

        cs.pitEntrySessionTime = null;
        cs.pitEntryPosition    = null;
        cs.pitStopType         = null;
      }
    }
  }

  return events;
}
