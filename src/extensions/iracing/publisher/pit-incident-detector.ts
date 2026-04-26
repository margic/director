/**
 * pit-incident-detector.ts — Issue #86
 *
 * Tier 1 pit & incident events. Detects:
 *
 *   PIT_ENTRY         — CarIdxOnPitRoad false→true
 *   PIT_EXIT          — CarIdxOnPitRoad true→false; includes positionsLost
 *   OFF_TRACK         — CarIdxTrackSurface === -1 for 2 consecutive frames
 *   BACK_ON_TRACK     — surface returns to ≥ 0 after an OFF_TRACK
 *   INCIDENT_POINT    — PlayerCarMyIncidentCount increment
 *   IDENTITY_RESOLVED — one-shot at session start when state.identityResolved is false
 *
 * Tier 2 events (PIT_STOP_BEGIN, PIT_STOP_END, FUEL_LOW, FUEL_LEVEL_CHANGE) are
 * deferred to #96.
 *
 * Design: pure-ish function — returns events; mutates CarState & SessionState
 * fields in-place (caller's session state object). Caller must not share state
 * across sessions.
 */

import type { TelemetryFrame, SessionState } from './session-state';
import { getOrCreateCarState, buildEvent, carRefFromRoster } from './session-state';
import type { PublisherEvent } from './event-types';

const CAR_COUNT = 64;

// iRacing TrackSurface enum values
const TRACK_OFF_TRACK = -1;

export interface PitIncidentDetectorContext {
  publisherCode: string;
  raceSessionId: string;
  /** Optional: display name for the player car (identity override) */
  playerDisplayName?: string;
  /** Optional: iRacing user name for IDENTITY_RESOLVED */
  iracingUserName?: string;
}

// ---------------------------------------------------------------------------
// detectPitAndIncidents
// ---------------------------------------------------------------------------

export function detectPitAndIncidents(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PitIncidentDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };

  // -------------------------------------------------------------------------
  // Per-car scan
  // -------------------------------------------------------------------------
  for (let i = 0; i < CAR_COUNT; i++) {
    const cs = getOrCreateCarState(state, i);
    const currOnPit    = curr.carIdxOnPitRoad[i] !== 0;
    const currSurface  = curr.carIdxTrackSurface[i];
    const car          = carRefFromRoster(state, i);

    // -----------------------------------------------------------------------
    // PIT_ENTRY — false→true
    // -----------------------------------------------------------------------
    if (currOnPit && !cs.onPitRoad) {
      cs.pitEntryLap = curr.carIdxLapCompleted[i];
      // Record fuel at pit entry for player car (used by Tier 2)
      if (i === 0) cs.fuelLevelOnPitEntry = curr.fuelLevel;

      if (car) {
        events.push(buildEvent(
          'PIT_ENTRY',
          car,
          {
            entryLap:       curr.carIdxLapCompleted[i],
            position:       curr.carIdxPosition[i],
            gapToLeaderSec: curr.carIdxF2Time[i],
          },
          opts,
        ));
      }
    }

    // -----------------------------------------------------------------------
    // PIT_EXIT — true→false
    // -----------------------------------------------------------------------
    if (!currOnPit && cs.onPitRoad) {
      const newPos      = curr.carIdxPosition[i];
      const exitLap     = curr.carIdxLapCompleted[i];
      // positionsLost: positive = lost positions (went down the order)
      const positionsLost = newPos > cs.position ? newPos - cs.position : 0;

      if (car) {
        events.push(buildEvent(
          'PIT_EXIT',
          car,
          {
            exitLap,
            newPosition:    newPos,
            positionsLost,
          },
          opts,
        ));
      }

      // Reset pit tracking fields
      cs.pitEntryLap           = null;
      cs.pitStallArrivalTime   = null;
      cs.fuelLevelOnPitEntry   = null;
    }

    // -----------------------------------------------------------------------
    // OFF_TRACK — trackSurface === -1 sustained 2 frames
    // -----------------------------------------------------------------------
    if (currSurface === TRACK_OFF_TRACK) {
      cs.offTrackFrames++;
      if (cs.offTrackFrames === 2) {
        // Rising edge: fire exactly once when the count reaches 2
        if (car) {
          events.push(buildEvent(
            'OFF_TRACK',
            car,
            {
              lapDistPct:      curr.carIdxLapDistPct[i],
              speedAtExitMps:  0, // speed not in TelemetryFrame; Tier 2 can enrich
            },
            opts,
          ));
        }
      }
    } else {
      if (cs.offTrackFrames >= 2) {
        // Was off-track and now returned
        const timeOffTrackSec = prev
          ? curr.sessionTime - (prev.sessionTime - (cs.offTrackFrames - 1) * 0.2)
          : 0;
        if (car) {
          events.push(buildEvent(
            'BACK_ON_TRACK',
            car,
            { timeOffTrackSec: Math.max(0, timeOffTrackSec) },
            opts,
          ));
        }
      }
      cs.offTrackFrames = 0;
    }

    // -----------------------------------------------------------------------
    // Update per-car state
    // -----------------------------------------------------------------------
    cs.onPitRoad    = currOnPit;
    cs.trackSurface = currSurface;
    cs.position     = curr.carIdxPosition[i];
  }

  // -------------------------------------------------------------------------
  // INCIDENT_POINT — player car only, delta-based
  // -------------------------------------------------------------------------
  if (prev !== null && curr.playerIncidentCount > prev.playerIncidentCount) {
    const delta = curr.playerIncidentCount - prev.playerIncidentCount;
    const car   = carRefFromRoster(state, 0);
    if (car) {
      events.push(buildEvent(
        'INCIDENT_POINT',
        car,
        {
          incidentPoints:      delta,
          totalIncidentPoints: curr.playerIncidentCount,
        },
        opts,
      ));
    }
  }

  // -------------------------------------------------------------------------
  // IDENTITY_RESOLVED — one-shot, fires once per session when ready
  // The caller sets ctx.iracingUserName / ctx.playerDisplayName once the
  // identity override service has resolved.
  // -------------------------------------------------------------------------
  if (!state.identityResolved && ctx.iracingUserName && ctx.playerDisplayName) {
    const baseRef = carRefFromRoster(state, 0);
    if (baseRef) {
      state.identityResolved = true;
      const car = { ...baseRef, driverName: ctx.playerDisplayName };
      events.push(buildEvent(
        'IDENTITY_RESOLVED',
        car,
        {
          iracingUserName:    ctx.iracingUserName,
          displayName:        ctx.playerDisplayName,
        },
        opts,
      ));
    }
  }

  return events;
}
